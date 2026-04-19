// Reusable input modal — replaces browser `prompt()` with a properly
// styled, focus-trapped, keyboard-friendly dialog. Used for agent-goal
// entry, research-question entry, team-goal entry, new-artifact title,
// and anywhere else where we need a one-line answer from the user.
//
// Keeps a small surface: title, description, placeholder, default value,
// optional example list for one-click prefill. The input is submitted
// with Enter; Esc closes.

import { useRef, useState } from 'react';
import { useFocusTrap } from '../lib/focusTrap';

export interface InputModalProps {
  title: string;
  description?: string;
  placeholder?: string;
  /** Pre-fills the field so users can see what's expected. */
  defaultValue?: string;
  /** Optional quick-pick suggestions rendered below the input. */
  examples?: string[];
  /** Shown on the primary button — defaults to "Go". */
  submitLabel?: string;
  /** Textarea if you expect multi-line input (agent goals often are). */
  multiline?: boolean;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export function InputModal(props: InputModalProps) {
  const { title, description, placeholder, defaultValue = '', examples, submitLabel, multiline, onSubmit, onCancel } = props;
  const [value, setValue] = useState(defaultValue);
  const containerRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(containerRef, { onClose: onCancel });

  function submit(): void {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  }

  function onKey(e: React.KeyboardEvent): void {
    if (e.key === 'Enter' && (!multiline || (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <div
        className="modal input-modal"
        ref={containerRef}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="input-modal-title"
      >
        <div className="modal-title" id="input-modal-title">{title}</div>
        <div className="modal-body">
          {description && <p className="muted-note" style={{ marginBottom: 12 }}>{description}</p>}
          {multiline ? (
            <textarea
              autoFocus
              rows={4}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={onKey}
              placeholder={placeholder}
              aria-label={title}
            />
          ) : (
            <input
              autoFocus
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={onKey}
              placeholder={placeholder}
              aria-label={title}
            />
          )}
          {examples && examples.length > 0 && (
            <>
              <p className="muted-note" style={{ fontSize: 11, marginTop: 10 }}>Try one of these:</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                {examples.map((ex, i) => (
                  <button
                    key={i}
                    type="button"
                    className="secondary input-modal-example"
                    onClick={() => setValue(ex)}
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </>
          )}
          {multiline && (
            <p className="muted-note" style={{ fontSize: 10, marginTop: 8 }}>
              <kbd>Ctrl/⌘ + Enter</kbd> to submit
            </p>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
          <button type="button" className="primary" onClick={submit} disabled={!value.trim()}>
            {submitLabel ?? 'Go'}
          </button>
        </div>
      </div>
    </div>
  );
}
