// Local TTS via Piper (https://github.com/rhasspy/piper).
//
// Why a sidecar instead of the OS speech synthesizer:
//   - Piper voices are dramatically better than SAPI/NSSpeechSynthesizer
//   - Fully offline once the model is cached
//   - Cross-platform identical voice quality
//
// Why lazy download instead of bundling:
//   - Piper binary itself is 6–25 MB depending on platform
//   - Each voice model is 30–60 MB
//   - Bundling both would balloon the installer for a feature
//     not everyone uses
//   - The Whisper STT path follows the same pattern (lazy download
//     into userData/) so this is consistent
//
// On first use we:
//   1. Download the platform-appropriate Piper binary from the official
//      GitHub Releases zip/tar.gz, extract to userData/piper/bin
//   2. Download the user's chosen voice model + JSON config to
//      userData/piper/voices/<voice-id>/
//   3. Spawn the binary with --model <path> --output_raw, pipe text in,
//      collect raw 16kHz mono S16LE PCM out, hand it to the renderer
//      to wrap in a WAV header and play

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import type { PiperDownloadProgress, PiperStatus, PiperVoice } from '../shared/types';
import { logger } from './logger';

// ─── known voices ──────────────────────────────────────────────────
//
// A small curated list. Users can grab any voice from
// https://github.com/rhasspy/piper/blob/master/VOICES.md by adding
// entries here. The URLs follow Hugging Face's piper-voices repo
// layout.

const HF_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main';

export const PIPER_VOICES: PiperVoice[] = [
  {
    id: 'en_US-amy-medium',
    name: 'Amy (English US)',
    language: 'en_US',
    quality: 'medium',
    sizeBytes: 63 * 1024 * 1024,
    modelUrl: `${HF_BASE}/en/en_US/amy/medium/en_US-amy-medium.onnx`,
    configUrl: `${HF_BASE}/en/en_US/amy/medium/en_US-amy-medium.onnx.json`,
  },
  {
    id: 'en_US-ryan-medium',
    name: 'Ryan (English US)',
    language: 'en_US',
    quality: 'medium',
    sizeBytes: 63 * 1024 * 1024,
    modelUrl: `${HF_BASE}/en/en_US/ryan/medium/en_US-ryan-medium.onnx`,
    configUrl: `${HF_BASE}/en/en_US/ryan/medium/en_US-ryan-medium.onnx.json`,
  },
  {
    id: 'en_GB-alan-medium',
    name: 'Alan (English UK)',
    language: 'en_GB',
    quality: 'medium',
    sizeBytes: 63 * 1024 * 1024,
    modelUrl: `${HF_BASE}/en/en_GB/alan/medium/en_GB-alan-medium.onnx`,
    configUrl: `${HF_BASE}/en/en_GB/alan/medium/en_GB-alan-medium.onnx.json`,
  },
  {
    id: 'es_ES-davefx-medium',
    name: 'Davefx (Spanish)',
    language: 'es_ES',
    quality: 'medium',
    sizeBytes: 63 * 1024 * 1024,
    modelUrl: `${HF_BASE}/es/es_ES/davefx/medium/es_ES-davefx-medium.onnx`,
    configUrl: `${HF_BASE}/es/es_ES/davefx/medium/es_ES-davefx-medium.onnx.json`,
  },
  {
    id: 'fr_FR-siwis-medium',
    name: 'Siwis (French)',
    language: 'fr_FR',
    quality: 'medium',
    sizeBytes: 63 * 1024 * 1024,
    modelUrl: `${HF_BASE}/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx`,
    configUrl: `${HF_BASE}/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx.json`,
  },
  {
    id: 'de_DE-thorsten-medium',
    name: 'Thorsten (German)',
    language: 'de_DE',
    quality: 'medium',
    sizeBytes: 63 * 1024 * 1024,
    modelUrl: `${HF_BASE}/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx`,
    configUrl: `${HF_BASE}/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx.json`,
  },
  {
    id: 'hi_IN-priyamvada-medium',
    name: 'Priyamvada (Hindi)',
    language: 'hi_IN',
    quality: 'medium',
    sizeBytes: 63 * 1024 * 1024,
    modelUrl: `${HF_BASE}/hi/hi_IN/priyamvada/medium/hi_IN-priyamvada-medium.onnx`,
    configUrl: `${HF_BASE}/hi/hi_IN/priyamvada/medium/hi_IN-priyamvada-medium.onnx.json`,
  },
];

// ─── paths ─────────────────────────────────────────────────────────

function piperRoot(): string {
  return path.join(app.getPath('userData'), 'piper');
}
function binaryDir(): string {
  return path.join(piperRoot(), 'bin');
}
function voiceDir(voiceId: string): string {
  return path.join(piperRoot(), 'voices', voiceId);
}
function binaryPath(): string {
  const exe = process.platform === 'win32' ? 'piper.exe' : 'piper';
  return path.join(binaryDir(), exe);
}

// ─── status ────────────────────────────────────────────────────────

export function status(): PiperStatus {
  const installed = fs.existsSync(binaryPath());
  const installedVoices: string[] = [];
  try {
    if (fs.existsSync(path.join(piperRoot(), 'voices'))) {
      for (const id of fs.readdirSync(path.join(piperRoot(), 'voices'))) {
        if (fs.existsSync(path.join(voiceDir(id), `${id}.onnx`))) {
          installedVoices.push(id);
        }
      }
    }
  } catch {
    /* ignore */
  }
  return {
    binaryInstalled: installed,
    binaryPath: installed ? binaryPath() : undefined,
    installedVoices,
    cacheDir: piperRoot(),
  };
}

// ─── download helpers ──────────────────────────────────────────────

function piperBinaryUrl(): string {
  // Maps to the v1.2.0 release assets, which are the latest as of writing.
  // Update this when Piper publishes a new release.
  const base = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2';
  switch (process.platform) {
    case 'win32':
      return `${base}/piper_windows_amd64.zip`;
    case 'darwin':
      return os.arch() === 'arm64'
        ? `${base}/piper_macos_aarch64.tar.gz`
        : `${base}/piper_macos_x64.tar.gz`;
    case 'linux':
      return os.arch() === 'arm64'
        ? `${base}/piper_linux_aarch64.tar.gz`
        : `${base}/piper_linux_x86_64.tar.gz`;
    default:
      throw new Error(`Unsupported platform for Piper: ${process.platform}`);
  }
}

async function streamDownload(
  url: string,
  destPath: string,
  onProgress?: (bytesRead: number, totalBytes: number) => void,
): Promise<void> {
  // Voice models can be hundreds of MB; a 10-minute cap still catches
  // a dead connection without killing slow-link downloads prematurely.
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(600_000) });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: ${url} → HTTP ${res.status}`);
  }
  const totalHeader = res.headers.get('content-length');
  const total = totalHeader ? parseInt(totalHeader, 10) : 0;
  let read = 0;

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const fileStream = fs.createWriteStream(destPath);

  // Wrap the web stream so we can track bytes.
  const webStream = res.body as ReadableStream<Uint8Array>;
  const reader = webStream.getReader();
  const nodeStream = new Readable({
    async read() {
      try {
        const { value, done } = await reader.read();
        if (done) {
          this.push(null);
          return;
        }
        read += value.length;
        onProgress?.(read, total);
        this.push(Buffer.from(value));
      } catch (err) {
        this.destroy(err as Error);
      }
    },
  });

  await pipeline(nodeStream, fileStream);
}

async function extractArchive(archivePath: string, destDir: string): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true });
  if (archivePath.endsWith('.zip')) {
    // Use Windows' built-in tar (Win10+ ships with bsdtar) which can
    // handle zip files. Avoids pulling in a node unzip lib.
    await runCmd('tar', ['-xf', archivePath, '-C', destDir]);
  } else if (archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz')) {
    await runCmd('tar', ['-xzf', archivePath, '-C', destDir]);
  } else {
    throw new Error(`Unsupported archive type: ${archivePath}`);
  }

  // The Piper archives extract into a `piper/` subfolder. Flatten so the
  // binary lives directly in our binaryDir().
  const inner = path.join(destDir, 'piper');
  if (fs.existsSync(inner) && fs.statSync(inner).isDirectory()) {
    for (const f of fs.readdirSync(inner)) {
      fs.renameSync(path.join(inner, f), path.join(destDir, f));
    }
    fs.rmdirSync(inner);
  }

  // chmod the binary on POSIX so it's executable.
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(binaryPath(), 0o755);
    } catch {
      /* ignore */
    }
  }
}

function runCmd(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: 'inherit' });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`));
    });
    proc.on('error', reject);
  });
}

// ─── installation ──────────────────────────────────────────────────

export async function ensureBinary(
  onProgress?: (p: PiperDownloadProgress) => void,
): Promise<string> {
  if (fs.existsSync(binaryPath())) return binaryPath();

  fs.mkdirSync(binaryDir(), { recursive: true });
  const url = piperBinaryUrl();
  const archive = path.join(binaryDir(), path.basename(url));

  onProgress?.({ stage: 'binary', current: 0, total: 1, message: `Downloading Piper from ${url}` });
  await streamDownload(url, archive, (read, total) => {
    onProgress?.({ stage: 'binary', current: read, total, message: 'Downloading Piper binary' });
  });

  onProgress?.({ stage: 'binary', current: 1, total: 1, message: 'Extracting…' });
  await extractArchive(archive, binaryDir());

  try {
    fs.unlinkSync(archive);
  } catch {
    /* ignore */
  }

  if (!fs.existsSync(binaryPath())) {
    throw new Error('Piper binary not found after extraction');
  }
  return binaryPath();
}

export async function ensureVoice(
  voiceId: string,
  onProgress?: (p: PiperDownloadProgress) => void,
): Promise<{ modelPath: string; configPath: string }> {
  const voice = PIPER_VOICES.find((v) => v.id === voiceId);
  if (!voice) throw new Error(`Unknown voice: ${voiceId}`);

  const dir = voiceDir(voiceId);
  const modelPath = path.join(dir, `${voiceId}.onnx`);
  const configPath = path.join(dir, `${voiceId}.onnx.json`);

  if (fs.existsSync(modelPath) && fs.existsSync(configPath)) {
    return { modelPath, configPath };
  }

  fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(configPath)) {
    onProgress?.({ stage: 'voice', current: 0, total: 1, message: 'Downloading voice config' });
    await streamDownload(voice.configUrl, configPath);
  }
  if (!fs.existsSync(modelPath)) {
    onProgress?.({ stage: 'voice', current: 0, total: voice.sizeBytes, message: `Downloading voice ${voice.name}` });
    await streamDownload(voice.modelUrl, modelPath, (read, total) => {
      onProgress?.({
        stage: 'voice',
        current: read,
        total: total || voice.sizeBytes,
        message: `Downloading voice ${voice.name}`,
      });
    });
  }

  return { modelPath, configPath };
}

// ─── synthesis ─────────────────────────────────────────────────────

export interface SynthOptions {
  voiceId: string;
  text: string;
  onProgress?: (p: PiperDownloadProgress) => void;
}

/**
 * Synthesises text to a WAV-encoded byte buffer (44-byte header + 16-bit
 * mono PCM) at whatever sample rate the voice's config specifies.
 *
 * Returns a base64-encoded WAV the renderer can play with `new Audio(...)`.
 */
export async function synthesize(opts: SynthOptions): Promise<string> {
  const { voiceId, text, onProgress } = opts;

  const bin = await ensureBinary(onProgress);
  const { modelPath, configPath } = await ensureVoice(voiceId, onProgress);
  onProgress?.({ stage: 'done', current: 1, total: 1, message: 'Synthesising…' });

  // Read sample rate from the config so the WAV header is correct.
  let sampleRate = 22050;
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    sampleRate = cfg?.audio?.sample_rate ?? sampleRate;
  } catch {
    /* fall back to default */
  }

  return new Promise<string>((resolve, reject) => {
    const args = ['--model', modelPath, '--output_raw'];
    const proc = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    proc.stdout.on('data', (c: Buffer) => chunks.push(c));
    proc.stderr.on('data', (c: Buffer) => errChunks.push(c));

    proc.on('error', (err) => {
      // ENOENT on Linux usually means a missing system dep (piper statically
      // links most things but a stripped-down distro may still be missing
      // libstdc++6 / libsndfile1). Give the user a pointer instead of a
      // bare `spawn piper ENOENT`.
      const linuxHint =
        process.platform === 'linux'
          ? ' — on Debian/Ubuntu try: sudo apt install libstdc++6 libsndfile1'
          : '';
      reject(new Error(`${err.message}${linuxHint}`));
    });
    proc.on('close', (code) => {
      if (code !== 0) {
        const stderr = Buffer.concat(errChunks).toString('utf-8').trim();
        // Detect the most common Linux failure: a dynamically-linked
        // libstdc++ / libsndfile not being present and turn it into an
        // actionable message.
        const missingLib = /cannot open shared object file/i.test(stderr)
          ? ' — a system library is missing. On Debian/Ubuntu try: sudo apt install libstdc++6 libsndfile1'
          : '';
        reject(new Error(`Piper exited ${code}: ${stderr}${missingLib}`));
        return;
      }
      try {
        const pcm = Buffer.concat(chunks);
        const wav = pcmToWav(pcm, sampleRate);
        resolve(`data:audio/wav;base64,${wav.toString('base64')}`);
      } catch (err) {
        reject(err);
      }
    });

    proc.stdin.write(text);
    proc.stdin.end();
  });
}

/** Wrap raw 16-bit mono LE PCM in a minimal WAV header. */
function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcm.length;
  const fileSize = 44 + dataSize - 8;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(fileSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}

export function deleteVoice(voiceId: string): boolean {
  try {
    fs.rmSync(voiceDir(voiceId), { recursive: true, force: true });
    return true;
  } catch (err) {
    logger.warn('failed to delete voice', voiceId, err);
    return false;
  }
}

export function deleteBinary(): boolean {
  try {
    fs.rmSync(binaryDir(), { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
