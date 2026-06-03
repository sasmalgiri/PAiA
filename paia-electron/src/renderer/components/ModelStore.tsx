// Hardware-aware model recommender.
//
// Reads the hardware probe, shows the user's detected tier, and offers
// 2–4 model recommendations tuned to that tier. Each card surfaces:
//   - display name + parameter count
//   - context window
//   - approx download size
//   - what it's best for
//   - install button (gated by confirm for >10 GB downloads)
//
// A "Show models for other tiers" expander lets power users override
// the recommendation (e.g. accept VRAM thrashing for higher quality).

import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { HardwareInfo, HardwareTier, ModelRecommendation, OllamaPullProgress } from '../../shared/types';

const TIER_LABELS: Record<HardwareTier, string> = {
  lightweight: 'Lightweight',
  comfortable: 'Comfortable',
  strong: 'Strong',
  'moe-class': 'MoE-class',
};

const TIER_BLURBS: Record<HardwareTier, string> = {
  lightweight: 'Small fast models that fit on any machine. Good for chat, quick tasks.',
  comfortable: '8–16B models give noticeably better answers without melting your machine. The sweet spot for most users.',
  strong: '32–70B models approach near-frontier quality locally. Slow on CPU, comfortable on a recent GPU or Apple Silicon.',
  'moe-class': 'Mixture-of-experts models: high quality with reasonable speed if you have the RAM/VRAM to host them.',
};

interface Props {
  /** Called when the user successfully installs and selects a model. */
  onModelSelected?: (qualifiedName: string) => void;
  /** Compact mode hides the descriptive copy — used in Settings. */
  compact?: boolean;
}

export function ModelStore({ onModelSelected, compact }: Props) {
  const [hw, setHw] = useState<HardwareInfo | null>(null);
  const [recs, setRecs] = useState<ModelRecommendation[]>([]);
  const [shownTier, setShownTier] = useState<HardwareTier | null>(null);
  const [installed, setInstalled] = useState<string[]>([]);
  const [pulling, setPulling] = useState<string | null>(null);
  const [pullStatus, setPullStatus] = useState('');
  const [pullPct, setPullPct] = useState(0);
  const [showOther, setShowOther] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const probe = await api.hardwareProbe();
        setHw(probe);
        setShownTier(probe.tier);
        const r = await api.hardwareRecommendations(probe.tier);
        setRecs(r);
        const ollama = await api.ollamaStatus();
        setInstalled(ollama.models.map((m) => m.name));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  useEffect(() => {
    const off = api.onOllamaPullProgress((p: OllamaPullProgress) => {
      const pct = p.total && p.completed ? Math.round((p.completed / p.total) * 100) : 0;
      setPullStatus(p.status);
      setPullPct(pct);
    });
    return off;
  }, []);

  async function switchTier(tier: HardwareTier) {
    setShownTier(tier);
    try {
      const r = await api.hardwareRecommendations(tier);
      setRecs(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function reprobe() {
    try {
      const probe = await api.hardwareProbe(true);
      setHw(probe);
      setShownTier(probe.tier);
      const r = await api.hardwareRecommendations(probe.tier);
      setRecs(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function install(rec: ModelRecommendation) {
    if (rec.warnLargeDownload || rec.approxSizeGb > 10) {
      const ok = confirm(
        `${rec.displayName} is about ${rec.approxSizeGb.toFixed(0)} GB and may take a while to download. Proceed?`,
      );
      if (!ok) return;
    }
    setPulling(rec.ollamaName);
    setPullStatus('starting…');
    setPullPct(0);
    try {
      const ok = await api.ollamaPullModel(rec.ollamaName);
      if (!ok) {
        setError(`Failed to pull ${rec.ollamaName}.`);
      } else {
        const ollama = await api.ollamaStatus();
        setInstalled(ollama.models.map((m) => m.name));
        // Set as default model and persist the tier choice.
        await api.saveSettings({ model: rec.ollamaName, defaultModelTier: shownTier ?? undefined });
        onModelSelected?.(rec.ollamaName);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPulling(null);
      setPullStatus('');
      setPullPct(0);
    }
  }

  async function useExisting(rec: ModelRecommendation) {
    await api.saveSettings({ model: rec.ollamaName, defaultModelTier: shownTier ?? undefined });
    onModelSelected?.(rec.ollamaName);
  }

  if (error && !hw) {
    return (
      <div className="model-store" style={{ padding: 12 }}>
        <div className="muted-note">Hardware probe failed: {error}</div>
        <button type="button" className="small" onClick={() => void reprobe()}>Retry</button>
      </div>
    );
  }
  if (!hw) {
    return <div className="model-store muted-note" style={{ padding: 12 }}>Detecting hardware…</div>;
  }

  const gpuLine = hw.gpu
    ? `${hw.gpu.name}${hw.gpu.vramGb ? ` · ${hw.gpu.vramGb} GB VRAM` : ''}`
    : 'no dedicated GPU detected';

  return (
    <div className="model-store">
      <header className="model-store-header">
        <div>
          <div className="model-store-tier">{TIER_LABELS[hw.tier]}</div>
          <div className="muted-note">
            {hw.totalRamGb} GB RAM · {hw.cpuThreads} CPU threads · {gpuLine}
          </div>
        </div>
        <button
          type="button"
          className="small"
          onClick={() => void reprobe()}
          title="Re-detect hardware (after RAM/GPU change)"
        >
          Re-probe
        </button>
      </header>

      {!compact && shownTier && (
        <div className="muted-note" style={{ margin: '8px 0 12px' }}>{TIER_BLURBS[shownTier]}</div>
      )}

      <div className="model-store-grid">
        {recs.map((rec, idx) => {
          const isInstalled = installed.some((n) => n === rec.ollamaName || n === rec.ollamaName.split(':')[0]);
          const isPulling = pulling === rec.ollamaName;
          return (
            <article key={rec.ollamaName} className={`model-card ${idx === 0 ? 'recommended' : ''}`}>
              <div className="model-card-head">
                <h4>{rec.displayName}</h4>
                {idx === 0 && <span className="badge accent">Recommended</span>}
                {isInstalled && <span className="badge ok">Installed</span>}
              </div>
              <div className="model-card-specs muted-note">
                {rec.paramsB}B params · {rec.contextK}k context · ~{rec.approxSizeGb.toFixed(0)} GB
              </div>
              <div className="model-card-tags">
                {rec.bestFor.map((t) => (
                  <span key={t} className="tag">{t}</span>
                ))}
              </div>
              {isPulling ? (
                <div className="model-card-pull">
                  <div className="model-card-progress">
                    <div className="model-card-progress-bar" style={{ width: `${pullPct}%` }} />
                  </div>
                  <div className="muted-note" style={{ fontSize: 11 }}>{pullStatus}{pullPct ? ` · ${pullPct}%` : ''}</div>
                </div>
              ) : isInstalled ? (
                <button type="button" className="primary small" onClick={() => void useExisting(rec)}>
                  Use this model
                </button>
              ) : (
                <button
                  type="button"
                  className="primary small"
                  disabled={!!pulling}
                  onClick={() => void install(rec)}
                >
                  Install ({rec.approxSizeGb.toFixed(0)} GB)
                </button>
              )}
            </article>
          );
        })}
      </div>

      <details
        open={showOther}
        onToggle={(e) => setShowOther((e.target as HTMLDetailsElement).open)}
        className="model-store-other"
      >
        <summary className="muted-note">Show models for other hardware tiers</summary>
        <div className="model-store-tier-buttons">
          {(['lightweight', 'comfortable', 'strong', 'moe-class'] as HardwareTier[]).map((t) => (
            <button
              key={t}
              type="button"
              className={`small ${shownTier === t ? 'primary' : ''}`}
              onClick={() => void switchTier(t)}
            >
              {TIER_LABELS[t]}
            </button>
          ))}
        </div>
        <div className="muted-note" style={{ fontSize: 11, marginTop: 6 }}>
          Picking a higher tier than your hardware supports will be slow but may still work — at the limit, Ollama swaps to CPU.
        </div>
      </details>

      {error && (
        <div className="muted-note" style={{ color: 'var(--danger, #d66)', marginTop: 8 }}>{error}</div>
      )}
    </div>
  );
}
