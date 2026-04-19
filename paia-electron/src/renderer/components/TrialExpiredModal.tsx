// One-time modal shown the first launch after the 14-day trial
// expires. Acknowledge once, stored in settings.trialExpiryAcknowledged,
// and it never fires again.

import { useRef } from 'react';
import { api } from '../lib/api';
import { useFocusTrap } from '../lib/focusTrap';

interface Props {
  onAcknowledge: () => void;
  onOpenLicense: () => void;
}

export function TrialExpiredModal({ onAcknowledge, onOpenLicense }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(containerRef, { onClose: onAcknowledge });

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal"
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="trial-expired-title"
      >
        <div className="modal-title" id="trial-expired-title">
          <span>⏳ Your trial ended</span>
        </div>
        <div className="modal-body">
          <p>Thanks for the 14-day spin. The free tier stays yours forever — chat, voice, screen
             capture, memory, personas, quick actions, full-screen region capture.</p>
          <p className="muted-note">
            These now require a licence: agent mode, deep research, canvas, cloud providers,
            connectors, schedule, ambient/autopilot, web search, RAG, MCP, plugins.
          </p>
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onAcknowledge}>Continue on free</button>
          <button
            type="button"
            className="secondary"
            onClick={() => void api.openExternal('https://paia.app/pricing?from=trial-ended')}
          >
            See pricing
          </button>
          <button type="button" className="primary" onClick={() => { onOpenLicense(); onAcknowledge(); }}>
            Activate licence
          </button>
        </div>
      </div>
    </div>
  );
}
