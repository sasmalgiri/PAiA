// Pack-specific banner that displays at the top of the chat panel when
// a pack-installed persona is active. Lets vertical packs surface the
// privacy/legal/safety posture appropriate to their domain.
//
// Banners are looked up by packId in a built-in registry. Adding a new
// vertical pack's banner means adding one entry here. (Future: move
// banner text into the pack manifest itself so registries can ship
// new packs without app-side changes.)

import type { Persona } from '../../shared/types';

interface Props {
  persona: Persona | undefined;
}

const PACK_BANNERS: Record<string, { emoji: string; title: string; body: string }> = {
  'paia-legal': {
    emoji: '⚖️',
    title: 'Attorney-client privilege posture',
    body: 'Treat PAiA output as draft work product, not legal advice. Do not paste confidential client information unless your firm has reviewed PAiA\'s data flow (everything is local by default; cloud calls require explicit per-turn consent in this pack).',
  },
  'paia-therapy': {
    emoji: '🩺',
    title: 'HIPAA / clinical confidentiality posture',
    body: 'Treat PAiA output as draft clinical work product, not clinical advice or decision support. The licensed clinician owns every clinical decision. PHI stays local by default; cloud calls disabled in this pack. If a session involves suicidal ideation, abuse disclosure, or imminent risk, follow your safety-planning protocol — 988 in US, 116 123 in EU.',
  },
};

export function PackBanner({ persona }: Props) {
  if (!persona?.packId) return null;
  const entry = PACK_BANNERS[persona.packId];
  if (!entry) return null;
  return (
    <div className="pack-banner" role="note" aria-label={entry.title}>
      <span className="pack-banner-icon" aria-hidden>{entry.emoji}</span>
      <div className="pack-banner-text">
        <div className="pack-banner-title">{entry.title}</div>
        <div className="pack-banner-body">{entry.body}</div>
      </div>
    </div>
  );
}
