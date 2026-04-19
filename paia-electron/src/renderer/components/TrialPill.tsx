// Small status pill in the panel header. Three states:
//
//   trial + > 5 days left   → grey chip "Trial N days"
//   trial + ≤ 5 days left   → amber chip, slight urgency
//   trial expired today     → red chip "Trial ended"
//   license active          → green chip "Pro" / "Team"
//   free (never started trial, or trial long past) → quiet "Upgrade"
//
// Clicking opens Settings → License.

import { useEffect, useState } from 'react';
import type { LicenseStatus } from '../../shared/types';
import { api } from '../lib/api';

interface Props {
  onOpenLicense: () => void;
}

export function TrialPill({ onOpenLicense }: Props) {
  const [status, setStatus] = useState<LicenseStatus | null>(null);

  useEffect(() => {
    void api.licenseStatus().then(setStatus);
    // Refresh every minute so a trial that ticks over to "expired" while
    // the app's open updates visibly.
    const t = setInterval(() => void api.licenseStatus().then(setStatus), 60_000);
    // Also refresh whenever the user focuses the window — activating a
    // licence in Settings and coming back should show Pro immediately.
    const onFocus = (): void => { void api.licenseStatus().then(setStatus); };
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  if (!status) return null;

  // Paid license path — tiny green pill.
  if (status.source === 'license') {
    return (
      <button
        type="button"
        className="trial-pill trial-pill-pro"
        onClick={onOpenLicense}
        title={`Activated: ${status.license?.email ?? ''}`}
        aria-label={`PAiA ${status.effectiveTier.toUpperCase()} license active`}
      >
        {status.effectiveTier === 'team' ? 'Team' : 'Pro'}
      </button>
    );
  }

  // Trial path.
  if (status.source === 'trial') {
    const left = status.trialDaysLeft ?? 0;
    const urgent = left <= 5;
    return (
      <button
        type="button"
        className={`trial-pill ${urgent ? 'trial-pill-urgent' : 'trial-pill-trial'}`}
        onClick={onOpenLicense}
        title={`Trial ends ${status.trialEndsAt ? new Date(status.trialEndsAt).toLocaleDateString() : 'soon'} — click to activate`}
        aria-label={`Trial: ${left} days left. Click to activate a licence.`}
      >
        Trial · {left}d
      </button>
    );
  }

  // Free (post-trial or first-launch free user).
  return (
    <button
      type="button"
      className="trial-pill trial-pill-free"
      onClick={onOpenLicense}
      aria-label="Upgrade to PAiA Pro"
    >
      ✨ Upgrade
    </button>
  );
}
