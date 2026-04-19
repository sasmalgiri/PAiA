// First-run wizard — five steps:
//
//   0. Welcome + value proposition
//   1. Pick a language (applies to the whole UI immediately)
//   2. Get Ollama running + pick a model. OS-aware install guidance,
//      three curated model presets (lightweight / balanced / powerful),
//      plus the existing "pick from what's installed" fallback.
//   3. Appearance + voice defaults
//   4. You're set — three quick-start tips to seed the first-session experience.

import { useEffect, useMemo, useState } from 'react';
import type { LocaleId, Settings } from '../../shared/types';
import { api } from '../lib/api';
import { AVAILABLE_LOCALES, setLocale, useT } from '../lib/i18n';

interface OnboardingProps {
  settings: Settings;
  onComplete: (patch: Partial<Settings>) => void | Promise<void>;
}

interface ModelPreset {
  id: string;
  label: string;
  tagline: string;
  approxSizeGb: number;
  ramHintGb: number;
}

// Curated presets spanning the realistic hardware range. Kept short on
// purpose — if someone wants exotic models, they'll go to Settings →
// Models after onboarding.
const PRESETS: ModelPreset[] = [
  { id: 'llama3.2:3b', label: 'Lightweight — llama3.2 3B',
    tagline: 'Runs comfortably on any laptop. Great for chat, summaries, and quick answers.',
    approxSizeGb: 2, ramHintGb: 4 },
  { id: 'llama3.2',  label: 'Balanced — llama3.2 8B',
    tagline: 'Noticeably smarter. Needs ~8 GB free RAM. Good default for most users.',
    approxSizeGb: 4.7, ramHintGb: 8 },
  { id: 'qwen2.5-coder:7b', label: 'Coder — qwen2.5-coder 7B',
    tagline: 'Optimised for programming. Same RAM profile as llama3.2 8B.',
    approxSizeGb: 4.4, ramHintGb: 8 },
];

function platformLabel(p: string | undefined): string {
  if (p === 'darwin') return 'macOS';
  if (p === 'win32') return 'Windows';
  if (p === 'linux') return 'Linux';
  return p ?? 'unknown';
}

function installCommand(platform: string | undefined): { cmd: string; note: string } {
  if (platform === 'darwin') {
    return {
      cmd: 'curl -fsSL https://ollama.com/install.sh | sh',
      note: 'Paste into Terminal. Ollama installs as a LaunchAgent and starts immediately.',
    };
  }
  if (platform === 'linux') {
    return {
      cmd: 'curl -fsSL https://ollama.com/install.sh | sh',
      note: 'Paste into a shell. Works on Ubuntu, Debian, Fedora, Arch.',
    };
  }
  return {
    cmd: 'winget install Ollama.Ollama',
    note: 'Paste into PowerShell. If winget is unavailable, download from ollama.com/download.',
  };
}

export function Onboarding({ settings, onComplete }: OnboardingProps) {
  const { t } = useT();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Partial<Settings>>({
    theme: settings.theme,
    locale: settings.locale,
    sttEngine: settings.sttEngine,
    voiceLang: settings.voiceLang,
    ttsEnabled: settings.ttsEnabled,
    model: settings.model,
  });
  const [ollama, setOllama] = useState<{ reachable: boolean; models: string[] } | null>(null);
  const [pulling, setPulling] = useState<string | null>(null);
  const [pullStatus, setPullStatus] = useState('');
  const [platform, setPlatform] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void api.getAppInfo().then((info) => setPlatform(info.platform));
    void refreshOllama();
    const off = api.onOllamaPullProgress((p) => {
      const pct = p.total && p.completed ? Math.round((p.completed / p.total) * 100) : 0;
      setPullStatus(`${p.status}${pct ? ` ${pct}%` : ''}`);
    });
    return off;
  }, []);

  async function refreshOllama(): Promise<void> {
    const s = await api.ollamaStatus();
    setOllama({ reachable: s.reachable, models: s.models.map((m) => m.name) });
    if (s.models.length > 0 && !draft.model) {
      setDraft((d) => ({ ...d, model: s.models[0].name }));
    }
  }

  async function pullPreset(preset: ModelPreset): Promise<void> {
    setPulling(preset.id);
    setPullStatus('starting…');
    await api.ollamaPullModel(preset.id);
    await refreshOllama();
    setDraft((d) => ({ ...d, model: preset.id }));
    setPulling(null);
    setPullStatus('done');
  }

  async function copyInstallCmd(): Promise<void> {
    const { cmd } = installCommand(platform);
    try { await navigator.clipboard.writeText(cmd); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* best-effort */ }
  }

  const install = useMemo(() => installCommand(platform), [platform]);

  // When the user picks a locale mid-wizard, flip the i18n runtime so
  // downstream steps render in that language immediately.
  function setDraftLocale(l: LocaleId): void {
    setDraft((d) => ({ ...d, locale: l }));
    setLocale(l);
  }

  return (
    <section className="onboarding">
      <header className="panel-header drag">
        <div className="panel-title no-drag">{t('onboarding.welcome')}</div>
        <div className="panel-actions no-drag" style={{ gap: 4 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className={`onboarding-dot ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`} />
          ))}
        </div>
      </header>

      <div className="onboarding-body no-drag">
        {step === 0 && (
          <>
            <div className="onboarding-emoji">👋</div>
            <h2>{t('onboarding.tagline')}</h2>
            <p className="muted-note">
              PAiA lives as a small ball on your screen. Click it any time to chat,
              capture your screen, or talk. Everything runs locally — no cloud, no
              telemetry, no surveillance.
            </p>
            <ul className="onboarding-list">
              <li>🛡️ PII redacted locally before any prompt leaves your machine</li>
              <li>🎙 Offline voice (Whisper) + optional duplex mode</li>
              <li>📸 Screen capture + OCR — ask "what's on my screen?"</li>
              <li>🧠 Long-term memory, RAG, agent mode, canvas artifacts</li>
              <li>🏠 Plugins — control your smart home, connect Gmail, or bring your own</li>
            </ul>
            <div className="onboarding-buttons">
              <button type="button" className="primary" onClick={() => setStep(1)}>{t('onboarding.next')} →</button>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <div className="onboarding-emoji">🌐</div>
            <h2>Pick your language</h2>
            <p className="muted-note">
              PAiA's UI speaks seven languages so far. Pick yours now — you can change it
              later in Settings → General.
            </p>
            <div className="onboarding-choices">
              {AVAILABLE_LOCALES.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className={`onboarding-choice ${draft.locale === l.id ? 'active' : ''}`}
                  onClick={() => setDraftLocale(l.id)}
                >
                  {l.label}
                </button>
              ))}
            </div>
            <div className="onboarding-buttons">
              <button type="button" onClick={() => setStep(0)}>← Back</button>
              <button type="button" className="primary" onClick={() => setStep(2)}>{t('onboarding.next')} →</button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="onboarding-emoji">🤖</div>
            <h2>Connect a local model</h2>
            <p className="muted-note">
              PAiA runs language models locally through{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); void api.openExternal('https://ollama.com'); }}>Ollama</a>.
              It's a ~300 MB install; we don't bundle it so you can upgrade it independently.
            </p>

            {ollama === null && <p>Checking for Ollama…</p>}

            {ollama && !ollama.reachable && (
              <div className="onboarding-warn">
                <strong>Ollama isn't running yet.</strong>
                <p className="muted-note" style={{ marginTop: 4 }}>
                  Detected platform: <strong>{platformLabel(platform)}</strong>. Run this one-liner:
                </p>
                <div className="onboarding-cmd">
                  <code>{install.cmd}</code>
                  <button type="button" className="secondary" onClick={() => void copyInstallCmd()}>
                    {copied ? 'Copied ✓' : 'Copy'}
                  </button>
                </div>
                <p className="muted-note" style={{ fontSize: 11 }}>{install.note}</p>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button type="button" className="secondary" onClick={() => void api.openExternal('https://ollama.com/download')}>
                    Open download page
                  </button>
                  <button type="button" className="secondary" onClick={() => void refreshOllama()}>
                    I installed it — check again
                  </button>
                </div>
              </div>
            )}

            {ollama && ollama.reachable && (
              <>
                <p>Pick a starter model. PAiA will pull it into Ollama for you:</p>
                <div className="onboarding-choices">
                  {PRESETS.map((p) => {
                    const installed = ollama.models.includes(p.id);
                    const isPulling = pulling === p.id;
                    return (
                      <div key={p.id} className={`onboarding-preset ${draft.model === p.id ? 'active' : ''}`}>
                        <div className="onboarding-preset-head">
                          <strong>{p.label}</strong>
                          <span className="muted-note" style={{ fontSize: 11 }}>
                            ~{p.approxSizeGb} GB · needs ~{p.ramHintGb} GB RAM
                          </span>
                        </div>
                        <div className="muted-note" style={{ fontSize: 12 }}>{p.tagline}</div>
                        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                          {installed ? (
                            <button
                              type="button"
                              className={`secondary ${draft.model === p.id ? 'primary' : ''}`}
                              onClick={() => setDraft((d) => ({ ...d, model: p.id }))}
                            >
                              {draft.model === p.id ? '✓ Selected' : 'Use this'}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="primary"
                              disabled={!!pulling}
                              onClick={() => void pullPreset(p)}
                            >
                              {isPulling ? 'Downloading…' : 'Download'}
                            </button>
                          )}
                        </div>
                        {isPulling && pullStatus && (
                          <div className="muted-note" style={{ fontSize: 11, marginTop: 4 }}>{pullStatus}</div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {ollama.models.length > 0 && (
                  <details style={{ marginTop: 12 }}>
                    <summary className="muted-note">Or pick from {ollama.models.length} already-installed model(s)</summary>
                    <select
                      value={draft.model ?? ''}
                      onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                      style={{ marginTop: 6 }}
                    >
                      {ollama.models.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </details>
                )}
              </>
            )}

            <div className="onboarding-buttons">
              <button type="button" onClick={() => setStep(1)}>← Back</button>
              <button
                type="button"
                className="primary"
                disabled={!ollama?.reachable || !draft.model}
                onClick={() => setStep(3)}
              >
                {t('onboarding.next')} →
              </button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div className="onboarding-emoji">🎨</div>
            <h2>How would you like it to look?</h2>

            <label className="field">
              <span>Theme</span>
              <select
                value={draft.theme ?? 'system'}
                onChange={(e) => setDraft({ ...draft, theme: e.target.value as Settings['theme'] })}
              >
                <option value="system">Match system</option>
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </label>
            <label className="field">
              <span>Speech recognition</span>
              <select
                value={draft.sttEngine ?? 'chromium'}
                onChange={(e) => setDraft({ ...draft, sttEngine: e.target.value as Settings['sttEngine'] })}
              >
                <option value="chromium">Chromium (fast, online)</option>
                <option value="whisper">Whisper (fully offline)</option>
              </select>
            </label>
            <label className="field row">
              <span>Speak responses aloud</span>
              <input
                type="checkbox"
                checked={draft.ttsEnabled ?? true}
                onChange={(e) => setDraft({ ...draft, ttsEnabled: e.target.checked })}
              />
            </label>

            <div className="onboarding-buttons">
              <button type="button" onClick={() => setStep(2)}>← Back</button>
              <button type="button" className="primary" onClick={() => setStep(4)}>{t('onboarding.next')} →</button>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <div className="onboarding-emoji">🚀</div>
            <h2>You're all set.</h2>
            <p className="muted-note">Three things to try in your first session:</p>
            <ul className="onboarding-list">
              <li><strong>Ctrl/⌘+K</strong> — command palette. Jump to any thread, slash command, or action.</li>
              <li><strong>Ctrl+Alt+Q with text selected</strong> — quick actions popup (summarize, fix, translate, tone).</li>
              <li><strong>Drop a file or paste an image</strong> — the composer handles it; vision models answer about it.</li>
            </ul>
            <div className="onboarding-buttons">
              <button type="button" onClick={() => setStep(3)}>← Back</button>
              <button type="button" className="primary" onClick={() => void onComplete(draft)}>{t('onboarding.done')}</button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
