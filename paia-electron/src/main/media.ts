// Image + (short) video generation dispatcher.
//
// Six pluggable providers:
//
//   openai         — DALL-E / gpt-image-1  (images)
//   stability      — Stability AI REST     (images + video)
//   replicate      — Replicate run API     (images + video; model id required)
//   fal            — fal.ai REST           (images + video)
//   comfyui        — local ComfyUI         (images, local-first)
//   automatic1111  — local A1111           (images, local-first)
//
// Configuration lives in `userData/media-providers.json` (separate from
// the LLM providers.json so we can have different keys). The media tools
// registered with the Agent simply dispatch into the right backend.
//
// Everything honours the classroom policy's `allowWebTools` /
// `allowCloudProviders` gates the same way the chat dispatcher does.

import { app, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type {
  MediaGenerateOptions,
  MediaGenerateResult,
  MediaProviderConfig,
  MediaProviderId,
  MediaProviderState,
} from '../shared/types';
import type { ToolDefinition } from '../shared/types';
import type { ToolHandler } from './tools';
import * as classroom from './classroom';
import { checkAndRecord } from './metering';
import { logger } from './logger';

// ─── persisted configs ────────────────────────────────────────────

function configPath(): string {
  return path.join(app.getPath('userData'), 'media-providers.json');
}

const DEFAULTS: MediaProviderConfig[] = [
  { id: 'openai', enabled: false, defaultModel: 'gpt-image-1' },
  { id: 'stability', enabled: false, defaultModel: 'stable-image-core' },
  { id: 'replicate', enabled: false },
  { id: 'fal', enabled: false },
  { id: 'comfyui', enabled: false, baseUrl: 'http://127.0.0.1:8188' },
  { id: 'automatic1111', enabled: false, baseUrl: 'http://127.0.0.1:7860' },
];

export function loadConfigs(): MediaProviderConfig[] {
  try {
    const raw = fs.readFileSync(configPath(), 'utf-8');
    const parsed = JSON.parse(raw) as MediaProviderConfig[];
    const merged: MediaProviderConfig[] = [];
    for (const def of DEFAULTS) {
      merged.push(parsed.find((p) => p.id === def.id) ?? def);
    }
    return merged;
  } catch {
    return DEFAULTS.slice();
  }
}

export function saveConfigs(list: MediaProviderConfig[]): void {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(list, null, 2));
}

function getCfg(id: MediaProviderId): MediaProviderConfig {
  return loadConfigs().find((c) => c.id === id)!;
}

// ─── provider adapters ────────────────────────────────────────────

async function generateOpenAI(cfg: MediaProviderConfig, opts: MediaGenerateOptions): Promise<MediaGenerateResult['items']> {
  if (!cfg.apiKey) throw new Error('OpenAI API key not set.');
  if (opts.kind === 'video') throw new Error('OpenAI image provider does not support video.');
  const body = {
    model: opts.model ?? cfg.defaultModel ?? 'gpt-image-1',
    prompt: opts.prompt,
    n: Math.min(opts.count ?? 1, 4),
    size: `${opts.width ?? 1024}x${opts.height ?? 1024}`,
    response_format: 'b64_json',
  };
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OpenAI images failed: HTTP ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { data: { b64_json?: string; url?: string }[] };
  return j.data.map((d) => ({
    dataUrl: d.b64_json ? `data:image/png;base64,${d.b64_json}` : undefined,
    url: d.url,
    mimeType: 'image/png',
  }));
}

async function generateStability(cfg: MediaProviderConfig, opts: MediaGenerateOptions): Promise<MediaGenerateResult['items']> {
  if (!cfg.apiKey) throw new Error('Stability API key not set.');
  if (opts.kind === 'image') {
    // Stability's REST v2beta core image endpoint — multipart/form-data.
    const form = new FormData();
    form.append('prompt', opts.prompt);
    if (opts.negativePrompt) form.append('negative_prompt', opts.negativePrompt);
    form.append('output_format', 'png');
    if (opts.seed !== undefined) form.append('seed', String(opts.seed));
    const res = await fetch('https://api.stability.ai/v2beta/stable-image/generate/core', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, Accept: 'image/*' },
      body: form,
    });
    if (!res.ok) throw new Error(`Stability failed: HTTP ${res.status} ${await res.text()}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return [{ dataUrl: `data:image/png;base64,${buf.toString('base64')}`, mimeType: 'image/png' }];
  }
  // Video (image-to-video): skipped in skeleton; would require a two-step call
  // (start + poll). We surface this clearly rather than stubbing it silently.
  throw new Error('Stability video generation is not wired yet — use Replicate or Fal for video.');
}

async function generateReplicate(cfg: MediaProviderConfig, opts: MediaGenerateOptions): Promise<MediaGenerateResult['items']> {
  if (!cfg.apiKey) throw new Error('Replicate API token not set.');
  const model = opts.model;
  if (!model) throw new Error('Replicate requires a model, e.g. "stability-ai/sdxl".');
  // The unified /v1/predictions endpoint. Polling loop until `succeeded`.
  const createRes = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Token ${cfg.apiKey}` },
    body: JSON.stringify({
      version: model,
      input: {
        prompt: opts.prompt,
        negative_prompt: opts.negativePrompt,
        width: opts.width, height: opts.height,
        num_outputs: opts.count ?? 1,
        seed: opts.seed,
      },
    }),
  });
  if (!createRes.ok) throw new Error(`Replicate create failed: HTTP ${createRes.status} ${await createRes.text()}`);
  const created = (await createRes.json()) as { urls: { get: string }; id: string };
  const getUrl = created.urls.get;
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const pollRes = await fetch(getUrl, { headers: { Authorization: `Token ${cfg.apiKey}` } });
    if (!pollRes.ok) continue;
    const status = (await pollRes.json()) as { status: string; output?: string | string[] };
    if (status.status === 'succeeded') {
      const outs = Array.isArray(status.output) ? status.output : status.output ? [status.output] : [];
      return outs.map((u) => ({
        url: u,
        mimeType: opts.kind === 'video' ? 'video/mp4' : 'image/png',
      }));
    }
    if (status.status === 'failed' || status.status === 'canceled') {
      throw new Error(`Replicate ${status.status}`);
    }
  }
  throw new Error('Replicate polling timed out after 4 minutes.');
}

async function generateFal(cfg: MediaProviderConfig, opts: MediaGenerateOptions): Promise<MediaGenerateResult['items']> {
  if (!cfg.apiKey) throw new Error('Fal API key not set.');
  const model = opts.model ?? cfg.defaultModel ?? 'fal-ai/flux-pro';
  const res = await fetch(`https://fal.run/${model}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Key ${cfg.apiKey}` },
    body: JSON.stringify({
      prompt: opts.prompt,
      negative_prompt: opts.negativePrompt,
      image_size: opts.width && opts.height ? `${opts.width}x${opts.height}` : 'landscape_4_3',
      num_images: opts.count ?? 1,
      seed: opts.seed,
    }),
  });
  if (!res.ok) throw new Error(`Fal failed: HTTP ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { images?: { url: string; content_type?: string }[]; video?: { url: string } };
  if (j.video) return [{ url: j.video.url, mimeType: 'video/mp4' }];
  return (j.images ?? []).map((im) => ({
    url: im.url,
    mimeType: im.content_type ?? 'image/png',
  }));
}

async function generateAutomatic1111(cfg: MediaProviderConfig, opts: MediaGenerateOptions): Promise<MediaGenerateResult['items']> {
  if (!cfg.baseUrl) throw new Error('A1111 base URL not set.');
  if (opts.kind === 'video') throw new Error('A1111 backend is image-only here.');
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/sdapi/v1/txt2img`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: opts.prompt,
      negative_prompt: opts.negativePrompt ?? '',
      width: opts.width ?? 512,
      height: opts.height ?? 512,
      steps: 24,
      batch_size: opts.count ?? 1,
      seed: opts.seed ?? -1,
    }),
  });
  if (!res.ok) throw new Error(`A1111 failed: HTTP ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { images: string[] };
  return j.images.map((b64) => ({ dataUrl: `data:image/png;base64,${b64}`, mimeType: 'image/png' }));
}

// ComfyUI workflow invocation.
//
// ComfyUI runs a node-graph workflow. For text-to-image we ship a minimal
// default graph (6 nodes: checkpoint loader, positive / negative CLIP,
// empty latent, KSampler, VAE decode, SaveImage). If the user has saved
// a custom workflow JSON at `userData/comfyui-workflow.json`, we load
// that instead and substitute known placeholder strings for the runtime
// parameters.
//
// Substitution placeholders the user can put in their workflow JSON:
//   "$PROMPT$"     → opts.prompt
//   "$NEGATIVE$"   → opts.negativePrompt ?? ""
//   "$WIDTH$"      → opts.width ?? 512  (number)
//   "$HEIGHT$"     → opts.height ?? 512 (number)
//   "$SEED$"       → opts.seed ?? random
//   "$BATCH$"      → opts.count ?? 1    (number)
//
// We POST the final graph to /prompt, then poll /history/<id> until
// outputs appear, then download each image from /view.

function buildDefaultComfyGraph(opts: MediaGenerateOptions, ckpt: string): Record<string, unknown> {
  const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 32);
  return {
    '3': { class_type: 'KSampler', inputs: {
      seed, steps: 20, cfg: 7, sampler_name: 'euler',
      scheduler: 'normal', denoise: 1,
      model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0],
    }},
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
    '5': { class_type: 'EmptyLatentImage', inputs: {
      width: opts.width ?? 512, height: opts.height ?? 512, batch_size: opts.count ?? 1,
    }},
    '6': { class_type: 'CLIPTextEncode', inputs: { text: opts.prompt, clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: opts.negativePrompt ?? '', clip: ['4', 1] } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'paia', images: ['8', 0] } },
  };
}

function substitutePlaceholders(graph: unknown, opts: MediaGenerateOptions): unknown {
  const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 32);
  const replacements: Record<string, string | number> = {
    '$PROMPT$': opts.prompt,
    '$NEGATIVE$': opts.negativePrompt ?? '',
    '$WIDTH$': opts.width ?? 512,
    '$HEIGHT$': opts.height ?? 512,
    '$SEED$': seed,
    '$BATCH$': opts.count ?? 1,
  };
  function walk(v: unknown): unknown {
    if (typeof v === 'string') {
      const exact = Object.prototype.hasOwnProperty.call(replacements, v) ? replacements[v] : undefined;
      if (exact !== undefined) return exact;
      let out = v;
      for (const k of Object.keys(replacements)) {
        out = out.split(k).join(String(replacements[k]));
      }
      return out;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) o[k] = walk(val);
      return o;
    }
    return v;
  }
  return walk(graph);
}

function userWorkflowPath(): string {
  // Deferred import; keeps the top of the file independent of electron
  // internals for testing.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const electron = require('electron') as typeof import('electron');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pathMod = require('path') as typeof import('path');
  return pathMod.join(electron.app.getPath('userData'), 'comfyui-workflow.json');
}

async function generateComfyUI(cfg: MediaProviderConfig, opts: MediaGenerateOptions): Promise<MediaGenerateResult['items']> {
  if (!cfg.baseUrl) throw new Error('ComfyUI base URL not set.');
  if (opts.kind === 'video') throw new Error('ComfyUI backend here is image-only.');
  const base = cfg.baseUrl.replace(/\/$/, '');

  // Prefer the user's custom workflow if they've saved one.
  let graph: Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fsMod = require('fs') as typeof import('fs');
  const customPath = userWorkflowPath();
  if (fsMod.existsSync(customPath)) {
    try {
      const raw = fsMod.readFileSync(customPath, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      graph = substitutePlaceholders(parsed, opts) as Record<string, unknown>;
    } catch (err) {
      throw new Error(`Failed to parse ${customPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    const ckpt = opts.model ?? cfg.defaultModel ?? 'v1-5-pruned-emaonly.safetensors';
    graph = buildDefaultComfyGraph(opts, ckpt);
  }

  // 1. Submit the graph.
  const clientId = `paia-${Math.random().toString(36).slice(2, 10)}`;
  const queueRes = await fetch(`${base}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: clientId }),
  });
  if (!queueRes.ok) throw new Error(`ComfyUI /prompt failed: HTTP ${queueRes.status} ${await queueRes.text()}`);
  const queued = (await queueRes.json()) as { prompt_id?: string; error?: unknown };
  if (!queued.prompt_id) throw new Error(`ComfyUI queue returned no prompt_id: ${JSON.stringify(queued)}`);

  // 2. Poll /history/<id> until outputs exist.
  const deadline = Date.now() + 3 * 60 * 1000;
  let outputs: Record<string, unknown> | null = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const hr = await fetch(`${base}/history/${queued.prompt_id}`);
    if (!hr.ok) continue;
    const hist = (await hr.json()) as Record<string, { outputs?: Record<string, unknown> }>;
    const run = hist[queued.prompt_id];
    if (run && run.outputs && Object.keys(run.outputs).length > 0) {
      outputs = run.outputs;
      break;
    }
  }
  if (!outputs) throw new Error('ComfyUI run did not produce outputs within 3 minutes.');

  // 3. Walk outputs; any {images: [{filename, subfolder, type}, ...]} is ours.
  const items: MediaGenerateResult['items'] = [];
  for (const nodeOut of Object.values(outputs)) {
    const maybe = nodeOut as { images?: { filename: string; subfolder: string; type: string }[] };
    if (!maybe.images) continue;
    for (const img of maybe.images) {
      const params = new URLSearchParams({
        filename: img.filename,
        subfolder: img.subfolder ?? '',
        type: img.type ?? 'output',
      });
      const imgRes = await fetch(`${base}/view?${params.toString()}`);
      if (!imgRes.ok) continue;
      const buf = Buffer.from(await imgRes.arrayBuffer());
      items.push({ dataUrl: `data:image/png;base64,${buf.toString('base64')}`, mimeType: 'image/png' });
    }
  }
  if (items.length === 0) throw new Error('ComfyUI produced no SaveImage outputs. Check your workflow JSON.');
  return items;
}

// ─── public API ───────────────────────────────────────────────────

export async function generate(opts: MediaGenerateOptions): Promise<MediaGenerateResult> {
  const policy = classroom.currentPolicy();
  if (policy && !policy.allowWebTools) {
    throw new Error('Media generation is disabled by your classroom policy.');
  }
  checkAndRecord('media-generate');
  const cfg = getCfg(opts.provider);
  if (!cfg.enabled) throw new Error(`Provider "${opts.provider}" is disabled.`);
  const t0 = Date.now();
  let items: MediaGenerateResult['items'];
  switch (opts.provider) {
    case 'openai': items = await generateOpenAI(cfg, opts); break;
    case 'stability': items = await generateStability(cfg, opts); break;
    case 'replicate': items = await generateReplicate(cfg, opts); break;
    case 'fal': items = await generateFal(cfg, opts); break;
    case 'comfyui': items = await generateComfyUI(cfg, opts); break;
    case 'automatic1111': items = await generateAutomatic1111(cfg, opts); break;
    default: throw new Error(`Unknown provider: ${opts.provider as string}`);
  }
  logger.info(`media.generate: ${opts.provider}/${opts.kind} → ${items.length} item(s) in ${Date.now() - t0}ms`);
  return {
    provider: opts.provider,
    kind: opts.kind,
    items,
    durationMs: Date.now() - t0,
  };
}

export function listProviderStates(): MediaProviderState[] {
  return loadConfigs().map<MediaProviderState>((c) => {
    const labels: Record<MediaProviderId, { name: string; supports: ('image' | 'video')[] }> = {
      openai: { name: 'OpenAI images', supports: ['image'] },
      stability: { name: 'Stability AI', supports: ['image', 'video'] },
      replicate: { name: 'Replicate', supports: ['image', 'video'] },
      fal: { name: 'fal.ai', supports: ['image', 'video'] },
      comfyui: { name: 'ComfyUI (local)', supports: ['image'] },
      automatic1111: { name: 'Automatic1111 (local)', supports: ['image'] },
    };
    const l = labels[c.id];
    const configured = c.enabled && (!!c.apiKey || !!c.baseUrl);
    return {
      id: c.id,
      name: l.name,
      supports: l.supports,
      configured,
      status: !c.enabled ? 'disabled'
        : !configured ? (c.baseUrl !== undefined ? 'base URL not set' : 'API key not set')
        : 'ready',
    };
  });
}

// ─── tool handlers registered into the Agent ─────────────────────

function def(name: string, description: string, risk: ToolDefinition['risk'], schema: unknown): ToolDefinition {
  return { name, description, category: 'web', risk, inputSchema: schema };
}

export const mediaTools: ToolHandler[] = [
  {
    definition: def('image.generate', 'Generate an image from a text prompt. Choose a configured provider with `provider` (openai|stability|replicate|fal|comfyui|automatic1111).', 'low', {
      type: 'object',
      properties: {
        provider: { type: 'string' },
        prompt: { type: 'string' },
        negativePrompt: { type: 'string' },
        model: { type: 'string' },
        width: { type: 'number' },
        height: { type: 'number' },
        count: { type: 'number' },
        seed: { type: 'number' },
      },
      required: ['provider', 'prompt'],
    }),
    execute: async (args) => {
      const result = await generate({
        provider: args.provider as MediaProviderId,
        kind: 'image',
        prompt: String(args.prompt),
        negativePrompt: typeof args.negativePrompt === 'string' ? args.negativePrompt : undefined,
        model: typeof args.model === 'string' ? args.model : undefined,
        width: typeof args.width === 'number' ? args.width : undefined,
        height: typeof args.height === 'number' ? args.height : undefined,
        count: typeof args.count === 'number' ? args.count : undefined,
        seed: typeof args.seed === 'number' ? args.seed : undefined,
      });
      return JSON.stringify(
        {
          provider: result.provider,
          durationMs: result.durationMs,
          items: result.items.map((i) => ({ url: i.url, dataUrlPreview: i.dataUrl ? `[base64 ${i.dataUrl.length} chars]` : undefined })),
        },
        null, 2,
      );
    },
  },
  {
    definition: def('video.generate', 'Generate a short video clip from a text prompt. Providers that support video: stability, replicate, fal.', 'low', {
      type: 'object',
      properties: {
        provider: { type: 'string' },
        prompt: { type: 'string' },
        model: { type: 'string' },
        seed: { type: 'number' },
      },
      required: ['provider', 'prompt'],
    }),
    execute: async (args) => {
      const result = await generate({
        provider: args.provider as MediaProviderId,
        kind: 'video',
        prompt: String(args.prompt),
        model: typeof args.model === 'string' ? args.model : undefined,
        seed: typeof args.seed === 'number' ? args.seed : undefined,
      });
      return JSON.stringify({
        provider: result.provider,
        durationMs: result.durationMs,
        items: result.items,
      }, null, 2);
    },
  },
];

// ─── IPC ──────────────────────────────────────────────────────────

ipcMain.handle('paia:media-list-providers', () => listProviderStates());
ipcMain.handle('paia:media-load-configs', () => loadConfigs());
ipcMain.handle('paia:media-save-configs', (_e, list: MediaProviderConfig[]) => { saveConfigs(list); return loadConfigs(); });
ipcMain.handle('paia:media-generate', async (_e, opts: MediaGenerateOptions) => {
  try {
    return { ok: true, result: await generate(opts) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});
