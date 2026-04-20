// Quick reference for power-user shortcuts. Opens on `/shortcuts`, on
// the ? key (anywhere except an input), or via the command palette.
//
// Keep the list short and truthful: if we don't actually wire a shortcut,
// it doesn't belong here.

import { useEffect } from 'react';

interface Props {
  onClose: () => void;
}

const ROWS: { keys: string; desc: string }[] = [
  { keys: 'Ctrl/⌘ + K', desc: 'Command palette' },
  { keys: 'Ctrl/⌘ + ,', desc: 'Open Settings' },
  { keys: 'Ctrl/⌘ + N', desc: 'New conversation' },
  { keys: 'Esc', desc: 'Close panel / modal / persona picker' },
  { keys: '/', desc: 'Slash commands in the composer' },
  { keys: '/persona', desc: 'Open the persona picker' },
  { keys: '/whiteboard', desc: 'Open Canvas to create a whiteboard' },
  { keys: '/math <question>', desc: 'Force a LaTeX-rendered answer' },
  { keys: '/mermaid <request>', desc: 'Force a Mermaid-diagram answer' },
  { keys: '/chem <SMILES or name>', desc: 'Draw a molecule' },
  { keys: '/learned', desc: 'Show what PAiA has learned from you' },
  { keys: '/export', desc: 'Export this conversation as Markdown' },
  { keys: '/remember <fact>', desc: 'Save a durable memory' },
  { keys: '/recall <query>', desc: 'Search long-term memory' },
  { keys: '?', desc: 'Open this cheat sheet' },
];

export function ShortcutHelp({ onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="kbd-help-backdrop" role="dialog" aria-label="Keyboard shortcuts" onClick={onClose}>
      <div className="kbd-help" onClick={(e) => e.stopPropagation()}>
        <h2>Keyboard shortcuts &amp; slash commands</h2>
        {ROWS.map((r) => (
          <div key={r.keys} className="kbd-help-row">
            <span>{r.desc}</span>
            <span className="kbd-help-keys">{r.keys}</span>
          </div>
        ))}
        <div className="kbd-help-row" style={{ marginTop: 8, color: 'var(--muted)' }}>
          <span>Tip — hover an assistant reply to see 👍/👎, Copy, Fork, and Regenerate.</span>
          <span />
        </div>
      </div>
    </div>
  );
}
