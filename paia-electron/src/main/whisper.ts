// Offline speech-to-text using Whisper via @huggingface/transformers.
//
// The model is lazy-loaded the first time transcribe() is called and then
// cached in memory for the lifetime of the process. The first call also
// downloads the model weights into the user data cache (a few hundred MB
// for whisper-tiny / whisper-base) — after that, everything runs locally.
//
// We accept raw 16 kHz mono Float32Array PCM from the renderer (captured
// via AudioContext, see renderer.ts), so no audio decoding is needed here.
//
// Streaming: transcribeStream() fires `paia:whisper-token` events on the
// active window as the decoder emits each token, followed by a final
// `paia:whisper-done`. Lets the renderer paint a live transcript while
// Whisper is still running.

import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { randomUUID } from 'crypto';

// Loaded dynamically so the cost (and any optional native deps) only happen
// when the user actually selects the whisper engine.
interface StreamerLike {
  on_finalized_text: (cb: (text: string) => void) => void;
}

type AsrPipeline = ((
  audio: Float32Array,
  options?: {
    language?: string;
    task?: 'transcribe' | 'translate';
    return_timestamps?: boolean;
    chunk_length_s?: number;
    stride_length_s?: number;
    streamer?: StreamerLike;
  },
) => Promise<{ text: string } | { text: string }[]>) & {
  tokenizer?: unknown;
};

let pipelinePromise: Promise<AsrPipeline> | null = null;
let loadedModelId: string | null = null;

// whisper-tiny is ~75 MB, fast on CPU, English-focused but multilingual
// works passably. Bump to whisper-base (~150 MB) for better accuracy.
const DEFAULT_MODEL = 'Xenova/whisper-tiny';

function emitProgress(payload: {
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
  status: string;
}): void {
  // Routed through the same activeWindow as transcribe-stream events;
  // setActiveWindow is defined further down.
  if (!activeWindow || activeWindow.isDestroyed()) return;
  activeWindow.webContents.send('paia:whisper-download-progress', payload);
}

async function getPipeline(modelId: string): Promise<AsrPipeline> {
  if (pipelinePromise && loadedModelId === modelId) return pipelinePromise;

  loadedModelId = modelId;
  pipelinePromise = (async () => {
    const transformers = await import('@huggingface/transformers');

    // Cache model files inside our userData dir so they survive across
    // upgrades and don't pollute the user's home directory.
    const cacheDir = path.join(app.getPath('userData'), 'transformers-cache');
    transformers.env.cacheDir = cacheDir;
    // We don't want the library to look for models inside the asar bundle.
    transformers.env.allowLocalModels = false;
    transformers.env.allowRemoteModels = true;

    // Forward model-file download progress to the renderer so the user
    // can see a progress bar on the ~75 MB first-run download instead
    // of staring at a silent mic button.
    const pipe = await transformers.pipeline('automatic-speech-recognition', modelId, {
      progress_callback: (p: {
        status?: string;
        file?: string;
        progress?: number;
        loaded?: number;
        total?: number;
      }) => {
        emitProgress({
          status: p.status ?? 'downloading',
          file: p.file,
          progress: typeof p.progress === 'number' ? p.progress : undefined,
          loaded: p.loaded,
          total: p.total,
        });
      },
    } as unknown as Record<string, unknown>);
    emitProgress({ status: 'ready' });
    return pipe as unknown as AsrPipeline;
  })();

  return pipelinePromise;
}

export interface TranscribeOptions {
  modelId?: string;
  language?: string; // BCP-47-ish; transformers expects English names like 'english', 'hindi'
}

// Convert a BCP-47 tag like 'en-US' to the language string Whisper expects.
function toWhisperLang(bcp47: string | undefined): string | undefined {
  if (!bcp47) return undefined;
  const base = bcp47.toLowerCase().split('-')[0];
  const map: Record<string, string> = {
    en: 'english',
    es: 'spanish',
    fr: 'french',
    de: 'german',
    it: 'italian',
    pt: 'portuguese',
    nl: 'dutch',
    ru: 'russian',
    zh: 'chinese',
    ja: 'japanese',
    ko: 'korean',
    hi: 'hindi',
    ar: 'arabic',
    tr: 'turkish',
    pl: 'polish',
  };
  return map[base];
}

export async function transcribe(
  pcm: Float32Array,
  opts: TranscribeOptions = {},
): Promise<string> {
  if (!pcm || pcm.length === 0) return '';

  const modelId = opts.modelId ?? DEFAULT_MODEL;
  const pipe = await getPipeline(modelId);

  const result = await pipe(pcm, {
    language: toWhisperLang(opts.language),
    task: 'transcribe',
    chunk_length_s: 30,
    stride_length_s: 5,
  });

  if (Array.isArray(result)) {
    return result.map((r) => r.text).join(' ').trim();
  }
  return (result.text ?? '').trim();
}

/**
 * Returns true if the whisper pipeline has been instantiated already
 * (so the renderer can show "loading model…" only on the first call).
 */
export function isReady(): boolean {
  return pipelinePromise !== null;
}

// ─── streaming transcription ──────────────────────────────────────
//
// @huggingface/transformers ships a TextStreamer that fires a callback
// every time the decoder finalises a new chunk of text. We pass it to
// pipeline(), forward every chunk over IPC as `paia:whisper-token`, and
// close with `paia:whisper-done` when the decoder is finished.
//
// On older / smaller models the streamer sometimes isn't exported; we
// fall back to the single-shot path in that case so the caller still
// gets a result.

let activeWindow: BrowserWindow | null = null;
export function setActiveWindow(win: BrowserWindow): void {
  activeWindow = win;
}

function emit(channel: string, payload: unknown): void {
  activeWindow?.webContents.send(channel, payload);
}

export async function transcribeStream(
  pcm: Float32Array,
  opts: TranscribeOptions & { streamId?: string } = {},
): Promise<{ streamId: string; text: string }> {
  if (!pcm || pcm.length === 0) return { streamId: opts.streamId ?? '', text: '' };
  const streamId = opts.streamId ?? randomUUID();

  const modelId = opts.modelId ?? DEFAULT_MODEL;
  const pipe = await getPipeline(modelId);
  let fullText = '';

  // Try to build a TextStreamer; if the export isn't there on this
  // version, fall through to the non-streaming path and emit a single
  // final token event so the UI still works.
  let streamer: StreamerLike | undefined;
  try {
    const transformers = await import('@huggingface/transformers');
    const TextStreamerCtor = (transformers as unknown as { TextStreamer?: new (tokenizer: unknown, opts: { skip_prompt?: boolean; callback_function?: (t: string) => void }) => StreamerLike }).TextStreamer;
    if (TextStreamerCtor && pipe.tokenizer) {
      streamer = new TextStreamerCtor(pipe.tokenizer, {
        skip_prompt: true,
        callback_function: (chunk: string) => {
          if (!chunk) return;
          fullText += chunk;
          emit('paia:whisper-token', { streamId, token: chunk });
        },
      });
    }
  } catch {
    streamer = undefined;
  }

  try {
    const result = await pipe(pcm, {
      language: toWhisperLang(opts.language),
      task: 'transcribe',
      chunk_length_s: 30,
      stride_length_s: 5,
      streamer,
    });
    const finalText = Array.isArray(result)
      ? result.map((r) => r.text).join(' ').trim()
      : (result.text ?? '').trim();
    if (!streamer) {
      fullText = finalText;
      if (finalText) emit('paia:whisper-token', { streamId, token: finalText });
    }
    emit('paia:whisper-done', { streamId, text: fullText.trim() || finalText });
    return { streamId, text: fullText.trim() || finalText };
  } catch (err) {
    emit('paia:whisper-done', { streamId, text: fullText, error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

// ─── IPC ──────────────────────────────────────────────────────────

ipcMain.handle('paia:transcribe-stream', async (_e, payload: { pcm: Float32Array; lang?: string; streamId?: string }) => {
  try {
    return { ok: true, ...(await transcribeStream(payload.pcm, { language: payload.lang, streamId: payload.streamId })) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});
