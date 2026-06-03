// Knowledge stack marketplace UI.
//
// Top section: installed packs (uninstall affordance per row).
// Bottom section: available packs from configured registries
//                 (browse, install with progress, refresh).
//
// "Install from file" supports sideloaded .paia-pack files for users
// who pulled a pack from outside the registry (Slack share, USB, etc).
// Signature verification is the gate regardless of source.

import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useConfirm } from '../lib/useConfirm';

interface AvailablePack {
  id: string;
  version: string;
  name: string;
  description: string;
  author: { name: string; url?: string };
  kind: 'vertical' | 'persona-only' | 'knowledge-only';
  requiresTier?: 'free' | 'pro' | 'team' | 'legal';
  downloadUrl: string;
  sizeBytes: number;
  iconUrl?: string;
  tags?: string[];
}

interface InstalledPack {
  id: string;
  name: string;
  version: string;
  installedAt: number;
  personaIds: string[];
  collectionIds: string[];
}

interface InstallProgress {
  packId: string;
  stage: 'verify' | 'personas' | 'collection' | 'ingest' | 'defaults' | 'done' | 'error';
  current?: number;
  total?: number;
  message?: string;
}

const KIND_LABEL: Record<AvailablePack['kind'], string> = {
  vertical: 'Vertical pack',
  'persona-only': 'Personas only',
  'knowledge-only': 'Knowledge only',
};

const TIER_LABEL: Record<NonNullable<AvailablePack['requiresTier']>, string> = {
  free: 'Free',
  pro: 'Pro',
  team: 'Team',
  legal: 'Legal',
};

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function PackInstaller() {
  const [installed, setInstalled] = useState<InstalledPack[]>([]);
  const [available, setAvailable] = useState<AvailablePack[]>([]);
  const [browsing, setBrowsing] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [error, setError] = useState('');
  const { confirm, modal } = useConfirm();

  const refreshInstalled = useCallback(async () => {
    try {
      setInstalled(await api.packsListInstalled());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const refreshAvailable = useCallback(async () => {
    setBrowsing(true);
    setError('');
    try {
      setAvailable(await api.packsListAvailable());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBrowsing(false);
    }
  }, []);

  useEffect(() => {
    void refreshInstalled();
    void refreshAvailable();
    const off = api.onPacksInstallProgress(setProgress);
    return off;
  }, [refreshInstalled, refreshAvailable]);

  async function doInstall(entry: AvailablePack) {
    const ok = await confirm({
      title: `Install ${entry.name} ${entry.version}?`,
      description: `From ${entry.author.name} · ${fmtBytes(entry.sizeBytes)}. ${entry.description}`,
      confirmLabel: 'Install',
      variant: 'primary',
    });
    if (!ok) return;
    setInstalling(entry.id);
    setError('');
    setProgress({ packId: entry.id, stage: 'verify', message: 'Downloading…' });
    try {
      const res = await api.packsInstall({ entry, applyDefaults: true });
      if (!res.ok) {
        setError(res.error);
      } else {
        await refreshInstalled();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInstalling(null);
      setProgress(null);
    }
  }

  async function doUninstall(pack: InstalledPack) {
    const ok = await confirm({
      title: `Uninstall ${pack.name}?`,
      description: `Removes ${pack.personaIds.length} persona${pack.personaIds.length === 1 ? '' : 's'} and ${pack.collectionIds.length} knowledge collection${pack.collectionIds.length === 1 ? '' : 's'}, including all their documents. Threads currently using these personas will fall back to Default.`,
      confirmLabel: 'Uninstall pack',
      variant: 'danger',
    });
    if (!ok) return;
    setError('');
    const res = await api.packsUninstall(pack.id);
    if (!res.ok) {
      setError(res.error);
    } else {
      await refreshInstalled();
    }
  }

  return (
    <div className="settings-form">
      {modal}

      <div className="muted-note" style={{ marginBottom: 10 }}>
        Knowledge stack packs bundle personas + RAG collections curated for a domain (Legal, Engineering, etc.). Signatures are verified against PAiA's signing key; an unsigned or tampered pack is refused.
      </div>

      {/* Installed */}
      <div className="settings-section">
        <div className="settings-section-title">Installed packs ({installed.length})</div>
        {installed.length === 0 ? (
          <div className="muted-note" style={{ padding: '10px 12px', border: '1px dashed var(--border)', borderRadius: 6 }}>
            No packs installed yet. Browse below or use Install from file.
          </div>
        ) : (
          <div className="pack-list">
            {installed.map((p) => (
              <div key={p.id} className="pack-row">
                <div className="pack-row-info">
                  <div className="pack-row-name"><strong>{p.name}</strong> <span className="muted-note">v{p.version}</span></div>
                  <div className="muted-note" style={{ fontSize: 11 }}>
                    {p.personaIds.length} persona{p.personaIds.length === 1 ? '' : 's'} · {p.collectionIds.length} collection{p.collectionIds.length === 1 ? '' : 's'} · installed {new Date(p.installedAt).toLocaleDateString()}
                  </div>
                </div>
                <button type="button" className="danger small" onClick={() => void doUninstall(p)}>
                  Uninstall
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Available */}
      <div className="settings-section">
        <div className="settings-section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>Available packs</span>
          <button type="button" className="small" onClick={() => void refreshAvailable()} disabled={browsing}>
            {browsing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        {browsing && available.length === 0 ? (
          <div className="muted-note">Fetching registries…</div>
        ) : available.length === 0 ? (
          <div className="muted-note" style={{ padding: '10px 12px', border: '1px dashed var(--border)', borderRadius: 6 }}>
            No packs available in the configured registries. Default registry: GitHub releases of the PAiA repo. Edit <code>Settings → Privacy → Pack registries</code> to add a third-party registry.
          </div>
        ) : (
          <div className="pack-list">
            {available.map((entry) => {
              const installedAlready = installed.find((p) => p.id === entry.id);
              const isInstalling = installing === entry.id;
              return (
                <div key={entry.id} className={`pack-row ${entry.requiresTier === 'legal' || entry.requiresTier === 'team' || entry.requiresTier === 'pro' ? 'pack-paid' : ''}`}>
                  <div className="pack-row-info">
                    <div className="pack-row-name">
                      <strong>{entry.name}</strong>{' '}
                      <span className="muted-note">v{entry.version}</span>{' '}
                      <span className="badge">{KIND_LABEL[entry.kind]}</span>
                      {entry.requiresTier && entry.requiresTier !== 'free' && (
                        <span className="badge accent" title={`Requires ${TIER_LABEL[entry.requiresTier]} tier`}>{TIER_LABEL[entry.requiresTier]}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, marginTop: 4 }}>{entry.description}</div>
                    <div className="muted-note" style={{ fontSize: 11, marginTop: 4 }}>
                      {entry.author.name} · {fmtBytes(entry.sizeBytes)}
                      {entry.tags && entry.tags.length > 0 && ` · ${entry.tags.join(', ')}`}
                    </div>
                  </div>
                  {installedAlready ? (
                    installedAlready.version === entry.version ? (
                      <span className="badge ok" title="Already installed">Installed</span>
                    ) : (
                      <button type="button" className="small" disabled>
                        Update available (uninstall first)
                      </button>
                    )
                  ) : (
                    <button
                      type="button"
                      className="primary small"
                      disabled={isInstalling || installing !== null}
                      onClick={() => void doInstall(entry)}
                    >
                      {isInstalling ? 'Installing…' : 'Install'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {progress && progress.stage !== 'done' && (
        <div className="pack-progress" role="status" aria-live="polite">
          <div className="pack-progress-stage">
            {progress.stage}{progress.current && progress.total ? ` · ${progress.current}/${progress.total}` : ''}
          </div>
          {progress.message && <div className="muted-note">{progress.message}</div>}
        </div>
      )}

      {error && (
        <div className="muted-note" style={{ color: 'var(--danger, #d66)', padding: '8px 10px', background: 'rgba(214,102,102,0.08)', border: '1px solid rgba(214,102,102,0.25)', borderRadius: 6 }}>
          {error}
        </div>
      )}
    </div>
  );
}
