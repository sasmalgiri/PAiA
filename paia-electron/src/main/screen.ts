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

async function getOcrWorker(lang = 'eng'): Promise<Worker> {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
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
  return workerPromise;
}

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
  const { data } = await worker.recognize(dataUrl);
  return {
    text: data.text.trim(),
    confidence: data.confidence,
    durationMs: Date.now() - start,
  };
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
