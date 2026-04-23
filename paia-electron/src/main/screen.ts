// Screen capture + OCR coordination.
//
// Capture goes through Electron's desktopCapturer (no extra deps).
// OCR uses tesseract.js, which loads its own WASM lazily on first use.
// All processing is local — no images leave the machine.

import { desktopCapturer, screen } from 'electron';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import type { CaptureSource, OcrResult } from '../shared/types';
import { logger } from './logger';

// Lazy-loaded tesseract worker.
type Worker = {
  recognize: (image: string | Buffer) => Promise<{ data: { text: string; confidence: number } }>;
  terminate: () => Promise<void>;
};

let workerPromise: Promise<Worker> | null = null;
let workerLang: string | null = null;

async function getOcrWorker(lang = 'eng'): Promise<Worker> {
  // If the cached worker is for a different language, tear it down so we
  // don't end up with N resident tesseract workers for multilingual users.
  if (workerPromise && workerLang !== lang) {
    const prev = workerPromise;
    workerPromise = null;
    workerLang = null;
    void prev.then((w) => w.terminate().catch(() => { /* ignore */ }));
  }
  if (workerPromise) return workerPromise;

  const p = (async () => {
    const tess = await import('tesseract.js');
    const cacheDir = path.join(app.getPath('userData'), 'tesseract-cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    const w = await tess.createWorker(lang, undefined, {
      cachePath: cacheDir,
      logger: (m: { status: string; progress: number }) => {
        if (m.status === 'recognizing text') return; // too noisy
        logger.info(`tesseract: ${m.status} ${(m.progress * 100).toFixed(0)}%`);
      },
    });
    return w as unknown as Worker;
  })();

  // Important: DON'T cache the in-flight promise until it resolves. Caching
  // it up-front means a transient init failure (network blip during the
  // traineddata download, AV holding the cache file open, etc.) poisons the
  // cache for the rest of the session — every subsequent OCR call re-raises
  // the same rejection. If init fails, clear state so the next call retries.
  workerPromise = p;
  workerLang = lang;
  try {
    const w = await p;
    return w;
  } catch (err) {
    workerPromise = null;
    workerLang = null;
    logger.error('tesseract worker init failed — cache cleared so next OCR call will retry', err);
    throw err;
  }
}

const OCR_TIMEOUT_MS = 45_000;

export async function listSources(): Promise<CaptureSource[]> {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
  });
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    thumbnail: s.thumbnail.toDataURL(),
  }));
}

export async function captureSource(sourceId: string): Promise<string> {
  // Use the largest reasonable thumbnail; Electron will scale internally.
  const display = screen.getPrimaryDisplay();
  const w = display.size.width;
  const h = display.size.height;
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: w, height: h },
  });
  const found = sources.find((s) => s.id === sourceId);
  if (!found) throw new Error(`Capture source not found: ${sourceId}`);
  return found.thumbnail.toDataURL();
}

/**
 * Captures the primary screen and returns a PNG data URL. Convenience for
 * the "ask about my screen" hotkey path.
 */
export async function capturePrimary(): Promise<string> {
  const all = await listSources();
  const primary = all.find((s) => s.id.startsWith('screen:')) ?? all[0];
  if (!primary) throw new Error('No capture sources available');
  return captureSource(primary.id);
}

/**
 * Runs Tesseract OCR on a base64 PNG (or any image data URL).
 * Returns plain text plus confidence.
 */
export async function ocrImage(dataUrl: string, lang = 'eng'): Promise<OcrResult> {
  const start = Date.now();
  const worker = await getOcrWorker(lang);
  // Guard against a stuck tesseract call hanging the whole agent loop.
  // We don't have a cancel signal for tesseract itself, so this is a
  // wall-clock escape hatch — the call may still complete in the
  // background, but the caller won't be blocked forever.
  const result = await Promise.race([
    worker.recognize(dataUrl),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`OCR timed out after ${OCR_TIMEOUT_MS}ms`)), OCR_TIMEOUT_MS),
    ),
  ]);
  return {
    text: result.data.text.trim(),
    confidence: result.data.confidence,
    durationMs: Date.now() - start,
  };
}

/**
 * Wipes the tesseract language-data cache. Intended for the Settings
 * "reset OCR" path when a download got wedged on first run and the
 * worker can't recover on its own. Safe to call at any time — the next
 * OCR attempt will re-download the traineddata file.
 */
export async function resetOcrCache(): Promise<void> {
  await shutdownOcr();
  const cacheDir = path.join(app.getPath('userData'), 'tesseract-cache');
  try {
    fs.rmSync(cacheDir, { recursive: true, force: true });
    logger.info('tesseract cache cleared');
  } catch (err) {
    logger.warn('failed to clear tesseract cache', err);
  }
}

export async function shutdownOcr(): Promise<void> {
  if (!workerPromise) return;
  try {
    const w = await workerPromise;
    await w.terminate();
  } catch {
    /* ignore */
  } finally {
    workerPromise = null;
  }
}
