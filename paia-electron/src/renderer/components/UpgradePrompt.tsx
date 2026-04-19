// Modal shown when a feature is tier-gated and the user tried to use it.
//
// Main-process gates throw Error(`Feature "X" requires PAiA Pro...`).
// Anywhere the renderer catches a thrown error, it can call
// `detectUpgradeError(err)` to turn that string into a structured
// UpgradeInfo and hand it to the App's UpgradePrompt overlay.

import { useRef } from 'react';
import { api } from '../lib/api';
import { useFocusTrap } from '../lib/focusTrap';

export interface UpgradeInfo {
  feature: string;
  targetTier: 'pro' | 'team';
}

/**
 * Scan an error message for the stable phrase emitted by requireFeature().
 * Returns a structured UpgradeInfo on match, null otherwise.
 */
export function detectUpgradeError(err: unknown): UpgradeInfo | null {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const m = msg.match(/Feature "([^"]+)" requires PAiA (Pro|Team)/i);
  if (!m) return null;
  return { feature: m[1], targetTier: m[2].toLowerCase() as 'pro' | 'team' };
}

interface Props {
  info: UpgradeInfo;
  onClose: () => void;
  onOpenLicense: () => void;
}

export function UpgradePrompt({ info, onClose, onOpenLicense }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(containerRef, { onClose });

  const tierLabel = info.targetTier === 'team' ? 'Team' : 'Pro';

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal"
        ref={containerRef}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="upgrade-title"
        style={{ minWidth: 440, maxWidth: 520 }}
      >
        <div className="modal-title" id="upgrade-title">
          <span>✨ PAiA {tierLabel}</span>
        </div>
        <div className="modal-body">
          <p>
            <code>{info.feature}</code> is part of PAiA {tierLabel}.
          </p>

          <div className="upgrade-matrix">
            <div className={`upgrade-tier ${info.targetTier === 'pro' ? 'target' : ''}`}>
              <div className="upgrade-tier-name">Free</div>
              <div className="upgrade-tier-price">$0</div>
              <ul>
                <li>Chat, voice, screen capture</li>
                <li>Memory (200 entries)</li>
                <li>3 agent runs / day</li>
                <li>Local models only</li>
              </ul>
            </div>
            <div className={`upgrade-tier upgrade-tier-featured ${info.targetTier === 'pro' ? 'target' : ''}`}>
              <div className="upgrade-tier-name">Pro</div>
              <div className="upgrade-tier-price">$9 <small>/ mo</small></div>
              <ul>
                <li>Everything free, uncapped</li>
                <li>Agent + research + canvas</li>
                <li>Cloud providers, connectors</li>
                <li>Ambient, autopilot, plugins</li>
              </ul>
            </div>
            <div className={`upgrade-tier ${info.targetTier === 'team' ? 'target' : ''}`}>
              <div className="upgrade-tier-name">Team</div>
              <div className="upgrade-tier-price">$19 <small>/ seat</small></div>
              <ul>
                <li>Everything in Pro</li>
                <li>Classroom mode</li>
                <li>OS-level enforcement</li>
                <li>Min 5 seats, DPA</li>
              </ul>
            </div>
          </div>

          <p className="muted-note" style={{ fontSize: 11, marginTop: 12 }}>
            14-day trial unlocks every Pro feature — no card, no signup.
          </p>
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>Not now</button>
          <button
            type="button"
            className="secondary"
            onClick={() => void api.openExternal(`https://paia.app/pricing?feature=${encodeURIComponent(info.feature)}`)}
          >
            See full pricing
          </button>
          <button type="button" className="primary" onClick={() => { onOpenLicense(); onClose(); }}>
            Activate licence →
          </button>
        </div>
      </div>
    </div>
  );
}
