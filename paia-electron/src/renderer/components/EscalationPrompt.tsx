// Inline banner that fires when:
//   - settings.cloudEscalation === 'ask'
//   - the router classified the user's query as 'hard'
//   - a cloud model is configured (cloudEscalationModel)
//
// Three actions:
//   "Yes, this turn"   → use cloud model for this send only
//   "Yes, always"      → flip the setting to 'auto' so future hard
//                        queries promote silently
//   "No, keep local"   → use local model
//
// The redaction layer runs BEFORE escalation (in main's chat handler),
// so PII never leaves the machine even when escalation fires. The
// audit log + the cloud-models gate already exist; this just exposes
// a one-click promotion for the small-but-hard query case.

import { useEffect, useRef } from 'react';

interface Props {
  query: string;
  reason: string;
  cloudModel: string;
  onChoice: (choice: 'this-turn' | 'always' | 'no') => void;
}

export function EscalationPrompt({ query, reason, cloudModel, onChoice }: Props) {
  const yesRef = useRef<HTMLButtonElement | null>(null);
  // Focus the primary action so Enter accepts immediately.
  useEffect(() => { yesRef.current?.focus(); }, []);

  // ESC = no.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onChoice('no');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onChoice]);

  const cloudShort = cloudModel.includes('/') ? cloudModel.split('/').pop()! : cloudModel;

  return (
    <div className="escalation-prompt" role="alertdialog" aria-labelledby="escalation-title" aria-describedby="escalation-body">
      <div className="escalation-head">
        <span aria-hidden>☁️</span>
        <span id="escalation-title" className="escalation-title">This looks like a hard one</span>
      </div>
      <div id="escalation-body" className="escalation-body">
        <div className="escalation-query">
          “{query.length > 90 ? query.slice(0, 87) + '…' : query}”
        </div>
        {reason && <div className="muted-note escalation-reason">Router said: {reason}</div>}
        <div className="muted-note" style={{ marginTop: 6, fontSize: 11 }}>
          Promote this turn to <strong>{cloudShort}</strong>? PII is redacted locally before the request leaves your machine.
        </div>
      </div>
      <div className="escalation-actions">
        <button
          ref={yesRef}
          type="button"
          className="primary small"
          onClick={() => onChoice('this-turn')}
        >
          Yes, this turn
        </button>
        <button
          type="button"
          className="small"
          onClick={() => onChoice('always')}
          title="Switches Cloud escalation to 'auto' — every hard query will promote silently"
        >
          Yes, always for hard
        </button>
        <button
          type="button"
          className="small"
          onClick={() => onChoice('no')}
        >
          No, keep local
        </button>
      </div>
    </div>
  );
}
