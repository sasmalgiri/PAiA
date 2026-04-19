// The input row at the bottom of the panel. Owns its own draft state,
// the slash-menu popup, the mic button, and the file-attachment chip
// list. Calls onSend(text, attachments) when the user submits.

import { useEffect, useRef, useState } from 'react';
import type { DbAttachment } from '../../shared/types';
import { api } from '../lib/api';
import { useT } from '../lib/i18n';
import { findCommand, parseSlashCommand, SLASH_COMMANDS } from '../lib/slashCommands';
import { VadSegmenter } from '../lib/vadSegmenter';

const VISION_MODEL_HINTS = ['llava', 'bakllava', 'moondream', 'llama3.2-vision', 'minicpm', 'qwen2-vl', 'qwen2.5-vl', 'pixtral'];

type PendingAttachment = Omit<DbAttachment, 'id' | 'messageId'>;

interface ComposerProps {
  voiceLang: string;
  sttEngine: 'chromium' | 'whisper';
  currentModel: string;
  voiceContinuous: boolean;
  onSend: (text: string, attachments: PendingAttachment[]) => void;
  onMetaCommand: (name: string, rest: string) => void;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [i: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

export function Composer({ voiceLang, sttEngine, currentModel, voiceContinuous, onSend, onMetaCommand }: ComposerProps) {
  const { t } = useT();
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [showSlash, setShowSlash] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const [listening, setListening] = useState(false);
  const [hint, setHint] = useState(t('composer.hintRedacted'));
  const [dragOver, setDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const hasImageAttachment = attachments.some((a) => a.kind === 'image');
  const lowerModel = currentModel.toLowerCase();
  const looksLikeVisionModel = VISION_MODEL_HINTS.some((h) => lowerModel.includes(h));
  const visionWarning = hasImageAttachment && currentModel && !looksLikeVisionModel;

  // Voice state — owned here so the composer is self-contained.
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const whisperStreamRef = useRef<MediaStream | null>(null);
  const whisperCtxRef = useRef<AudioContext | null>(null);
  const whisperNodeRef = useRef<ScriptProcessorNode | null>(null);
  const whisperChunksRef = useRef<Float32Array[]>([]);
  const vadSegmenterRef = useRef<VadSegmenter | null>(null);
  const draftRef = useRef('');
  useEffect(() => { draftRef.current = draft; }, [draft]);

  useEffect(() => {
    setShowSlash(draft.startsWith('/') && !draft.includes(' '));
    setSlashFilter(draft.startsWith('/') ? draft.slice(1) : '');
  }, [draft]);

  // Continuous voice mode: auto-start the mic on mount, auto-submit after
  // 1.6s of transcribed silence, and re-arm once the reply finishes.
  useEffect(() => {
    if (!voiceContinuous) return;
    if (!listening) startVoice();
    return () => { if (listening) stopVoice(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceContinuous]);

  function submit(): void {
    const text = draft.trim();
    if (!text && attachments.length === 0) return;

    // Slash command branch.
    const parsed = parseSlashCommand(text);
    if (parsed) {
      const cmd = findCommand(parsed.command);
      if (cmd) {
        const rewritten = cmd.rewrite(parsed.rest);
        if (rewritten === null) {
          // Meta command — UI handles it (clear, new, screen, search, etc).
          onMetaCommand(parsed.command, parsed.rest);
          setDraft('');
          return;
        }
        onSend(rewritten, attachments);
        setDraft('');
        setAttachments([]);
        return;
      }
    }

    onSend(text, attachments);
    setDraft('');
    setAttachments([]);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  // Pasting an image into the composer attaches it. Pasting plain text
  // falls through to the textarea's default behavior.
  async function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>): Promise<void> {
    if (!e.clipboardData) return;
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter((it) => it.kind === 'file' && it.type.startsWith('image/'));
    if (imageItems.length === 0) return;
    e.preventDefault();
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (!file) continue;
      const dataUrl = await readAsDataURL(file);
      setAttachments((prev) => [
        ...prev,
        {
          kind: 'image',
          filename: file.name || `pasted-${Date.now()}.png`,
          mimeType: file.type || 'image/png',
          sizeBytes: file.size,
          content: dataUrl,
        },
      ]);
    }
    setHint('Image pasted from clipboard.');
  }

  // ── drag-and-drop on the whole composer surface ─────────────
  function handleDragOver(e: React.DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }
  function handleDragLeave(e: React.DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }
  async function handleDrop(e: React.DragEvent<HTMLDivElement>): Promise<void> {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
    await handleFiles(e.dataTransfer.files);
  }

  // ── attachments ─────────────────────────────────────────────
  // Hard cap on any single file. A 10 GB drop otherwise pegs renderer
  // memory to the moon while FileReader runs — visible as a hang
  // followed by a crash.
  const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25 MB

  async function handleFiles(files: FileList | null): Promise<void> {
    if (!files) return;
    const next: PendingAttachment[] = [];
    for (const file of Array.from(files)) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setHint(`File ${file.name} exceeds the 25 MB limit and was skipped.`);
        continue;
      }
      const isImage = file.type.startsWith('image/');
      const isText = file.type.startsWith('text/') || /\.(md|txt|json|csv|log)$/i.test(file.name);
      if (isImage) {
        const dataUrl = await readAsDataURL(file);
        next.push({
          kind: 'image',
          filename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          content: dataUrl,
        });
      } else if (isText) {
        const text = await file.text();
        next.push({
          kind: 'text',
          filename: file.name,
          mimeType: file.type || 'text/plain',
          sizeBytes: file.size,
          content: text.slice(0, 200_000), // 200KB cap
        });
      } else {
        setHint(`Unsupported file type: ${file.name}`);
      }
    }
    setAttachments((prev) => [...prev, ...next]);
  }

  function readAsDataURL(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  function removeAttachment(idx: number): void {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  }

  // ── voice: chromium path ─────────────────────────────────────
  function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
  }

  function startChromiumStt(): void {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setHint('Chromium speech recognition is not available.');
      return;
    }
    const r = new Ctor();
    r.lang = voiceLang;
    r.interimResults = true;
    // In duplex/continuous mode we don't end after the first silence —
    // the recognizer keeps running and we auto-submit on a trailing pause.
    r.continuous = voiceContinuous;
    let finalText = '';
    let pauseTimer: ReturnType<typeof setTimeout> | null = null;
    r.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      const combined = (finalText + interim).trim();
      setDraft(combined);

      if (voiceContinuous && combined.length > 0) {
        // Auto-submit after ~1.6s of silence (no new transcripts).
        if (pauseTimer) clearTimeout(pauseTimer);
        pauseTimer = setTimeout(() => {
          const text = (finalText || interim).trim();
          finalText = '';
          if (text.length >= 3) {
            onSend(text, []);
            setDraft('');
          }
        }, 1600);
      }
    };
    r.onerror = (e) => {
      setHint(`Speech error: ${e.error}`);
      stopVoice();
    };
    r.onend = () => {
      if (pauseTimer) clearTimeout(pauseTimer);
      setListening(false);
      const text = (finalText || draft).trim();
      if (text) {
        setDraft(text);
      }
      // In continuous mode, automatically re-arm when the recognizer ends
      // (Chrome ends sessions after long pauses even in continuous mode).
      if (voiceContinuous) {
        setTimeout(() => {
          if (!listening) startChromiumStt();
        }, 300);
      }
    };
    try {
      r.start();
      recognitionRef.current = r;
      setListening(true);
      setHint(voiceContinuous ? 'Duplex voice active — speak any time.' : 'Listening… click mic to stop.');
    } catch {
      setHint('Failed to start speech recognition.');
    }
  }

  // ── voice: whisper path ──────────────────────────────────────
  async function startWhisperStt(): Promise<void> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      setHint(`Mic denied: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    whisperStreamRef.current = stream;
    whisperCtxRef.current = ctx;
    whisperNodeRef.current = proc;
    whisperChunksRef.current = [];
    proc.onaudioprocess = (e) => {
      whisperChunksRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    src.connect(proc);
    proc.connect(ctx.destination);
    setListening(true);
    setHint('Listening… click mic to stop.');
  }

  async function stopWhisperStt(): Promise<void> {
    setListening(false);
    const stream = whisperStreamRef.current;
    const ctx = whisperCtxRef.current;
    const proc = whisperNodeRef.current;
    const chunks = whisperChunksRef.current;
    whisperStreamRef.current = null;
    whisperCtxRef.current = null;
    whisperNodeRef.current = null;
    whisperChunksRef.current = [];

    try { proc?.disconnect(); } catch { /* ignore */ }
    stream?.getTracks().forEach((t) => t.stop());
    const sourceRate = ctx?.sampleRate ?? 48000;
    try { await ctx?.close(); } catch { /* ignore */ }

    if (chunks.length === 0) {
      setHint('No audio captured.');
      return;
    }

    let total = 0;
    for (const c of chunks) total += c.length;
    const merged = new Float32Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.length;
    }

    const targetRate = 16000;
    let pcm: Float32Array;
    if (sourceRate === targetRate) {
      pcm = merged;
    } else {
      const targetLength = Math.ceil((merged.length * targetRate) / sourceRate);
      const offline = new OfflineAudioContext(1, targetLength, targetRate);
      const buf = offline.createBuffer(1, merged.length, sourceRate);
      buf.copyToChannel(merged, 0);
      const node = offline.createBufferSource();
      node.buffer = buf;
      node.connect(offline.destination);
      node.start(0);
      const rendered = await offline.startRendering();
      pcm = rendered.getChannelData(0).slice();
    }

    setHint('Transcribing… (first run downloads the model)');
    const result = await api.transcribe(pcm, voiceLang);
    if (!result.ok) {
      setHint(`Whisper failed: ${result.error ?? 'unknown error'}`);
      return;
    }
    const text = (result.text ?? '').trim();
    if (!text) {
      setHint('No speech detected.');
      return;
    }
    setDraft(text);
    setHint('PII redacted locally before send.');
  }

  // Continuous Whisper path: VAD-segmented streaming. Each detected
  // utterance is transcribed as soon as the user pauses, and appended
  // to the draft. After a longer silence we auto-submit.
  async function startStreamingWhisper(): Promise<void> {
    // Probe sample rate by creating a quick AudioContext; the segmenter
    // will update it from its own ctx once started.
    const probe = new AudioContext();
    const rate = probe.sampleRate;
    try { await probe.close(); } catch { /* ignore */ }

    const seg = new VadSegmenter(
      { sampleRate: rate },
      {
        onSegment: async (pcm16) => {
          setHint('Transcribing…');
          const streamId = Math.random().toString(36).slice(2, 10);
          // Stream incremental decode tokens into the draft the moment they
          // arrive — the segment final event will replace that prefix with
          // the clean finalized text. We mark the streaming prefix with a
          // sentinel so multiple concurrent segments don't collide.
          const beforeLen = draftRef.current.length;
          let offToken: (() => void) | undefined;
          let offDone: (() => void) | undefined;
          // Hard safety timeout: if the main-process transcription hangs
          // (network, model failed to load, renderer tab backgrounded),
          // we still need to unsubscribe or we leak IPC listeners for
          // every utterance across the lifetime of the session.
          const cleanup = (): void => {
            offToken?.();
            offDone?.();
            offToken = undefined;
            offDone = undefined;
          };
          const safetyTimeout = setTimeout(() => {
            cleanup();
            setHint('Whisper stalled — stream aborted.');
          }, 30_000);
          offToken = api.onWhisperToken?.((p) => {
            if (p.streamId !== streamId) return;
            setDraft((prev) => prev + p.token);
          });
          offDone = api.onWhisperDone?.((p) => {
            if (p.streamId !== streamId) return;
            clearTimeout(safetyTimeout);
            cleanup();
            const finalText = (p.text ?? '').trim();
            // Replace the streaming suffix with the normalised final text.
            setDraft((prev) => {
              const stable = prev.slice(0, beforeLen);
              if (!finalText) return stable;
              return (stable ? stable + ' ' : '') + finalText;
            });
            if (p.error) setHint(`Whisper failed: ${p.error}`);
            else setHint('Continuous voice — speak again or pause to send.');
          });
          try {
            await api.transcribeStream(pcm16, voiceLang, streamId);
          } catch (err) {
            clearTimeout(safetyTimeout);
            cleanup();
            setHint(`Whisper failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        },
        onLevel: () => { /* reserved for a future level meter */ },
        onAutoSubmit: () => {
          const text = draftRef.current.trim();
          if (text.length >= 3) {
            onSend(text, []);
            setDraft('');
          }
        },
      },
    );
    try {
      await seg.start();
      vadSegmenterRef.current = seg;
      setListening(true);
      setHint('Continuous voice (Whisper) — speak; pause to send.');
    } catch (err) {
      setHint(`Mic denied: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function stopStreamingWhisper(): Promise<void> {
    const seg = vadSegmenterRef.current;
    vadSegmenterRef.current = null;
    await seg?.stop();
    setListening(false);
  }

  function startVoice(): void {
    if (sttEngine === 'whisper' && voiceContinuous) {
      void startStreamingWhisper();
    } else if (sttEngine === 'whisper') {
      void startWhisperStt();
    } else {
      startChromiumStt();
    }
  }
  function stopVoice(): void {
    if (vadSegmenterRef.current) {
      void stopStreamingWhisper();
      return;
    }
    if (sttEngine === 'whisper') void stopWhisperStt();
    else {
      try { recognitionRef.current?.stop(); } catch { /* ignore */ }
      recognitionRef.current = null;
      setListening(false);
    }
  }

  const filteredCommands = SLASH_COMMANDS.filter((c) =>
    c.name.toLowerCase().startsWith(slashFilter.toLowerCase()),
  );

  return (
    <div
      className={`composer ${dragOver ? 'drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(e) => void handleDrop(e)}
    >
      {showSlash && filteredCommands.length > 0 && (
        <div className="slash-menu">
          {filteredCommands.map((c) => (
            <button
              type="button"
              key={c.name}
              className="slash-item"
              onMouseDown={(e) => {
                e.preventDefault();
                setDraft(`/${c.name} `);
                setShowSlash(false);
                textareaRef.current?.focus();
              }}
            >
              <span className="slash-name">/{c.name}</span>
              <span className="slash-desc">{c.description}</span>
            </button>
          ))}
        </div>
      )}

      {attachments.length > 0 && (
        <div className="composer-attachments">
          {attachments.map((a, i) => (
            <div key={i} className="composer-chip" title={a.filename}>
              {a.kind === 'image' ? <span>🖼</span> : <span>📎</span>}
              <span className="chip-name">{a.filename}</span>
              <button type="button" className="chip-x" onClick={() => removeAttachment(i)}>×</button>
            </div>
          ))}
        </div>
      )}

      <textarea
        ref={textareaRef}
        value={draft}
        rows={2}
        placeholder={t('composer.placeholder')}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={(e) => void handlePaste(e)}
      />

      <div className="composer-buttons">
        <label className="icon-btn" title={t('composer.attach')}>
          📎
          <input
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => void handleFiles(e.target.files)}
          />
        </label>
        <button
          type="button"
          className={`icon-btn mic ${listening ? 'active' : ''}`}
          title={listening ? t('composer.micStop') : t('composer.micStart')}
          onClick={() => (listening ? stopVoice() : startVoice())}
        >
          🎙
        </button>
        <button type="button" className="primary" onClick={submit}>{t('composer.send')}</button>
      </div>

      <div className="hint">{hint}</div>
      {visionWarning && (
        <div className="vision-warn">
          ⚠ Selected model <code>{currentModel}</code> doesn't look like a vision model.
          For images, try a vision model: <code>llava</code>, <code>bakllava</code>,
          <code>moondream</code>, or <code>llama3.2-vision</code>.
        </div>
      )}
    </div>
  );
}
