// Voice-activity-detection segmenter for offline Whisper streaming.
//
// Wraps the mic so the user can speak naturally and each utterance is
// emitted as a segment the moment they pause. The renderer feeds each
// segment to Whisper and appends the returned text to the composer
// draft — giving a real-time-ish transcript without needing a streaming
// model.
//
// Algorithm:
//   1. ScriptProcessor pumps 4096-sample frames from the mic at the
//      AudioContext's sample rate (usually 48kHz, sometimes 44.1kHz).
//   2. Per frame we compute RMS energy and classify it as speech
//      (above an adaptive noise floor × multiplier) or silence.
//   3. A rolling buffer accumulates frames once speech has started.
//      After N consecutive silent frames we emit the buffer as one
//      segment, resampled to 16kHz for Whisper.
//   4. After a longer continuous silence post-segment, we fire
//      onAutoSubmit so the caller can send the finalized draft.

export interface VadOptions {
  /** Sample rate the ScriptProcessor runs at (taken from AudioContext). */
  sampleRate: number;
  /** Segments shorter than this are dropped (ignore cough / throat-clear). */
  minSegmentMs?: number;
  /** Stop gathering a segment after this much silence (utterance boundary). */
  silenceToEmitMs?: number;
  /** After this much continuous silence post-segment, fire onAutoSubmit. */
  autoSubmitMs?: number;
  /** Multiplier applied to the moving noise floor to define "speech". */
  speechMultiplier?: number;
}

export interface VadCallbacks {
  /** Fires once per utterance, PCM already resampled to 16kHz. */
  onSegment: (pcm16k: Float32Array) => void;
  /** Current RMS energy, useful for a live level meter in the UI. */
  onLevel?: (rms: number) => void;
  /** Called after a long post-segment silence. */
  onAutoSubmit?: () => void;
}

export class VadSegmenter {
  private opts: Required<VadOptions>;
  private callbacks: VadCallbacks;

  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private proc: ScriptProcessorNode | null = null;

  private noiseFloor = 0.005;
  /** All frames since the start of the current utterance (speech + tail silence). */
  private buffer: Float32Array[] = [];
  private inSpeech = false;
  private silentFrames = 0;
  private speechFramesSinceSegment = 0;
  /** Silence counter used only when NOT inside a segment, to drive autoSubmit. */
  private postSegmentSilentFrames = 0;
  private frameMs: number;

  constructor(opts: VadOptions, callbacks: VadCallbacks) {
    this.opts = {
      sampleRate: opts.sampleRate,
      minSegmentMs: opts.minSegmentMs ?? 400,
      silenceToEmitMs: opts.silenceToEmitMs ?? 650,
      autoSubmitMs: opts.autoSubmitMs ?? 1600,
      speechMultiplier: opts.speechMultiplier ?? 2.2,
    };
    this.callbacks = callbacks;
    this.frameMs = Math.round((4096 / this.opts.sampleRate) * 1000);
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.proc = this.ctx.createScriptProcessor(4096, 1, 1);
    this.frameMs = Math.round((4096 / this.ctx.sampleRate) * 1000);
    this.proc.onaudioprocess = (e) => this.onFrame(e.inputBuffer.getChannelData(0));
    src.connect(this.proc);
    this.proc.connect(this.ctx.destination);
  }

  async stop(): Promise<void> {
    try { this.proc?.disconnect(); } catch { /* ignore */ }
    this.stream?.getTracks().forEach((t) => t.stop());
    try { await this.ctx?.close(); } catch { /* ignore */ }
    this.ctx = null;
    this.stream = null;
    this.proc = null;
    this.buffer = [];
    this.inSpeech = false;
    this.silentFrames = 0;
    this.speechFramesSinceSegment = 0;
    this.postSegmentSilentFrames = 0;
  }

  private onFrame(data: Float32Array): void {
    // ScriptProcessor reuses its input buffer — copy before stashing.
    const copy = new Float32Array(data);
    let sumSq = 0;
    for (let i = 0; i < copy.length; i++) sumSq += copy[i] * copy[i];
    const rms = Math.sqrt(sumSq / copy.length);
    this.callbacks.onLevel?.(rms);

    // Adaptive noise floor — only update when clearly not speaking.
    if (rms < this.noiseFloor * 1.5) {
      this.noiseFloor = this.noiseFloor * 0.98 + rms * 0.02;
      this.noiseFloor = Math.max(this.noiseFloor, 0.001);
    }
    const isSpeech = rms > this.noiseFloor * this.opts.speechMultiplier;

    if (isSpeech) {
      this.buffer.push(copy);
      this.inSpeech = true;
      this.silentFrames = 0;
      this.postSegmentSilentFrames = 0;
      this.speechFramesSinceSegment++;
      return;
    }

    if (this.inSpeech) {
      // Keep a little tail silence so Whisper has clean segment edges.
      this.buffer.push(copy);
      this.silentFrames++;
      const silenceMs = this.silentFrames * this.frameMs;
      if (silenceMs >= this.opts.silenceToEmitMs) {
        this.flushSegment();
      }
      return;
    }

    // Not in a segment — track how long we've been silent so the caller
    // can auto-submit after a real pause.
    this.postSegmentSilentFrames++;
    const silenceMs = this.postSegmentSilentFrames * this.frameMs;
    if (silenceMs >= this.opts.autoSubmitMs) {
      this.postSegmentSilentFrames = 0;
      this.callbacks.onAutoSubmit?.();
    }
  }

  private flushSegment(): void {
    const bufSnapshot = this.buffer;
    const speechMs = this.speechFramesSinceSegment * this.frameMs;
    this.buffer = [];
    this.inSpeech = false;
    this.silentFrames = 0;
    this.speechFramesSinceSegment = 0;
    this.postSegmentSilentFrames = 0;

    if (speechMs < this.opts.minSegmentMs) return;

    let total = 0;
    for (const f of bufSnapshot) total += f.length;
    const merged = new Float32Array(total);
    let offset = 0;
    for (const f of bufSnapshot) {
      merged.set(f, offset);
      offset += f.length;
    }

    const sampleRate = this.ctx?.sampleRate ?? this.opts.sampleRate;
    const pcm16 = resampleTo16k(merged, sampleRate);
    this.callbacks.onSegment(pcm16);
  }
}

/** Linear-interpolation resample. Good enough for speech; avoids pulling in a DSP lib. */
export function resampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  if (inputRate === 16000) return input;
  const ratio = inputRate / 16000;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, input.length - 1);
    const frac = srcIdx - lo;
    out[i] = input[lo] * (1 - frac) + input[hi] * frac;
  }
  return out;
}
