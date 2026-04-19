// Ollama HTTP client. Talks to a local Ollama daemon (default
// http://127.0.0.1:11434). All traffic stays on the loopback interface.

import type {
  ChatMessage,
  OllamaModel,
  OllamaPullProgress,
  OllamaStatus,
} from './types';

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';

export class OllamaClient {
  constructor(private readonly baseUrl: string = DEFAULT_BASE_URL) {}

  async status(): Promise<OllamaStatus> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { method: 'GET' });
      if (!res.ok) {
        return { reachable: false, baseUrl: this.baseUrl, models: [], error: `HTTP ${res.status}` };
      }
      const body = (await res.json()) as { models?: OllamaModel[] };
      return { reachable: true, baseUrl: this.baseUrl, models: body.models ?? [] };
    } catch (err) {
      return {
        reachable: false,
        baseUrl: this.baseUrl,
        models: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async deleteModel(name: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Pulls a model from the Ollama library, streaming progress events.
   * The callback is invoked for every status line; the returned promise
   * resolves when the pull is complete.
   */
  async pullModel(
    name: string,
    onProgress?: (p: OllamaPullProgress) => void,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, stream: true }),
      signal,
    });
    if (!res.ok || !res.body) return false;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const chunk = JSON.parse(line) as OllamaPullProgress;
          onProgress?.(chunk);
        } catch {
          /* ignore malformed line */
        }
      }
    }
    return true;
  }

  /**
   * Streams a chat completion. The callback fires for every token chunk.
   * Returns the full assembled response when the stream finishes.
   *
   * Multimodal: if a message has `images`, those are sent through to
   * Ollama for vision-capable models (llava, bakllava, moondream).
   */
  async chat(
    model: string,
    messages: ChatMessage[],
    onToken?: (token: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true }),
      signal,
    });

    if (!res.ok || !res.body) {
      throw new Error(`Ollama chat failed: HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (!line) continue;
        try {
          const chunk = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
          const token = chunk.message?.content ?? '';
          if (token) {
            full += token;
            onToken?.(token);
          }
        } catch {
          /* skip malformed line */
        }
      }
    }

    return full;
  }
}
