// Voice-input confirmation dialog.
//
// Flow: Whisper returns text → we open this modal instead of sending the
// message. PAiA speaks the heard text back via Piper (or system TTS as
// fallback), the user reads + hears it, then clicks Confirm to actually
// send, Edit to drop it into the draft for manual tweaking, or Cancel to
// discard.
//
// Why we don't also listen for a spoken "yes/no" here: Piper playback +
// live mic re-entry has feedback-loop risks (PAiA hears its own "did you
// say..." as input). Keeping V1 button-driven; voice response can layer
// on later once echo-cancellation is tested on each platform.

import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useFocusTrap } from '../lib/focusTrap';

interface Props {
  text: string;
  ttsEngine: 'system' | 'piper';
  piperVoice: string;
  onConfirm: () => void;
  onEdit: () => void;
  onCancel: () => void;
}

export function ConfirmTranscriptionModal({ text, ttsEngine, piperVoice, onConfirm, onEdit, onCancel }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [speaking, setSpeaking] = useState(false);
  useFocusTrap(containerRef, { onClose: onCancel });

  async function speak(): Promise<void> {
    setSpeaking(true);
    try {
      if (ttsEngine === 'piper') {
        const res = await api.piperSynthesize(piperVoice, text);
        if (res.ok && res.wav) {
          // Tear down any prior playback first so repeat-clicks don't stack.
          audioRef.current?.pause();
          const audio = new Audio(res.wav);
          audioRef.current = audio;
          audio.onended = () => setSpeaking(false);
          audio.onerror = () => setSpeaking(false);
          await audio.play();
          return;
        }
      }
      // Fallback: browser speech synthesis.
      if (typeof window.speechSynthesis !== 'undefined') {
        const u = new SpeechSynthesisUtterance(text);
        u.onend = () => setSpeaking(false);
        u.onerror = () => setSpeaking(false);
        window.speechSynthesis.speak(u);
        return;
      }
      setSpeaking(false);
    } catch {
      setSpeaking(false);
    }
  }

  // Auto-speak once on mount.
  useEffect(() => {
    void speak();
    return () => {
      audioRef.current?.pause();
      if (typeof window.speechSynthesis !== 'undefined') window.speechSynthesis.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Enter submits, Esc cancels (Esc is handled by useFocusTrap already).
  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onConfirm();
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal"
        ref={containerRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-transcription-title"
        aria-describedby="confirm-transcription-desc"
        onKeyDown={onKey}
      >
        <div className="modal-title" id="confirm-transcription-title">
          <span>Heard you. Confirm before I act?</span>
        </div>
        <div className="modal-body" id="confirm-transcription-desc">
          <p className="muted-note">I transcribed:</p>
          <blockquote
            style={{
              margin: '4px 0 12px',
              padding: '10px 12px',
              borderLeft: '3px solid var(--accent, #4a9)',
              background: 'rgba(128,128,128,0.08)',
              fontSize: 14,
              lineHeight: 1.45,
              whiteSpace: 'pre-wrap',
            }}
          >
            {text}
          </blockquote>
          <p className="muted-note">
            Send as-is, edit in the composer first, or cancel.
          </p>
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" onClick={onEdit}>Edit</button>
          <button
            type="button"
            onClick={() => void speak()}
            disabled={speaking}
            title="Play transcription again"
          >
            {speaking ? 'Speaking…' : '🔊 Replay'}
          </button>
          <button type="button" className="primary" onClick={onConfirm}>
            Confirm &amp; send
          </button>
        </div>
      </div>
    </div>
  );
}
