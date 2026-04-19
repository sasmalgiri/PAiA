// LLM provider plugins.
//
// Currently supports:
//   - ollama          (always-on local)
//   - openai          (cloud, requires API key, opt-in)
//   - anthropic       (cloud, requires API key, opt-in)
//   - openai-compatible (cloud or self-hosted; baseUrl + key)
//
// Each provider implements `chat(model, messages, onToken)` and `listModels()`.
// The dispatcher in main.ts routes a `provider:model` qualified name to
// the right backend.

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { OllamaClient } from '../shared/ollama';
import { logger } from './logger';
import * as settingsStore from './settings';
import * as classroom from './classroom';
import { isFeatureEnabled } from './license';
import type {
  ChatMessage,
  ProviderConfig,
  ProviderId,
  ProviderState,
} from '../shared/types';

// ─── persisted provider configs ────────────────────────────────────

function configPath(): string {
  return path.join(app.getPath('userData'), 'providers.json');
}

function defaultConfigs(): ProviderConfig[] {
  return [
    { id: 'ollama', enabled: true },
    { id: 'openai', enabled: false },
    { id: 'anthropic', enabled: false },
    { id: 'openai-compatible', enabled: false, baseUrl: '' },
  ];
}

export function loadConfigs(): ProviderConfig[] {
  try {
    const raw = fs.readFileSync(configPath(), 'utf-8');
    const parsed = JSON.parse(raw) as ProviderConfig[];
    // Make sure every known provider is represented (so the UI always renders all rows).
    const defaults = defaultConfigs();
    for (const def of defaults) {
      if (!parsed.find((p) => p.id === def.id)) parsed.push(def);
    }
    return parsed;
  } catch {
    return defaultConfigs();
  }
}

export function saveConfigs(list: ProviderConfig[]): void {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(list, null, 2));
}

export function getConfig(id: ProviderId): ProviderConfig | undefined {
  return loadConfigs().find((c) => c.id === id);
}

// ─── ollama (local) ────────────────────────────────────────────────

const ollama = new OllamaClient();

async function ollamaState(): Promise<ProviderState> {
  const s = await ollama.status();
  return {
    id: 'ollama',
    name: 'Ollama (local)',
    reachable: s.reachable,
    models: s.models.map((m) => m.name),
    isCloud: false,
    error: s.error,
  };
}

async function ollamaChat(
  model: string,
  messages: ChatMessage[],
  onToken: (t: string) => void,
): Promise<string> {
  return ollama.chat(model, messages, onToken);
}

// ─── openai ────────────────────────────────────────────────────────

const OPENAI_DEFAULT_MODELS = [
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4-turbo',
  'gpt-3.5-turbo',
  'o1-preview',
  'o1-mini',
];

async function openaiState(cfg: ProviderConfig): Promise<ProviderState> {
  if (!cfg.enabled || !cfg.apiKey) {
    return {
      id: 'openai',
      name: 'OpenAI (cloud)',
      reachable: false,
      models: [],
      isCloud: true,
      error: !cfg.enabled ? 'disabled' : 'no API key',
    };
  }
  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
    });
    if (!res.ok) {
      return {
        id: 'openai',
        name: 'OpenAI (cloud)',
        reachable: false,
        models: cfg.models ?? OPENAI_DEFAULT_MODELS,
        isCloud: true,
        error: `HTTP ${res.status}`,
      };
    }
    const body = (await res.json()) as { data: { id: string }[] };
    const models = body.data.map((m) => m.id).filter((id) => id.startsWith('gpt-') || id.startsWith('o1') || id.startsWith('o3'));
    return {
      id: 'openai',
      name: 'OpenAI (cloud)',
      reachable: true,
      models: models.length > 0 ? models : OPENAI_DEFAULT_MODELS,
      isCloud: true,
    };
  } catch (err) {
    return {
      id: 'openai',
      name: 'OpenAI (cloud)',
      reachable: false,
      models: cfg.models ?? OPENAI_DEFAULT_MODELS,
      isCloud: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function openaiChat(
  cfg: ProviderConfig,
  model: string,
  messages: ChatMessage[],
  onToken: (t: string) => void,
): Promise<string> {
  if (!cfg.apiKey) throw new Error('OpenAI API key not set');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
    }),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenAI chat failed: HTTP ${res.status} ${text}`);
  }
  return readSse(res.body, onToken, (chunk) => {
    const c = chunk as { choices?: { delta?: { content?: string } }[] };
    const delta = c.choices?.[0]?.delta?.content;
    return typeof delta === 'string' ? delta : '';
  });
}

// ─── anthropic ─────────────────────────────────────────────────────

const ANTHROPIC_DEFAULT_MODELS = [
  'claude-3-5-sonnet-latest',
  'claude-3-5-haiku-latest',
  'claude-3-opus-latest',
  'claude-3-sonnet-latest',
  'claude-3-haiku-latest',
];

async function anthropicState(cfg: ProviderConfig): Promise<ProviderState> {
  if (!cfg.enabled || !cfg.apiKey) {
    return {
      id: 'anthropic',
      name: 'Anthropic (cloud)',
      reachable: false,
      models: [],
      isCloud: true,
      error: !cfg.enabled ? 'disabled' : 'no API key',
    };
  }
  // Anthropic's /v1/models endpoint exists; no extra cost to call it.
  try {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
      },
    });
    if (!res.ok) {
      return {
        id: 'anthropic',
        name: 'Anthropic (cloud)',
        reachable: false,
        models: cfg.models ?? ANTHROPIC_DEFAULT_MODELS,
        isCloud: true,
        error: `HTTP ${res.status}`,
      };
    }
    const body = (await res.json()) as { data: { id: string }[] };
    return {
      id: 'anthropic',
      name: 'Anthropic (cloud)',
      reachable: true,
      models: body.data.length > 0 ? body.data.map((m) => m.id) : ANTHROPIC_DEFAULT_MODELS,
      isCloud: true,
    };
  } catch (err) {
    return {
      id: 'anthropic',
      name: 'Anthropic (cloud)',
      reachable: false,
      models: cfg.models ?? ANTHROPIC_DEFAULT_MODELS,
      isCloud: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function anthropicChat(
  cfg: ProviderConfig,
  model: string,
  messages: ChatMessage[],
  onToken: (t: string) => void,
): Promise<string> {
  if (!cfg.apiKey) throw new Error('Anthropic API key not set');

  // Anthropic separates the system prompt from the message array.
  const systemMessages = messages.filter((m) => m.role === 'system').map((m) => m.content);
  const turns = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      system: systemMessages.join('\n\n'),
      messages: turns,
      max_tokens: 4096,
      stream: true,
    }),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(`Anthropic chat failed: HTTP ${res.status} ${text}`);
  }
  return readSse(res.body, onToken, (chunk) => {
    const c = chunk as { type?: string; delta?: { type?: string; text?: string } };
    if (c.type === 'content_block_delta' && c.delta?.type === 'text_delta') {
      return c.delta.text ?? '';
    }
    return '';
  });
}

// ─── openai-compatible (LM Studio, Together, OpenRouter, etc.) ─────

async function openaiCompatibleState(cfg: ProviderConfig): Promise<ProviderState> {
  if (!cfg.enabled || !cfg.baseUrl) {
    return {
      id: 'openai-compatible',
      name: 'OpenAI-compatible',
      reachable: false,
      models: [],
      isCloud: true,
      error: !cfg.enabled ? 'disabled' : 'no base URL',
    };
  }
  try {
    const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/models`, {
      headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
    });
    if (!res.ok) {
      return {
        id: 'openai-compatible',
        name: 'OpenAI-compatible',
        reachable: false,
        models: cfg.models ?? [],
        isCloud: true,
        error: `HTTP ${res.status}`,
      };
    }
    const body = (await res.json()) as { data?: { id: string }[] };
    return {
      id: 'openai-compatible',
      name: 'OpenAI-compatible',
      reachable: true,
      models: body.data?.map((m) => m.id) ?? cfg.models ?? [],
      isCloud: true,
    };
  } catch (err) {
    return {
      id: 'openai-compatible',
      name: 'OpenAI-compatible',
      reachable: false,
      models: cfg.models ?? [],
      isCloud: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function openaiCompatibleChat(
  cfg: ProviderConfig,
  model: string,
  messages: ChatMessage[],
  onToken: (t: string) => void,
): Promise<string> {
  if (!cfg.baseUrl) throw new Error('Base URL not set');
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
    }),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenAI-compatible chat failed: HTTP ${res.status} ${text}`);
  }
  return readSse(res.body, onToken, (chunk) => {
    const c = chunk as { choices?: { delta?: { content?: string } }[] };
    const delta = c.choices?.[0]?.delta?.content;
    return typeof delta === 'string' ? delta : '';
  });
}

// ─── shared SSE reader ─────────────────────────────────────────────

async function readSse(
  body: ReadableStream<Uint8Array>,
  onToken: (t: string) => void,
  extract: (chunk: Record<string, unknown>) => string,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const rawLine = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!rawLine || !rawLine.startsWith('data:')) continue;
      const data = rawLine.slice(5).trim();
      if (data === '[DONE]') return full;
      try {
        const parsed = JSON.parse(data);
        const token = extract(parsed);
        if (token) {
          full += token;
          onToken(token);
        }
      } catch {
        // ignore malformed line
      }
    }
  }
  return full;
}

// ─── public dispatch surface ───────────────────────────────────────

export async function listAllStates(): Promise<ProviderState[]> {
  const settings = settingsStore.load();
  const configs = loadConfigs();
  const ollamaCfg = configs.find((c) => c.id === 'ollama')!;
  const openaiCfg = configs.find((c) => c.id === 'openai')!;
  const anthropicCfg = configs.find((c) => c.id === 'anthropic')!;
  const compatCfg = configs.find((c) => c.id === 'openai-compatible')!;

  const results: ProviderState[] = [];
  if (ollamaCfg.enabled) results.push(await ollamaState());

  // Cloud providers only show up if the master toggle is on.
  if (settings.allowCloudModels) {
    if (openaiCfg.enabled) results.push(await openaiState(openaiCfg));
    if (anthropicCfg.enabled) results.push(await anthropicState(anthropicCfg));
    if (compatCfg.enabled) results.push(await openaiCompatibleState(compatCfg));
  }
  return results;
}

/**
 * Dispatches a chat call to the right provider. The model identifier can
 * be a bare model name (defaults to ollama) or a `provider:model` form.
 */
export async function chat(
  qualifiedModel: string,
  messages: ChatMessage[],
  onToken: (t: string) => void,
): Promise<string> {
  const { providerId, model } = parseQualified(qualifiedModel);
  const settings = settingsStore.load();

  if (providerId !== 'ollama' && !settings.allowCloudModels) {
    throw new Error(`Cloud provider "${providerId}" is disabled. Enable "Allow cloud models" in Settings → General.`);
  }
  if (providerId !== 'ollama' && !classroom.checkCloudAllowed()) {
    throw new Error('Cloud providers are disabled by your classroom policy.');
  }
  if (providerId !== 'ollama' && !isFeatureEnabled('cloud-providers')) {
    throw new Error('Cloud providers require PAiA Pro. Start a trial or activate a license in Settings → License.');
  }

  const configs = loadConfigs();
  const cfg = configs.find((c) => c.id === providerId);
  if (!cfg || !cfg.enabled) {
    throw new Error(`Provider "${providerId}" is disabled.`);
  }

  switch (providerId) {
    case 'ollama':
      return ollamaChat(model, messages, onToken);
    case 'openai':
      return openaiChat(cfg, model, messages, onToken);
    case 'anthropic':
      return anthropicChat(cfg, model, messages, onToken);
    case 'openai-compatible':
      return openaiCompatibleChat(cfg, model, messages, onToken);
    default:
      throw new Error(`Unknown provider: ${providerId}`);
  }
}

export function parseQualified(qualified: string): { providerId: ProviderId; model: string } {
  // `provider:model` — but model names themselves can contain colons
  // (`llama3.2:3b`). So we only treat the prefix as a provider id if
  // it matches one of our known providers.
  const known: ProviderId[] = ['ollama', 'openai', 'anthropic', 'openai-compatible'];
  for (const p of known) {
    const prefix = `${p}:`;
    if (qualified.startsWith(prefix)) {
      return { providerId: p, model: qualified.slice(prefix.length) };
    }
  }
  return { providerId: 'ollama', model: qualified };
}

export function qualify(providerId: ProviderId, model: string): string {
  return `${providerId}:${model}`;
}
