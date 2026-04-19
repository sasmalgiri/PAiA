// Wake-word detection via Picovoice Porcupine.
//
// Picovoice's commercial license requires an access key per user.
// PAiA does NOT bundle a key — each user supplies their own (free for
// personal use, paid for commercial). To honor that:
//
//   1. We import @picovoice/porcupine-node DYNAMICALLY. If the package
//      isn't installed (the default — we don't list it as a dep to
//      keep the install footprint zero for users who never want this
//      feature), the wake-word path becomes a clean no-op with a
//      "package not installed" status the UI can show.
//
//   2. We never run unless settings.wakeWordEnabled === true AND
//      settings.wakeWordAccessKey is non-empty.
//
//   3. We use the built-in keywords (computer, jarvis, alexa, etc.)
//      since they don't need any extra files. Custom .ppn keywords are
//      a Phase-4 polish.
//
//   4. The mic stream lives in a child process via the
//      @picovoice/pvrecorder-node package, which is also imported
//      dynamically.
//
// The CPU cost of always-on listening is 5–15% of one core. We surface
// that warning in the UI so users opt in with their eyes open.

import * as settingsStore from './settings';
import type { WakeWordState } from '../shared/types';
import { logger } from './logger';

export const BUILTIN_KEYWORDS = [
  'alexa',
  'americano',
  'blueberry',
  'bumblebee',
  'computer',
  'grapefruit',
  'grasshopper',
  'hey google',
  'hey siri',
  'jarvis',
  'ok google',
  'picovoice',
  'porcupine',
  'terminator',
];

interface PorcupineLike {
  process(frame: Int16Array): number;
  release(): void;
  frameLength: number;
  sampleRate: number;
}
interface PvRecorderLike {
  start(): void;
  stop(): void;
  read(): Promise<Int16Array>;
  release(): void;
}

let porcupine: PorcupineLike | null = null;
let recorder: PvRecorderLike | null = null;
let listening = false;
let lastError: string | undefined;
let lastState: WakeWordState = { status: 'disabled', keyword: '' };

export function status(): WakeWordState {
  const settings = settingsStore.load();
  if (!settings.wakeWordEnabled) {
    return { status: 'disabled', keyword: settings.wakeWordKeyword || '' };
  }
  if (!settings.wakeWordAccessKey) {
    return { status: 'no-key', keyword: settings.wakeWordKeyword || '' };
  }
  return lastState;
}

/**
 * Start the wake-word detector if the user has enabled it AND supplied
 * an access key. The supplied callback fires every time a wake word
 * is detected.
 */
export async function startIfEnabled(onDetected: () => void): Promise<void> {
  const settings = settingsStore.load();
  if (!settings.wakeWordEnabled) return;
  if (!settings.wakeWordAccessKey) {
    lastState = { status: 'no-key', keyword: settings.wakeWordKeyword };
    return;
  }

  // Lazy import — package may not be installed. We use an indirect
  // require so TypeScript doesn't try to resolve the module at compile
  // time. The two Picovoice packages are intentionally NOT listed in
  // package.json — installing them is a manual opt-in step for users
  // who have a Picovoice license.
  let porcupineModule: { Porcupine: new (key: string, keywords: string[], sensitivities: number[]) => PorcupineLike; BuiltinKeyword: Record<string, string> };
  let recorderModule: { PvRecorder: new (frameLength: number, deviceIndex: number) => PvRecorderLike };
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dynRequire = eval('require') as NodeRequire;
    porcupineModule = dynRequire('@picovoice/porcupine-node') as typeof porcupineModule;
    recorderModule = dynRequire('@picovoice/pvrecorder-node') as typeof recorderModule;
  } catch (err) {
    logger.warn('wake word: porcupine package not installed (this is fine — feature is opt-in)');
    lastState = {
      status: 'no-package',
      keyword: settings.wakeWordKeyword,
      error:
        'The Picovoice Porcupine package is not bundled with PAiA. To enable wake word, run: npm install @picovoice/porcupine-node @picovoice/pvrecorder-node',
    };
    return;
  }

  try {
    const keyword = settings.wakeWordKeyword || 'computer';
    if (!BUILTIN_KEYWORDS.includes(keyword)) {
      throw new Error(`Unknown built-in keyword: ${keyword}`);
    }
    porcupine = new porcupineModule.Porcupine(
      settings.wakeWordAccessKey,
      [keyword],
      [0.5],
    );
    recorder = new recorderModule.PvRecorder(porcupine.frameLength, -1);
    recorder.start();
    listening = true;
    lastState = { status: 'running', keyword };
    logger.info(`wake word: listening for "${keyword}"`);

    // Run the detection loop in the background.
    void runLoop(onDetected);
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    logger.error('wake word init failed', lastError);
    lastState = {
      status: 'error',
      keyword: settings.wakeWordKeyword,
      error: lastError,
    };
    await stop();
  }
}

async function runLoop(onDetected: () => void): Promise<void> {
  while (listening && porcupine && recorder) {
    try {
      const frame = await recorder.read();
      const idx = porcupine.process(frame);
      if (idx >= 0) {
        logger.info('wake word: triggered');
        onDetected();
        // Brief pause so we don't double-fire on the same utterance.
        await new Promise((r) => setTimeout(r, 1500));
      }
    } catch (err) {
      logger.error('wake word loop error', err);
      lastError = err instanceof Error ? err.message : String(err);
      lastState = { status: 'error', keyword: lastState.keyword, error: lastError };
      break;
    }
  }
}

export async function stop(): Promise<void> {
  listening = false;
  try {
    recorder?.stop();
    recorder?.release();
  } catch {
    /* ignore */
  }
  try {
    porcupine?.release();
  } catch {
    /* ignore */
  }
  recorder = null;
  porcupine = null;
}

export async function restart(onDetected: () => void): Promise<void> {
  await stop();
  await startIfEnabled(onDetected);
}
