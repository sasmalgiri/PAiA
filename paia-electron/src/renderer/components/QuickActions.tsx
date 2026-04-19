// Quick-actions popup. Triggered by the global hotkey (default
// Control+Alt+Q) — main reads the clipboard and pushes the text here,
// the user picks an action, and we send a chat message with the
// appropriate prompt template, then jump to the panel view.

import { useState } from 'react';
import type { QuickAction } from '../../shared/types';

interface QuickActionsProps {
  text: string;
  onAction: (prompt: string) => void;
  onCancel: () => void;
  onEditText: (next: string) => void;
}

const ACTIONS: QuickAction[] = [
  { id: 'explain',   label: 'Explain',   emoji: '💡', prompt: 'Explain the following clearly. Use analogies where helpful:\n\n{text}' },
  { id: 'summarize', label: 'Summarize', emoji: '📝', prompt: 'Summarize the following in 3–5 concise bullet points:\n\n{text}' },
  { id: 'translate', label: 'Translate', emoji: '🌐', prompt: 'Translate the following to English. If it is already English, translate it to Spanish. Output only the translation:\n\n{text}' },
  { id: 'rewrite',   label: 'Rewrite',   emoji: '✍️', prompt: 'Rewrite the following to be clearer and more polished. Preserve the meaning. Output only the rewritten text:\n\n{text}' },
  { id: 'fix',       label: 'Fix',       emoji: '🛠', prompt: 'Fix the spelling and grammar of the following. Preserve meaning and tone. Output only the corrected text:\n\n{text}' },
  { id: 'tone',      label: 'Friendly',  emoji: '🤝', prompt: 'Rewrite the following in a friendlier, warmer tone. Output only the rewritten text:\n\n{text}' },
  { id: 'shorter',   label: 'Shorten',   emoji: '✂️', prompt: 'Rewrite the following to be shorter while preserving meaning:\n\n{text}' },
  { id: 'longer',    label: 'Expand',    emoji: '📖', prompt: 'Expand the following with more detail, examples, and structure:\n\n{text}' },
];

export function QuickActions({ text, onAction, onCancel, onEditText }: QuickActionsProps) {
  const [editing, setEditing] = useState(false);

  function handle(action: QuickAction): void {
    if (!text.trim()) return;
    onAction(action.prompt.replace('{text}', text));
  }

  return (
    <section className="quick">
      <header className="panel-header drag">
        <div className="panel-title no-drag">⚡ Quick action</div>
        <div className="panel-actions no-drag">
          <button type="button" className="icon-btn" onClick={onCancel} title="Close">×</button>
        </div>
      </header>

      <div className="quick-body no-drag">
        {!text && (
          <div className="quick-empty">
            <p>No text on the clipboard.</p>
            <p className="muted-note">Copy some text first (Ctrl+C), then press the quick-actions hotkey again.</p>
          </div>
        )}

        {text && (
          <>
            {editing ? (
              <textarea
                className="quick-text-edit"
                value={text}
                onChange={(e) => onEditText(e.target.value)}
                rows={4}
              />
            ) : (
              <div
                className="quick-text"
                onClick={() => setEditing(true)}
                title="Click to edit"
              >
                {text.length > 280 ? text.slice(0, 280) + '…' : text}
              </div>
            )}
            <div className="quick-grid">
              {ACTIONS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="quick-btn"
                  onClick={() => handle(a)}
                >
                  <span className="quick-emoji">{a.emoji}</span>
                  <span className="quick-label">{a.label}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
