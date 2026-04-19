// Full settings view. Uses tabs to keep the panel narrow:
//   General · Models · Personas · Voice · Hotkeys · About
//
// All writes go through the onSave callback which persists via the
// preload bridge.

import { useEffect, useState } from 'react';
import type {
  AgentAutonomy,
  ConnectorConfig,
  ConnectorDescriptor,
  ConnectorId,
  ConnectorStatus,
  HotkeyMap,
  KnowledgeCollection,
  KnowledgeDocument,
  LicenseStatus,
  McpServerConfig,
  McpServerState,
  MemoryEntry,
  MemoryScope,
  OllamaModel,
  Persona,
  PiperStatus,
  PiperVoice,
  ProviderConfig,
  ProviderState,
  ScheduleAction,
  ScheduleTrigger,
  ScheduledTask,
  Settings,
  WakeWordState,
} from '../../shared/types';
import { api } from '../lib/api';
import { ClassroomTab } from './Classroom';
import { AVAILABLE_LOCALES } from '../lib/i18n';

interface SettingsViewProps {
  settings: Settings;
  personas: Persona[];
  onSave: (patch: Partial<Settings>) => Promise<void>;
  onBack: () => void;
  onPersonasChanged: () => void | Promise<void>;
  onQuit: () => void;
}

type Tab =
  | 'general'
  | 'models'
  | 'personas'
  | 'knowledge'
  | 'tools'
  | 'agent'
  | 'memory'
  | 'connectors'
  | 'schedule'
  | 'classroom'
  | 'ambient'
  | 'plugins'
  | 'enforcement'
  | 'media'
  | 'sync'
  | 'companion'
  | 'remote-browser'
  | 'api'
  | 'beta'
  | 'voice'
  | 'hotkeys'
  | 'privacy'
  | 'license'
  | 'about';

// Settings are grouped so a user with a specific goal doesn't have to
// scan 24 flat tabs. Each group carries a short label + icon; the
// search field does a live substring match against tab ids + labels +
// known keywords so "language" / "shortcut" / "team" all find the right
// tab without knowing its name.
interface TabMeta {
  id: Tab;
  label: string;
  /** Free-form keywords searched in addition to label. */
  keywords: string;
}
interface TabGroup {
  id: string;
  label: string;
  emoji: string;
  tabs: TabMeta[];
}
const TAB_GROUPS: TabGroup[] = [
  {
    id: 'basics', label: 'Basics', emoji: '👋',
    tabs: [
      { id: 'general', label: 'General', keywords: 'theme language locale startup always-on-top' },
      { id: 'voice', label: 'Voice', keywords: 'speech mic whisper tts piper wake word duplex' },
      { id: 'hotkeys', label: 'Hotkeys', keywords: 'shortcut keybinding keyboard' },
      { id: 'privacy', label: 'Privacy', keywords: 'telemetry crash reports analytics data' },
    ],
  },
  {
    id: 'ai', label: 'AI & chat', emoji: '🤖',
    tabs: [
      { id: 'models', label: 'Models', keywords: 'ollama openai anthropic provider api key' },
      { id: 'personas', label: 'Personas', keywords: 'system prompt character assistant' },
      { id: 'knowledge', label: 'Knowledge', keywords: 'rag documents embed collection' },
      { id: 'memory', label: 'Memory', keywords: 'remember recall fact preference episode' },
      { id: 'tools', label: 'MCP tools', keywords: 'mcp model context protocol server' },
    ],
  },
  {
    id: 'power', label: 'Power features', emoji: '⚡',
    tabs: [
      { id: 'agent', label: 'Agent', keywords: 'autonomous tool-use plan act observe' },
      { id: 'ambient', label: 'Ambient / autopilot', keywords: 'proactive watch clipboard rule' },
      { id: 'schedule', label: 'Scheduler', keywords: 'cron recurring interval one-shot' },
      { id: 'media', label: 'Media', keywords: 'image video generation dalle stability comfyui' },
      { id: 'connectors', label: 'Connectors', keywords: 'gmail calendar drive github slack oauth' },
      { id: 'plugins', label: 'Plugins', keywords: 'extension sdk home-assistant' },
    ],
  },
  {
    id: 'network', label: 'Network & devices', emoji: '🌐',
    tabs: [
      { id: 'sync', label: 'Sync', keywords: 'webdav s3 folder encryption passphrase backup' },
      { id: 'companion', label: 'Companion (phone)', keywords: 'pwa mobile qr lan pair' },
      { id: 'api', label: 'Local API', keywords: 'rest curl raycast script' },
      { id: 'remote-browser', label: 'Remote browser', keywords: 'cdp chrome chromium docker' },
    ],
  },
  {
    id: 'education', label: 'Classroom / lab', emoji: '🏫',
    tabs: [
      { id: 'classroom', label: 'Classroom', keywords: 'teacher student lock policy' },
      { id: 'enforcement', label: 'OS enforcement', keywords: 'firewall hosts iptables block sites' },
    ],
  },
  {
    id: 'account', label: 'Account', emoji: '👤',
    tabs: [
      { id: 'license', label: 'License', keywords: 'pro team activate trial referral extension' },
      { id: 'beta', label: 'Beta & feedback', keywords: 'invite feedback' },
      { id: 'about', label: 'About', keywords: 'version update quit' },
    ],
  },
];

function matchesSearch(tab: TabMeta, query: string): boolean {
  if (!query.trim()) return true;
  const q = query.trim().toLowerCase();
  return tab.id.includes(q) || tab.label.toLowerCase().includes(q) || tab.keywords.toLowerCase().includes(q);
}

export function SettingsView({ settings, personas, onSave, onBack, onPersonasChanged, onQuit }: SettingsViewProps) {
  const [tab, setTab] = useState<Tab>('general');
  const [search, setSearch] = useState('');
  const searchActive = search.trim().length > 0;

  // Flatten for search mode — show every matching tab in one flat list.
  const flatMatches = TAB_GROUPS.flatMap((g) =>
    g.tabs.filter((t) => matchesSearch(t, search)).map((t) => ({ ...t, groupLabel: g.label, groupEmoji: g.emoji })),
  );

  return (
    <section className="settings">
      <header className="panel-header drag">
        <div className="panel-title no-drag">Settings</div>
        <div className="panel-actions no-drag">
          <button type="button" className="icon-btn" onClick={onBack} title="Back" aria-label="Back">←</button>
        </div>
      </header>

      <div className="settings-search-wrap no-drag">
        <input
          type="search"
          className="settings-search"
          placeholder="Search settings…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search settings"
        />
      </div>

      <nav className="settings-tabs-grouped no-drag" aria-label="Settings sections">
        {searchActive ? (
          flatMatches.length === 0 ? (
            <div className="settings-empty-search">No settings match "{search}".</div>
          ) : (
            flatMatches.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`settings-tab ${tab === m.id ? 'active' : ''}`}
                onClick={() => setTab(m.id)}
                aria-current={tab === m.id ? 'page' : undefined}
              >
                <span className="settings-tab-group">{m.groupEmoji} {m.groupLabel}</span>
                <span className="settings-tab-label">{m.label}</span>
              </button>
            ))
          )
        ) : (
          TAB_GROUPS.map((g) => (
            <div key={g.id} className="settings-tab-group-block">
              <div className="settings-tab-group-header">{g.emoji} {g.label}</div>
              {g.tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`settings-tab ${tab === t.id ? 'active' : ''}`}
                  onClick={() => setTab(t.id)}
                  aria-current={tab === t.id ? 'page' : undefined}
                >
                  {t.label}
                </button>
              ))}
            </div>
          ))
        )}
      </nav>

      <div className="settings-body no-drag">
        {tab === 'general' && <GeneralTab settings={settings} onSave={onSave} />}
        {tab === 'models' && <ModelsTab settings={settings} onSave={onSave} />}
        {tab === 'personas' && (
          <PersonasTab personas={personas} onChanged={onPersonasChanged} />
        )}
        {tab === 'knowledge' && <KnowledgeTab />}
        {tab === 'tools' && <ToolsTab />}
        {tab === 'agent' && <AgentTab settings={settings} onSave={onSave} />}
        {tab === 'memory' && <MemoryTab />}
        {tab === 'connectors' && <ConnectorsTab />}
        {tab === 'schedule' && <ScheduleTab />}
        {tab === 'classroom' && <ClassroomTab />}
        {tab === 'enforcement' && <EnforcementTab />}
        {tab === 'ambient' && <AmbientTab settings={settings} onSave={onSave} />}
        {tab === 'plugins' && <PluginsTab settings={settings} onSave={onSave} />}
        {tab === 'media' && <MediaTab />}
        {tab === 'sync' && <SyncTab />}
        {tab === 'companion' && <CompanionTab />}
        {tab === 'remote-browser' && <RemoteBrowserTab />}
        {tab === 'api' && <ApiServerTab />}
        {tab === 'beta' && <BetaTab />}
        {tab === 'voice' && <VoiceTab settings={settings} onSave={onSave} />}
        {tab === 'hotkeys' && <HotkeysTab settings={settings} onSave={onSave} />}
        {tab === 'privacy' && <PrivacyTab settings={settings} onSave={onSave} />}
        {tab === 'license' && <LicenseTab />}
        {tab === 'about' && <AboutTab onQuit={onQuit} />}
      </div>
    </section>
  );
}

// ─── General ─────────────────────────────────────────────────────

function GeneralTab({ settings, onSave }: { settings: Settings; onSave: (p: Partial<Settings>) => Promise<void> }) {
  return (
    <div className="settings-form">
      <label className="field">
        <span>Theme</span>
        <select value={settings.theme} onChange={(e) => onSave({ theme: e.target.value as Settings['theme'] })}>
          <option value="system">System</option>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </label>
      <label className="field">
        <span>Language</span>
        <select value={settings.locale} onChange={(e) => onSave({ locale: e.target.value as Settings['locale'] })}>
          {AVAILABLE_LOCALES.map((l) => (
            <option key={l.id} value={l.id}>{l.label}</option>
          ))}
        </select>
      </label>
      <label className="field row">
        <span>Stay on top of all windows</span>
        <input type="checkbox" checked={settings.alwaysOnTop} onChange={(e) => onSave({ alwaysOnTop: e.target.checked })} />
      </label>
      <p className="muted-note">
        Keeps the panel visible over full-screen apps. Some screen-capture tools and
        DRM-protected video players may treat an always-on-top window as a recording
        overlay and refuse to play — disable this if that happens.
      </p>
      <label className="field row">
        <span>Start at login</span>
        <input type="checkbox" checked={settings.startAtLogin} onChange={(e) => onSave({ startAtLogin: e.target.checked })} />
      </label>
      <p className="muted-note">
        Launches PAiA hidden in the tray when you log in. On startup PAiA only
        makes network calls for features you've enabled: cloud models, sync,
        analytics, or the update check below.
      </p>
      <label className="field row">
        <span>Allow cloud models (opt-in)</span>
        <input type="checkbox" checked={settings.allowCloudModels} onChange={(e) => onSave({ allowCloudModels: e.target.checked })} />
      </label>
      <p className="muted-note">
        When enabled, you can configure cloud providers like OpenAI or Anthropic.
        Their inference servers will see your prompts. Disabled by default — PAiA's
        privacy guarantees only hold for local models.
      </p>
      <label className="field row">
        <span>Include active window context</span>
        <input type="checkbox" checked={settings.includeActiveWindow} onChange={(e) => onSave({ includeActiveWindow: e.target.checked })} />
      </label>
      <p className="muted-note">
        Tells PAiA the title and app of whatever window you had focused before opening
        the panel. Helps with "what about this?" questions. The detection runs locally
        — Windows uses a Win32 PowerShell call, macOS uses System Events, Linux uses xdotool.
      </p>
      <label className="field row">
        <span>Auto-update</span>
        <input type="checkbox" checked={settings.autoUpdate} onChange={(e) => onSave({ autoUpdate: e.target.checked })} />
      </label>
      <p className="muted-note">
        Checks GitHub Releases for signed builds roughly once a day. The update
        check sends only your platform and current version — no usage data, no
        IDs. Disable if you prefer to update PAiA manually.
      </p>
    </div>
  );
}

// ─── Models ──────────────────────────────────────────────────────

function ModelsTab({ settings, onSave }: { settings: Settings; onSave: (p: Partial<Settings>) => Promise<void> }) {
  const [installed, setInstalled] = useState<OllamaModel[]>([]);
  const [reachable, setReachable] = useState<boolean>(false);
  const [pullName, setPullName] = useState('llama3.2');
  const [pullStatus, setPullStatus] = useState('');
  const [pulling, setPulling] = useState(false);
  const [providerStates, setProviderStates] = useState<ProviderState[]>([]);
  const [providerConfigs, setProviderConfigs] = useState<ProviderConfig[]>([]);

  async function refresh() {
    const s = await api.ollamaStatus();
    setReachable(s.reachable);
    setInstalled(s.models);
    setProviderStates(await api.listProviderStates());
    setProviderConfigs(await api.getProviderConfigs());
  }

  useEffect(() => {
    void refresh();
    const off = api.onOllamaPullProgress((p) => {
      const pct = p.total && p.completed ? Math.round((p.completed / p.total) * 100) : 0;
      setPullStatus(`${p.status}${pct ? ` ${pct}%` : ''}`);
    });
    return off;
  }, []);

  async function doPull() {
    if (!pullName.trim()) return;
    setPulling(true);
    setPullStatus('starting…');
    const ok = await api.ollamaPullModel(pullName.trim());
    setPulling(false);
    setPullStatus(ok ? 'pull complete' : 'pull failed');
    await refresh();
  }

  async function doDelete(name: string) {
    if (!confirm(`Delete model "${name}"?`)) return;
    await api.ollamaDeleteModel(name);
    await refresh();
  }

  async function updateProviderConfig(id: string, patch: Partial<ProviderConfig>) {
    const next = providerConfigs.map((c) => (c.id === id ? { ...c, ...patch } : c));
    // Persist first — if the save fails, leave the UI showing the original
    // value so the user doesn't see a false "saved" state.
    await api.saveProviderConfigs(next);
    setProviderConfigs(next);
    await refresh();
  }

  // Build the union of all available qualified models for the default-model picker.
  const allQualified: { id: string; label: string }[] = [];
  for (const p of providerStates) {
    for (const m of p.models) {
      const id = `${p.id}:${m}`;
      allQualified.push({ id, label: `${p.isCloud ? '☁ ' : ''}${m}  (${p.name})` });
    }
  }
  // Bare ollama model names are still accepted by the dispatcher.
  for (const m of installed) {
    if (!allQualified.find((q) => q.id === `ollama:${m.name}`)) {
      allQualified.push({ id: m.name, label: `${m.name}  (Ollama)` });
    }
  }

  return (
    <div className="settings-form">
      <div className={`status-pill ${reachable ? 'ok' : 'bad'}`}>
        Ollama {reachable ? 'connected' : 'unreachable'} · {installed.length} model(s)
      </div>

      <div className="field">
        <span>Default model</span>
        <select value={settings.model} onChange={(e) => onSave({ model: e.target.value })}>
          <option value="">— pick one —</option>
          {allQualified.map((q) => (
            <option key={q.id} value={q.id}>{q.label}</option>
          ))}
        </select>
      </div>

      <div className="model-list">
        {installed.map((m) => (
          <div key={m.name} className="model-row">
            <div>
              <div className="model-name">{m.name}</div>
              <div className="model-size">{(m.size / 1e9).toFixed(2)} GB</div>
            </div>
            <button type="button" className="danger small" onClick={() => void doDelete(m.name)}>Delete</button>
          </div>
        ))}
      </div>

      <div className="field">
        <span>Pull a new model</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={pullName}
            disabled={pulling}
            onChange={(e) => setPullName(e.target.value)}
            placeholder="llama3.2"
          />
          <button type="button" className="primary" disabled={pulling} onClick={() => void doPull()}>
            {pulling ? 'Pulling…' : 'Pull'}
          </button>
        </div>
        {pullStatus && <div className="muted-note">{pullStatus}</div>}
      </div>

      {/* ── cloud providers ───────────────────────────── */}
      <div className="settings-section">
        <div className="settings-section-title">Cloud providers</div>
        {!settings.allowCloudModels && (
          <div className="muted-note">
            Cloud models are disabled. Enable <strong>Allow cloud models</strong> in Settings → General to use them.
          </div>
        )}
        {providerConfigs
          .filter((c) => c.id !== 'ollama')
          .map((c) => (
            <div key={c.id} className="provider-row">
              <div className="provider-head">
                <strong>
                  {c.id === 'openai' && 'OpenAI'}
                  {c.id === 'anthropic' && 'Anthropic'}
                  {c.id === 'openai-compatible' && 'OpenAI-compatible'}
                </strong>
                <label className="provider-toggle">
                  <input
                    type="checkbox"
                    checked={c.enabled}
                    disabled={!settings.allowCloudModels}
                    onChange={(e) => void updateProviderConfig(c.id, { enabled: e.target.checked })}
                  />
                  <span>{c.enabled ? 'Enabled' : 'Disabled'}</span>
                </label>
              </div>
              {c.enabled && settings.allowCloudModels && (
                <>
                  <input
                    type="password"
                    placeholder="API key"
                    value={c.apiKey ?? ''}
                    onChange={(e) => void updateProviderConfig(c.id, { apiKey: e.target.value })}
                  />
                  <p className="muted-note" style={{ margin: '4px 0 8px' }}>
                    Stored in the local SQLite database on this device — not encrypted
                    at rest beyond OS file permissions, and not synced. Create a
                    scoped key (read/inference only, no billing) when possible.
                  </p>
                  {c.id === 'openai-compatible' && (
                    <input
                      type="text"
                      placeholder="Base URL (e.g. https://api.together.xyz/v1)"
                      value={c.baseUrl ?? ''}
                      onChange={(e) => void updateProviderConfig(c.id, { baseUrl: e.target.value })}
                    />
                  )}
                  {(() => {
                    const st = providerStates.find((s) => s.id === c.id);
                    if (!st) return null;
                    return (
                      <div className={`status-pill ${st.reachable ? 'ok' : 'bad'}`}>
                        {st.reachable ? `Connected · ${st.models.length} model(s)` : `Unreachable: ${st.error ?? 'unknown'}`}
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}

// ─── Personas ────────────────────────────────────────────────────

function PersonasTab({ personas, onChanged }: { personas: Persona[]; onChanged: () => void | Promise<void> }) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('🤖');
  const [prompt, setPrompt] = useState('');

  const [createErr, setCreateErr] = useState('');
  async function create() {
    if (!name.trim() || !prompt.trim()) return;
    try {
      await api.createPersona({ name: name.trim(), emoji, systemPrompt: prompt.trim() });
      setName('');
      setEmoji('🤖');
      setPrompt('');
      setCreateErr('');
      await onChanged();
    } catch (e) {
      // Keep the form populated so the user can retry without re-typing.
      setCreateErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this persona?')) return;
    await api.deletePersona(id);
    await onChanged();
  }

  return (
    <div className="settings-form">
      <div className="persona-list">
        {personas.map((p) => (
          <div key={p.id} className="persona-row">
            <div className="persona-emoji">{p.emoji}</div>
            <div className="persona-info">
              <div className="persona-name">{p.name}{p.isBuiltin && <span className="badge">built-in</span>}</div>
              <div className="persona-prompt">{p.systemPrompt}</div>
            </div>
            {!p.isBuiltin && (
              <button type="button" className="danger small" onClick={() => void remove(p.id)}>Delete</button>
            )}
          </div>
        ))}
      </div>

      <div className="field">
        <span>Create a new persona</span>
        <input type="text" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input type="text" placeholder="Emoji" value={emoji} onChange={(e) => setEmoji(e.target.value)} />
        <textarea
          placeholder="System prompt — instructions for this persona"
          rows={4}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <button
          type="button"
          className="primary"
          disabled={!name.trim() || !prompt.trim()}
          onClick={() => void create()}
        >Create persona</button>
        {createErr && <div className="muted-note" style={{ color: 'var(--danger, #d66)' }}>{createErr}</div>}
      </div>
    </div>
  );
}

// ─── Knowledge ───────────────────────────────────────────────────

function KnowledgeTab() {
  const [collections, setCollections] = useState<KnowledgeCollection[]>([]);
  const [active, setActive] = useState<KnowledgeCollection | null>(null);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [embedModel, setEmbedModel] = useState('nomic-embed-text');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');

  async function refreshCollections() {
    const list = await api.listCollections();
    setCollections(list);
    if (active) {
      const stillThere = list.find((c) => c.id === active.id) ?? null;
      setActive(stillThere);
    }
  }

  async function refreshDocuments(collectionId: string) {
    setDocuments(await api.listDocuments(collectionId));
  }

  useEffect(() => {
    void refreshCollections();
    const off = api.onIngestProgress((p) => {
      if (active && p.collectionId !== active.id) return;
      const pct = p.total > 0 ? Math.round((p.current / p.total) * 100) : 0;
      setProgress(`${p.stage}: ${p.message ?? ''} ${pct ? pct + '%' : ''}`);
      if (p.stage === 'done' || p.stage === 'error') {
        setBusy(false);
        if (active) void refreshDocuments(active.id);
        void refreshCollections();
      }
    });
    return off;
  }, [active?.id]);

  useEffect(() => {
    if (active) void refreshDocuments(active.id);
    else setDocuments([]);
  }, [active?.id]);

  async function createNew() {
    if (!newName.trim()) return;
    const c = await api.createCollection({
      name: newName.trim(),
      description: newDesc.trim(),
      embeddingModel: embedModel,
    });
    setNewName('');
    setNewDesc('');
    await refreshCollections();
    setActive(c);
  }

  async function removeCollection(id: string) {
    if (!confirm('Delete this collection and all its documents?')) return;
    await api.deleteCollection(id);
    if (active?.id === id) setActive(null);
    await refreshCollections();
  }

  async function uploadFiles(files: FileList | null) {
    if (!files || !active) return;
    setBusy(true);
    for (const file of Array.from(files)) {
      setProgress(`Uploading ${file.name}…`);
      const buf = await file.arrayBuffer();
      const bytesBase64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      const result = await api.ingestDocument({
        collectionId: active.id,
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
        bytesBase64,
        embeddingModel: active.embeddingModel,
      });
      if (!result.ok) {
        setProgress(`Error: ${result.error}`);
        break;
      }
    }
    setBusy(false);
    if (active) await refreshDocuments(active.id);
    await refreshCollections();
  }

  async function removeDocument(id: string) {
    if (!confirm('Delete this document?')) return;
    await api.deleteDocument(id);
    if (active) await refreshDocuments(active.id);
    await refreshCollections();
  }

  return (
    <div className="settings-form">
      <p className="muted-note">
        Knowledge collections let PAiA answer questions using documents you provide.
        Files are chunked, embedded with a local Ollama model, and stored on disk.
        First time you use this, you may need to <code>ollama pull nomic-embed-text</code>.
      </p>

      <div className="knowledge-layout">
        <div className="knowledge-collections">
          <div className="knowledge-section-title">Collections</div>
          {collections.length === 0 && <div className="muted-note">No collections yet.</div>}
          {collections.map((c) => (
            <div
              key={c.id}
              className={`knowledge-coll ${active?.id === c.id ? 'active' : ''}`}
              onClick={() => setActive(c)}
            >
              <div className="knowledge-coll-name">📚 {c.name}</div>
              <div className="knowledge-coll-meta">{c.documentCount} docs · {c.chunkCount} chunks</div>
              <button
                type="button"
                className="knowledge-coll-x"
                onClick={(e) => {
                  e.stopPropagation();
                  void removeCollection(c.id);
                }}
              >×</button>
            </div>
          ))}

          <div className="knowledge-create">
            <input type="text" placeholder="Collection name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <input type="text" placeholder="Description (optional)" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
            <input type="text" placeholder="Embedding model" value={embedModel} onChange={(e) => setEmbedModel(e.target.value)} />
            <button type="button" className="primary" onClick={() => void createNew()}>＋ Create</button>
          </div>
        </div>

        <div className="knowledge-documents">
          <div className="knowledge-section-title">
            Documents {active ? `· ${active.name}` : ''}
          </div>
          {!active && <div className="muted-note">Pick a collection to manage its documents.</div>}
          {active && (
            <>
              <label className={`knowledge-drop ${busy ? 'busy' : ''}`}>
                {busy ? progress || 'Processing…' : 'Click or drop files (txt, md, json, csv, pdf)'}
                <input
                  type="file"
                  multiple
                  accept=".txt,.md,.markdown,.json,.csv,.log,.yml,.yaml,.xml,.html,.htm,.pdf,text/*,application/pdf"
                  disabled={busy}
                  style={{ display: 'none' }}
                  onChange={(e) => void uploadFiles(e.target.files)}
                />
              </label>
              {documents.length === 0 && !busy && <div className="muted-note">No documents yet.</div>}
              {documents.map((d) => (
                <div key={d.id} className="knowledge-doc">
                  <div className="knowledge-doc-info">
                    <div className="knowledge-doc-name">📄 {d.filename}</div>
                    <div className="knowledge-doc-meta">{(d.sizeBytes / 1024).toFixed(1)} KB · {d.chunkCount} chunks</div>
                  </div>
                  <button type="button" className="danger small" onClick={() => void removeDocument(d.id)}>Delete</button>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Tools (MCP) ─────────────────────────────────────────────────

function ToolsTab() {
  const [configs, setConfigs] = useState<McpServerConfig[]>([]);
  const [states, setStates] = useState<McpServerState[]>([]);
  const [editing, setEditing] = useState<McpServerConfig | null>(null);

  async function refresh() {
    setConfigs(await api.mcpListConfigs());
    setStates(await api.mcpListStates());
  }

  useEffect(() => {
    void refresh();
    const off = api.onMcpState(() => void refresh());
    return off;
  }, []);

  function blankConfig(): McpServerConfig {
    return {
      id: crypto.randomUUID(),
      name: '',
      command: '',
      args: [],
      env: {},
      enabled: true,
      autoApprove: [],
    };
  }

  async function saveAll(next: McpServerConfig[]) {
    setConfigs(next);
    await api.mcpSaveConfigs(next);
    await refresh();
  }

  async function deleteServer(id: string) {
    if (!confirm('Remove this MCP server?')) return;
    await saveAll(configs.filter((c) => c.id !== id));
  }

  function statusFor(id: string): McpServerState | undefined {
    return states.find((s) => s.config.id === id);
  }

  return (
    <div className="settings-form">
      <p className="muted-note">
        MCP (Model Context Protocol) lets PAiA call out to local tool servers — file access,
        web browsing, GitHub, databases, anything that speaks MCP. Every tool call requires
        your approval unless you whitelist it. Servers are spawned as child processes and
        talk over stdio.
      </p>

      {configs.length === 0 && (
        <div className="muted-note">No MCP servers configured. Add one below.</div>
      )}

      {configs.map((c) => {
        const st = statusFor(c.id);
        return (
          <div key={c.id} className="mcp-server">
            <div className="mcp-server-head">
              <strong>{c.name || '(unnamed)'}</strong>
              <span className={`mcp-status ${st?.status ?? 'stopped'}`}>{st?.status ?? 'stopped'}</span>
              <div style={{ flex: 1 }} />
              <button type="button" className="small" onClick={() => setEditing(c)}>Edit</button>
              <button type="button" className="danger small" onClick={() => void deleteServer(c.id)}>Delete</button>
            </div>
            <div className="mcp-server-cmd"><code>{c.command} {c.args.join(' ')}</code></div>
            {st?.error && <div className="mcp-error">⚠ {st.error}</div>}
            {st && st.tools.length > 0 && (
              <div className="mcp-tools">
                {st.tools.map((t) => (
                  <span key={t.name} className="mcp-tool" title={t.description}>{t.name}</span>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <button type="button" className="primary" onClick={() => setEditing(blankConfig())}>＋ Add MCP server</button>

      {editing && (
        <McpEditor
          config={editing}
          onCancel={() => setEditing(null)}
          onSave={async (next) => {
            const exists = configs.some((c) => c.id === next.id);
            const updated = exists
              ? configs.map((c) => (c.id === next.id ? next : c))
              : [...configs, next];
            await saveAll(updated);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function McpEditor({ config, onSave, onCancel }: { config: McpServerConfig; onSave: (c: McpServerConfig) => void | Promise<void>; onCancel: () => void }) {
  const [draft, setDraft] = useState<McpServerConfig>(config);

  return (
    <div className="mcp-editor">
      <div className="mcp-editor-title">{config.name ? `Edit ${config.name}` : 'New MCP server'}</div>

      <label className="field">
        <span>Display name</span>
        <input type="text" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="filesystem" />
      </label>
      <label className="field">
        <span>Command</span>
        <input type="text" value={draft.command} onChange={(e) => setDraft({ ...draft, command: e.target.value })} placeholder="npx" />
      </label>
      <label className="field">
        <span>Arguments (one per line)</span>
        <textarea
          rows={3}
          value={draft.args.join('\n')}
          onChange={(e) => setDraft({ ...draft, args: e.target.value.split('\n').filter(Boolean) })}
          placeholder={'-y\n@modelcontextprotocol/server-filesystem\n/path/to/folder'}
        />
      </label>
      <label className="field">
        <span>Environment (KEY=VALUE per line)</span>
        <textarea
          rows={2}
          value={Object.entries(draft.env).map(([k, v]) => `${k}=${v}`).join('\n')}
          onChange={(e) => {
            const env: Record<string, string> = {};
            for (const line of e.target.value.split('\n')) {
              const eq = line.indexOf('=');
              if (eq > 0) env[line.slice(0, eq)] = line.slice(eq + 1);
            }
            setDraft({ ...draft, env });
          }}
        />
      </label>
      <label className="field">
        <span>Auto-approve tools (one name per line — leave empty to require approval for everything)</span>
        <textarea
          rows={2}
          value={draft.autoApprove.join('\n')}
          onChange={(e) => setDraft({ ...draft, autoApprove: e.target.value.split('\n').filter(Boolean) })}
        />
      </label>
      <label className="field row">
        <span>Enabled</span>
        <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
      </label>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary" onClick={() => void onSave(draft)}>Save</button>
      </div>
    </div>
  );
}

// ─── Voice ───────────────────────────────────────────────────────

function VoiceTab({ settings, onSave }: { settings: Settings; onSave: (p: Partial<Settings>) => Promise<void> }) {
  const [piperVoices, setPiperVoices] = useState<PiperVoice[]>([]);
  const [piperStatus, setPiperStatus] = useState<PiperStatus | null>(null);
  const [piperProgress, setPiperProgress] = useState('');
  const [piperBusy, setPiperBusy] = useState(false);
  const [wakeWordKeywords, setWakeWordKeywords] = useState<string[]>([]);
  const [wakeWordState, setWakeWordState] = useState<WakeWordState | null>(null);

  async function refreshPiper() {
    setPiperVoices(await api.piperVoices());
    setPiperStatus(await api.piperStatus());
  }

  async function refreshWakeWord() {
    setWakeWordKeywords(await api.wakeWordKeywords());
    setWakeWordState(await api.wakeWordStatus());
  }

  useEffect(() => {
    void refreshPiper();
    void refreshWakeWord();
    const off = api.onPiperProgress((p) => {
      const pct = p.total > 0 ? Math.round((p.current / p.total) * 100) : 0;
      setPiperProgress(`${p.message} ${pct ? pct + '%' : ''}`);
      if (p.stage === 'done' || p.stage === 'error') {
        setPiperBusy(false);
        void refreshPiper();
      }
    });
    return off;
  }, [settings.wakeWordEnabled, settings.wakeWordAccessKey]);

  async function testPiperVoice() {
    setPiperBusy(true);
    setPiperProgress('Testing voice…');
    const result = await api.piperSynthesize(
      settings.piperVoice,
      'Hello! This is PAiA speaking with the Piper voice you selected.',
    );
    setPiperBusy(false);
    if (result.ok && result.wav) {
      const audio = new Audio(result.wav);
      void audio.play();
      setPiperProgress('Playing test sample.');
    } else {
      setPiperProgress(`Error: ${result.error ?? 'unknown'}`);
    }
  }

  async function deletePiperVoice(id: string) {
    if (!confirm(`Delete voice "${id}" from disk?`)) return;
    await api.piperDeleteVoice(id);
    await refreshPiper();
  }

  return (
    <div className="settings-form">
      {/* ── STT ────────────────────────────────────────── */}
      <div className="settings-section">
        <div className="settings-section-title">Speech recognition (STT)</div>
        <label className="field">
          <span>Engine</span>
          <select value={settings.sttEngine} onChange={(e) => onSave({ sttEngine: e.target.value as Settings['sttEngine'] })}>
            <option value="chromium">Chromium (fast, may use network)</option>
            <option value="whisper">Whisper (offline, downloads ~75 MB on first use)</option>
          </select>
        </label>
        <label className="field">
          <span>Language</span>
          <select value={settings.voiceLang} onChange={(e) => onSave({ voiceLang: e.target.value })}>
            <option value="en-US">English (US)</option>
            <option value="en-GB">English (UK)</option>
            <option value="en-IN">English (India)</option>
            <option value="hi-IN">Hindi (India)</option>
            <option value="es-ES">Spanish (Spain)</option>
            <option value="fr-FR">French (France)</option>
            <option value="de-DE">German</option>
            <option value="ja-JP">Japanese</option>
            <option value="zh-CN">Chinese (Mandarin)</option>
          </select>
        </label>
      </div>

      {/* ── TTS ────────────────────────────────────────── */}
      <div className="settings-section">
        <div className="settings-section-title">Speech synthesis (TTS)</div>
        <label className="field row">
          <span>Speak responses aloud</span>
          <input type="checkbox" checked={settings.ttsEnabled} onChange={(e) => onSave({ ttsEnabled: e.target.checked })} />
        </label>
        <label className="field">
          <span>Engine</span>
          <select value={settings.ttsEngine} onChange={(e) => onSave({ ttsEngine: e.target.value as Settings['ttsEngine'] })}>
            <option value="system">System (instant, OS-native voices)</option>
            <option value="piper">Piper (offline, neural, ~70 MB per voice)</option>
          </select>
        </label>

        {settings.ttsEngine === 'piper' && (
          <>
            <label className="field">
              <span>Piper voice</span>
              <select value={settings.piperVoice} onChange={(e) => onSave({ piperVoice: e.target.value })}>
                {piperVoices.map((v) => {
                  const installed = piperStatus?.installedVoices.includes(v.id);
                  return (
                    <option key={v.id} value={v.id}>
                      {installed ? '✓ ' : ''}{v.name}
                    </option>
                  );
                })}
              </select>
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="primary small" disabled={piperBusy} onClick={() => void testPiperVoice()}>
                {piperBusy ? 'Working…' : 'Test voice'}
              </button>
              {piperStatus && piperStatus.installedVoices.includes(settings.piperVoice) && (
                <button type="button" className="danger small" onClick={() => void deletePiperVoice(settings.piperVoice)}>
                  Delete voice from disk
                </button>
              )}
            </div>
            {piperProgress && <div className="muted-note">{piperProgress}</div>}
            <p className="muted-note">
              Piper downloads its binary (~6–25 MB) and your chosen voice (~60 MB) on
              first use into <code>{piperStatus?.cacheDir ?? 'userData/piper'}</code>.
              After that, all synthesis is fully offline.
            </p>
          </>
        )}
      </div>

      {/* ── wake word ──────────────────────────────────── */}
      <div className="settings-section">
        <div className="settings-section-title">Wake word</div>
        <label className="field row">
          <span>Listen for a wake word</span>
          <input type="checkbox" checked={settings.wakeWordEnabled} onChange={(e) => onSave({ wakeWordEnabled: e.target.checked })} />
        </label>
        {settings.wakeWordEnabled && (
          <>
            <label className="field">
              <span>Picovoice Access Key</span>
              <input
                type="password"
                placeholder="Get a free key at console.picovoice.ai"
                value={settings.wakeWordAccessKey}
                onChange={(e) => onSave({ wakeWordAccessKey: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Wake word</span>
              <select
                value={settings.wakeWordKeyword}
                onChange={(e) => onSave({ wakeWordKeyword: e.target.value })}
              >
                {wakeWordKeywords.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </label>
            {wakeWordState && (
              <div className={`status-pill ${wakeWordState.status === 'running' ? 'ok' : 'bad'}`}>
                Status: {wakeWordState.status}
                {wakeWordState.error ? ` — ${wakeWordState.error}` : ''}
              </div>
            )}
            <p className="muted-note">
              Wake word burns 5–15% of one CPU core continuously. The
              <code>@picovoice/porcupine-node</code> + <code>@picovoice/pvrecorder-node</code>
              packages are not bundled by default — install them in the app's directory if
              you see <em>no-package</em> status. Picovoice's free tier covers personal
              use; commercial use requires a paid license.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Hotkeys ─────────────────────────────────────────────────────

function HotkeysTab({ settings, onSave }: { settings: Settings; onSave: (p: Partial<Settings>) => Promise<void> }) {
  function update(key: keyof HotkeyMap, value: string) {
    void onSave({ hotkeys: { ...settings.hotkeys, [key]: value } });
  }
  return (
    <div className="settings-form">
      <p className="muted-note">
        Use Electron accelerator syntax — e.g. <code>Control+Alt+P</code>, <code>CommandOrControl+Shift+S</code>.
        Restart PAiA if a hotkey doesn't activate immediately.
      </p>
      <label className="field">
        <span>Show / hide PAiA</span>
        <input type="text" value={settings.hotkeys.showHide} onChange={(e) => update('showHide', e.target.value)} />
      </label>
      <label className="field">
        <span>Capture screen</span>
        <input type="text" value={settings.hotkeys.capture} onChange={(e) => update('capture', e.target.value)} />
      </label>
      <label className="field">
        <span>Push to talk</span>
        <input type="text" value={settings.hotkeys.pushToTalk} onChange={(e) => update('pushToTalk', e.target.value)} />
      </label>
      <label className="field">
        <span>Quick actions on selected text</span>
        <input type="text" value={settings.hotkeys.quickActions} onChange={(e) => update('quickActions', e.target.value)} />
      </label>
      <p className="muted-note">
        Quick actions reads from your clipboard. Workflow: select text in any app →
        Ctrl+C → press the hotkey → pick Explain / Translate / Rewrite / etc.
      </p>
    </div>
  );
}

// ─── Privacy / Telemetry ─────────────────────────────────────────

function PrivacyTab({ settings, onSave }: { settings: Settings; onSave: (p: Partial<Settings>) => Promise<void> }) {
  const [anonId, setAnonId] = useState<string | null>(null);

  useEffect(() => {
    void api.analyticsCurrentId().then(setAnonId);
  }, [settings.analyticsEnabled]);

  async function resetId() {
    if (!confirm('Reset your anonymous analytics ID? Future events will not be linkable to past ones.')) return;
    await api.analyticsResetId();
    setAnonId(await api.analyticsCurrentId());
  }

  return (
    <div className="settings-form">
      <p className="muted-note">
        PAiA collects nothing by default. The toggles below let you opt in to crash
        reports and anonymous usage analytics, with a DSN/endpoint <em>you</em> control.
        We will never bake in a default upstream — that's the entire point of this app.
      </p>

      <div className="settings-section">
        <div className="settings-section-title">Crash reports</div>
        <label className="field row">
          <span>Enable crash reports</span>
          <input type="checkbox" checked={settings.crashReportsEnabled} onChange={(e) => onSave({ crashReportsEnabled: e.target.checked })} />
        </label>
        {settings.crashReportsEnabled && (
          <>
            <label className="field">
              <span>Sentry / GlitchTip DSN</span>
              <input
                type="text"
                placeholder="https://abc123@sentry.io/12345"
                value={settings.crashReportsDsn}
                onChange={(e) => onSave({ crashReportsDsn: e.target.value })}
              />
            </label>
            <p className="muted-note">
              Restart PAiA after changing the DSN. We strip PII from messages and
              breadcrumbs using the same redaction rules the chat path uses, and we
              never attach chat history, knowledge contents, or screen captures.
            </p>
          </>
        )}
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Usage analytics</div>
        <label className="field row">
          <span>Enable anonymous analytics</span>
          <input type="checkbox" checked={settings.analyticsEnabled} onChange={(e) => onSave({ analyticsEnabled: e.target.checked })} />
        </label>
        {settings.analyticsEnabled && (
          <>
            <label className="field">
              <span>Endpoint URL (PostHog, Plausible custom events, your own webhook)</span>
              <input
                type="text"
                placeholder="https://your-analytics.example.com/ingest"
                value={settings.analyticsEndpoint}
                onChange={(e) => onSave({ analyticsEndpoint: e.target.value })}
              />
            </label>
            {anonId && (
              <div className="muted-note">
                Your anonymous ID: <code>{anonId}</code>
                <br />
                <button type="button" className="small" style={{ marginTop: 4 }} onClick={() => void resetId()}>
                  Reset anonymous ID
                </button>
              </div>
            )}
            <p className="muted-note">
              Events are POSTed as JSON. The property whitelist (set in
              <code>src/main/analytics.ts</code>) blocks anything outside
              <code>version</code>, <code>platform</code>, <code>feature</code>,
              <code>count</code>, <code>tier</code>, <code>persona</code>,
              <code>provider</code>, <code>success</code>, <code>duration_ms</code>.
              Chat content, file content, and voice recordings are never sent.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ─── License ─────────────────────────────────────────────────────

function LicenseTab() {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [raw, setRaw] = useState('');
  const [msg, setMsg] = useState('');
  const [extRaw, setExtRaw] = useState('');
  const [extMsg, setExtMsg] = useState('');
  const [meters, setMeters] = useState<Awaited<ReturnType<typeof api.meteringSnapshots>>>([]);

  async function refresh() {
    setStatus(await api.licenseStatus());
    setMeters(await api.meteringSnapshots());
  }

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(t);
  }, []);

  async function activate() {
    if (!raw.trim()) return;
    const result = await api.licenseActivateText(raw.trim());
    if (result.ok) {
      setMsg('License activated.');
      setRaw('');
      await refresh();
    } else {
      setMsg(`Error: ${result.reason ?? 'unknown'}`);
    }
  }

  async function deactivate() {
    if (!confirm('Remove this license from this machine?')) return;
    setStatus(await api.licenseDeactivate());
    setMsg('License removed.');
  }

  async function redeemExtension() {
    if (!extRaw.trim()) return;
    const r = await api.licenseRedeemExtension(extRaw.trim());
    if (r.ok) {
      setExtMsg(`✓ Trial extended by ${r.addedDays} day${r.addedDays === 1 ? '' : 's'}.`);
      setExtRaw('');
      await refresh();
    } else {
      setExtMsg(`Error: ${r.reason ?? 'unknown'}`);
    }
  }

  if (!status) return <div className="settings-form">Loading…</div>;

  return (
    <div className="settings-form">
      <div className={`license-status ${status.effectiveTier}`}>
        <div className="license-tier">{status.effectiveTier.toUpperCase()}</div>
        <div className="license-source">
          {status.source === 'license' && status.license && (
            <>
              Licensed to <strong>{status.license.name || status.license.email}</strong>
              {status.license.expiresAt
                ? ` · expires ${new Date(status.license.expiresAt).toLocaleDateString()}`
                : ' · perpetual'}
            </>
          )}
          {status.source === 'trial' && (
            <>Trial · {status.trialDaysLeft} day(s) remaining</>
          )}
          {status.source === 'free' && <>Free tier · trial expired</>}
        </div>
      </div>

      <div className="muted-note">
        Pro unlocks agent mode, deep research, canvas, cloud providers, connectors, scheduler,
        ambient/autopilot, web search, RAG, MCP, and plugins. The 14-day trial unlocks every Pro
        feature at install time.
      </div>

      {status.effectiveTier === 'free' && meters.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          <div className="muted-note"><strong>Free-tier usage</strong></div>
          {meters.filter((m) => m.capped).map((m) => {
            const pct = m.limit > 0 ? Math.min(100, Math.round((m.used / m.limit) * 100)) : 0;
            const warn = pct >= 80;
            return (
              <div key={m.kind} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                  <span>{m.label}</span>
                  <span className="muted-note">{m.used} / {m.limit}</span>
                </div>
                <div style={{ height: 4, background: 'var(--bg-2)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{
                    width: `${pct}%`, height: '100%',
                    background: pct >= 100 ? '#c0392b' : warn ? '#e67e22' : 'var(--accent)',
                    transition: 'width 0.3s ease',
                  }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {status.source !== 'license' && (
        <div className="field">
          <span>Activate a license</span>
          <textarea
            rows={6}
            placeholder='Paste the JSON license you received with your purchase here…'
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
          />
          <button type="button" className="primary" onClick={() => void activate()}>Activate</button>
        </div>
      )}
      {status.source === 'license' && (
        <button type="button" className="danger" onClick={() => void deactivate()}>
          Remove license from this machine
        </button>
      )}
      {msg && <div className="muted-note">{msg}</div>}

      {status.source !== 'license' && (
        <>
          <hr />
          <div className="muted-note">
            <strong>Trial extension / referral code.</strong> If someone shared a PAiA extension
            code with you (referral reward, beta bonus, compensation for an incident), paste it
            here to add days to your trial.
          </div>
          <label className="field">
            <span>Extension code (JSON or base64)</span>
            <textarea
              rows={4}
              placeholder="Paste the signed extension blob…"
              value={extRaw}
              onChange={(e) => setExtRaw(e.target.value)}
            />
          </label>
          <button type="button" className="primary" disabled={!extRaw.trim()} onClick={() => void redeemExtension()}>
            Redeem
          </button>
          {extMsg && <div className="muted-note" style={{ color: extMsg.startsWith('✓') ? '#27ae60' : '#c0392b' }}>{extMsg}</div>}
        </>
      )}

      {status.source === 'license' && status.license?.email && (
        <>
          <hr />
          <div className="muted-note">
            <strong>Share PAiA.</strong> Your personal referral link gives friends a discount and
            credits a free month to you when they upgrade.
          </div>
          <div className="onboarding-cmd">
            <code>{`https://paia.app/?ref=${encodeURIComponent(status.license.email)}`}</code>
            <button
              type="button"
              className="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(`https://paia.app/?ref=${encodeURIComponent(status.license!.email)}`);
              }}
            >
              Copy
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── About ───────────────────────────────────────────────────────

function AboutTab({ onQuit }: { onQuit: () => void }) {
  const [info, setInfo] = useState<{
    name: string;
    version: string;
    platform: string;
    arch: string;
    electron: string;
    node: string;
    userDataPath: string;
  } | null>(null);
  const [updateMsg, setUpdateMsg] = useState('');

  useEffect(() => {
    void api.getAppInfo().then(setInfo);
  }, []);

  async function check() {
    setUpdateMsg('Checking…');
    const r = await api.checkForUpdates();
    if (r.error) setUpdateMsg(`Error: ${r.error}`);
    else if (r.available) setUpdateMsg(`Update available: ${r.version}`);
    else setUpdateMsg('You are on the latest version.');
  }

  if (!info) return <div className="settings-form">Loading…</div>;

  return (
    <div className="settings-form">
      <div className="about-block">
        <div className="about-name">{info.name}</div>
        <div className="about-version">v{info.version}</div>
        <div className="about-meta">
          {info.platform}/{info.arch} · Electron {info.electron} · Node {info.node}
        </div>
        <div className="about-meta">Data: <code>{info.userDataPath}</code></div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="primary" onClick={() => void check()}>Check for updates</button>
        <button type="button" className="danger" onClick={onQuit}>Quit PAiA</button>
      </div>
      {updateMsg && <div className="muted-note">{updateMsg}</div>}
    </div>
  );
}

// ─── Agent ──────────────────────────────────────────────────────

function AgentTab({ settings, onSave }: { settings: Settings; onSave: (p: Partial<Settings>) => Promise<void> }) {
  const [rootsDraft, setRootsDraft] = useState(settings.agentAllowedRoots.join('\n'));

  function saveRoots(): void {
    const list = rootsDraft
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    void onSave({ agentAllowedRoots: list });
  }

  return (
    <div className="settings-form">
      <div className="muted-note">
        Agent mode lets PAiA plan and execute multi-step actions using tools (web, files, shell,
        screen, clipboard, memory, and any connected services). Every action goes through an
        approval gate based on the autonomy level you pick below.
      </div>
      <label className="field">
        <span>Autonomy</span>
        <select
          value={settings.agentAutonomy}
          onChange={(e) => void onSave({ agentAutonomy: e.target.value as AgentAutonomy })}
        >
          <option value="manual">Manual — approve every tool call</option>
          <option value="assisted">Assisted — auto-approve safe & low risk</option>
          <option value="autonomous">Autonomous — auto-approve everything except high risk</option>
        </select>
      </label>
      <label className="field">
        <span>Step budget (max tool calls per run)</span>
        <input
          type="number"
          min={1}
          max={50}
          value={settings.agentStepBudget}
          onChange={(e) => void onSave({ agentStepBudget: Math.max(1, Math.min(50, Number(e.target.value) || 12)) })}
        />
      </label>
      <label className="field row">
        <span>Allow filesystem tools (fs.read / fs.write / fs.list)</span>
        <input
          type="checkbox"
          checked={settings.agentAllowFs}
          onChange={(e) => void onSave({ agentAllowFs: e.target.checked })}
        />
      </label>
      <label className="field row">
        <span>Allow shell execution (shell.exec) — dangerous</span>
        <input
          type="checkbox"
          checked={settings.agentAllowShell}
          onChange={(e) => void onSave({ agentAllowShell: e.target.checked })}
        />
      </label>
      <label className="field">
        <span>Filesystem sandbox roots (one per line; empty = userData + temp + cwd)</span>
        <textarea
          rows={4}
          value={rootsDraft}
          onChange={(e) => setRootsDraft(e.target.value)}
          onBlur={saveRoots}
          placeholder="/home/me/projects"
        />
      </label>
    </div>
  );
}

// ─── Memory ─────────────────────────────────────────────────────

function MemoryTab() {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [text, setText] = useState('');
  const [scope, setScope] = useState<MemoryScope>('fact');

  async function refresh(): Promise<void> {
    setEntries(await api.memoryList());
  }

  useEffect(() => { void refresh(); }, []);

  async function add(): Promise<void> {
    const t = text.trim();
    if (!t) return;
    const res = await api.memoryAdd({ scope, text: t });
    if (!res.ok) { alert(res.error); return; }
    setText('');
    void refresh();
  }

  async function del(id: string): Promise<void> {
    if (!confirm('Forget this memory?')) return;
    await api.memoryDelete(id);
    void refresh();
  }

  return (
    <div className="settings-form">
      <div className="muted-note">
        Long-term memory survives across conversations. Pinned / preference / user entries are
        always injected into chats; facts and episodes are retrieved by semantic search.
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <select value={scope} onChange={(e) => setScope(e.target.value as MemoryScope)}>
          <option value="fact">Fact</option>
          <option value="preference">Preference</option>
          <option value="user">User</option>
          <option value="episode">Episode</option>
        </select>
        <input
          style={{ flex: 1 }}
          placeholder="Add a memory…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void add(); }}
        />
        <button type="button" className="primary" onClick={() => void add()}>Save</button>
      </div>
      <div className="memory-list">
        {entries.length === 0 && (
          <div className="muted-note" style={{ textAlign: 'center', padding: '16px 12px', border: '1px dashed var(--border)', borderRadius: 6 }}>
            No memories yet. Try saying <code>/remember I prefer concise answers</code> in the chat,
            or add one above — it'll be injected into every future conversation.
          </div>
        )}
        {entries.map((m) => (
          <div key={m.id} className="memory-entry">
            <span className="memory-scope">{m.scope}</span>
            <span className="memory-text">{m.text}</span>
            <button type="button" className="icon-btn" title="Forget" onClick={() => void del(m.id)}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Connectors ─────────────────────────────────────────────────

function ConnectorsTab() {
  const [rows, setRows] = useState<{ descriptor: ConnectorDescriptor; config: ConnectorConfig; status: ConnectorStatus }[]>([]);
  const [busy, setBusy] = useState<ConnectorId | null>(null);

  async function refresh(): Promise<void> {
    setRows(await api.connectorsList());
  }
  useEffect(() => { void refresh(); }, []);

  async function updateConfig(id: ConnectorId, patch: Partial<ConnectorConfig>): Promise<void> {
    const configs = rows.map((r) => (r.config.id === id ? { ...r.config, ...patch } : r.config));
    await api.connectorsSaveConfigs(configs);
    void refresh();
  }

  async function connect(id: ConnectorId): Promise<void> {
    setBusy(id);
    try {
      const res = await api.connectorsConnect(id);
      if (!res.ok) alert(`Connect failed: ${res.error}`);
    } finally {
      setBusy(null);
      void refresh();
    }
  }

  return (
    <div className="settings-form connector-list">
      <div className="muted-note">
        Connectors require your own OAuth client ID / secret so tokens never pass through
        a third party. Register a client in the relevant provider console (Google / GitHub / Slack).
      </div>
      {rows.map(({ descriptor, config, status }) => (
        <div key={descriptor.id} className="connector-row">
          <div className="connector-head">
            <div>
              <div className="connector-name"><span>{descriptor.emoji}</span> {descriptor.name}</div>
              <div className="connector-desc">{descriptor.description}</div>
              <div className={`connector-status ${status.connected ? 'connected' : 'disconnected'}`}>
                {status.connected ? `Connected as ${status.account || '(unknown)'}` : 'Not connected'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {status.connected ? (
                <button
                  type="button"
                  className="secondary"
                  onClick={async () => { await api.connectorsDisconnect(descriptor.id); void refresh(); }}
                >
                  Disconnect
                </button>
              ) : (
                <button
                  type="button"
                  className="primary"
                  disabled={!config.clientId || busy === descriptor.id}
                  onClick={() => void connect(descriptor.id)}
                >
                  {busy === descriptor.id ? 'Opening…' : 'Connect'}
                </button>
              )}
            </div>
          </div>
          <div className="connector-fields">
            <label className="field">
              <span>OAuth client ID</span>
              <input
                type="text"
                value={config.clientId ?? ''}
                onChange={(e) => void updateConfig(descriptor.id, { clientId: e.target.value })}
                placeholder="from provider dev console"
              />
            </label>
            <label className="field">
              <span>OAuth client secret (optional for some providers)</span>
              <input
                type="password"
                value={config.clientSecret ?? ''}
                onChange={(e) => void updateConfig(descriptor.id, { clientSecret: e.target.value })}
              />
            </label>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Scheduler ──────────────────────────────────────────────────

function ScheduleTab() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [draft, setDraft] = useState<Partial<ScheduledTask>>({
    name: 'Morning briefing',
    enabled: true,
    trigger: { kind: 'cron', expression: '0 8 * * *' },
    action: { kind: 'prompt', text: 'Summarize anything I should know about today.' },
    model: '',
  });

  async function refresh(): Promise<void> {
    setTasks(await api.schedulerList());
  }
  useEffect(() => { void refresh(); }, []);

  async function save(): Promise<void> {
    if (!draft.name?.trim()) return;
    await api.schedulerSave(draft);
    void refresh();
  }

  async function del(id: string): Promise<void> {
    if (!confirm('Delete this scheduled task?')) return;
    await api.schedulerDelete(id);
    void refresh();
  }

  return (
    <div className="settings-form">
      <div className="muted-note">
        Schedule recurring agent runs, research, or prompts. Cron uses the standard 5-field format
        (minute hour dom month dow). Results land in a <code>Scheduled: &lt;name&gt;</code> thread.
      </div>

      <div className="schedule-list">
        {tasks.length === 0 && (
          <div className="muted-note" style={{ textAlign: 'center', padding: '16px 12px', border: '1px dashed var(--border)', borderRadius: 6 }}>
            No scheduled tasks yet. Example: <em>cron <code>0 8 * * 1-5</code> · prompt "Summarise today's
            news"</em> gives you a weekday morning brief in the Scheduled thread.
          </div>
        )}
        {tasks.map((t) => (
          <div key={t.id} className="schedule-row">
            <div className="schedule-head">
              <div>
                <strong>{t.name}</strong>{' '}
                <span className="schedule-meta">
                  {t.trigger.kind === 'cron'
                    ? `cron "${t.trigger.expression}"`
                    : t.trigger.kind === 'interval'
                      ? `every ${t.trigger.everyMinutes}m`
                      : `once at ${new Date(t.trigger.at).toLocaleString()}`}
                  {' · '}
                  {t.action.kind}
                  {t.lastRunAt ? ` · last ${new Date(t.lastRunAt).toLocaleString()} (${t.lastStatus})` : ''}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="secondary" onClick={() => void api.schedulerRunNow(t.id)}>
                  Run now
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => { void api.schedulerSave({ ...t, enabled: !t.enabled }); void refresh(); }}
                >
                  {t.enabled ? 'Disable' : 'Enable'}
                </button>
                <button type="button" className="danger" onClick={() => void del(t.id)}>Delete</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <hr />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label className="field">
          <span>Name</span>
          <input
            type="text"
            value={draft.name ?? ''}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Trigger kind</span>
          <select
            value={draft.trigger?.kind ?? 'interval'}
            onChange={(e) => {
              const kind = e.target.value as ScheduleTrigger['kind'];
              setDraft({
                ...draft,
                trigger:
                  kind === 'cron'
                    ? { kind, expression: '0 8 * * *' }
                    : kind === 'interval'
                      ? { kind, everyMinutes: 60 }
                      : { kind, at: Date.now() + 3600_000 },
              });
            }}
          >
            <option value="cron">Cron expression</option>
            <option value="interval">Every N minutes</option>
            <option value="once">Once at time</option>
          </select>
        </label>
        {draft.trigger?.kind === 'cron' && (
          <label className="field">
            <span>Cron</span>
            <input
              type="text"
              value={draft.trigger.expression}
              onChange={(e) => setDraft({ ...draft, trigger: { kind: 'cron', expression: e.target.value } })}
            />
          </label>
        )}
        {draft.trigger?.kind === 'interval' && (
          <label className="field">
            <span>Every (minutes)</span>
            <input
              type="number"
              min={1}
              value={draft.trigger.everyMinutes}
              onChange={(e) => setDraft({ ...draft, trigger: { kind: 'interval', everyMinutes: Number(e.target.value) || 60 } })}
            />
          </label>
        )}
        <label className="field">
          <span>Action kind</span>
          <select
            value={draft.action?.kind ?? 'prompt'}
            onChange={(e) => {
              const kind = e.target.value as ScheduleAction['kind'];
              setDraft({
                ...draft,
                action:
                  kind === 'agent'
                    ? { kind, goal: '', autonomy: 'assisted' }
                    : kind === 'research'
                      ? { kind, question: '' }
                      : { kind, text: '' },
              });
            }}
          >
            <option value="prompt">Prompt</option>
            <option value="agent">Agent run</option>
            <option value="research">Deep research</option>
          </select>
        </label>
        {draft.action?.kind === 'prompt' && (
          <label className="field">
            <span>Prompt</span>
            <textarea
              rows={3}
              value={draft.action.text}
              onChange={(e) => setDraft({ ...draft, action: { kind: 'prompt', text: e.target.value } })}
            />
          </label>
        )}
        {draft.action?.kind === 'agent' && (
          <label className="field">
            <span>Agent goal</span>
            <textarea
              rows={3}
              value={draft.action.goal}
              onChange={(e) => setDraft({ ...draft, action: { kind: 'agent', goal: e.target.value, autonomy: 'assisted' } })}
            />
          </label>
        )}
        {draft.action?.kind === 'research' && (
          <label className="field">
            <span>Research question</span>
            <textarea
              rows={3}
              value={draft.action.question}
              onChange={(e) => setDraft({ ...draft, action: { kind: 'research', question: e.target.value } })}
            />
          </label>
        )}
        <label className="field">
          <span>Model (e.g. ollama:llama3.2)</span>
          <input
            type="text"
            value={draft.model ?? ''}
            onChange={(e) => setDraft({ ...draft, model: e.target.value })}
          />
        </label>
        <button type="button" className="primary" onClick={() => void save()}>
          {draft.id ? 'Update task' : 'Add task'}
        </button>
      </div>
    </div>
  );
}

// ─── Ambient ────────────────────────────────────────────────────

function AmbientTab({ settings, onSave }: { settings: Settings; onSave: (p: Partial<Settings>) => Promise<void> }) {
  const a = settings.ambient;
  const [rules, setRules] = useState<import('../../shared/types').AutopilotRule[]>([]);
  const [fires, setFires] = useState<import('../../shared/types').AutopilotFire[]>([]);
  const [draft, setDraft] = useState<Partial<import('../../shared/types').AutopilotRule> & { name: string }>({
    name: 'Auto-debug errors I copy',
    enabled: true,
    match: { triggerKind: 'error-on-screen' },
    action: { kind: 'agent', prompt: 'Debug this error: {{detail}}' },
    guardrails: { dailyCap: 10, cooldownSeconds: 120, allowedHourStart: null, allowedHourEnd: null },
  });

  async function patch(p: Partial<Settings['ambient']>): Promise<void> {
    await onSave({ ambient: { ...a, ...p } });
  }

  async function refresh(): Promise<void> {
    setRules(await api.autopilotList());
    setFires(await api.autopilotFires());
  }
  useEffect(() => { void refresh(); }, []);

  async function saveRule(): Promise<void> {
    if (!draft.name.trim()) return;
    await api.autopilotSave(draft);
    void refresh();
  }
  async function del(id: string): Promise<void> {
    if (!confirm('Delete this autopilot rule?')) return;
    await api.autopilotDelete(id);
    void refresh();
  }
  async function toggle(rule: import('../../shared/types').AutopilotRule): Promise<void> {
    await api.autopilotSave({ ...rule, enabled: !rule.enabled });
    void refresh();
  }
  return (
    <div className="settings-form">
      <div className="muted-note">
        Ambient mode lets PAiA proactively offer help based on your clipboard, active window, and
        (optionally) screen content. All processing stays on your machine; suggestions only leave
        your laptop if you accept them.
      </div>
      <label className="field row"><span>Enable ambient watcher</span>
        <input type="checkbox" checked={a.enabled} onChange={(e) => void patch({ enabled: e.target.checked })} />
      </label>
      <label className="field row"><span>Watch clipboard</span>
        <input type="checkbox" checked={a.watchClipboard} onChange={(e) => void patch({ watchClipboard: e.target.checked })} />
      </label>
      <label className="field row"><span>Watch active window</span>
        <input type="checkbox" checked={a.watchActiveWindow} onChange={(e) => void patch({ watchActiveWindow: e.target.checked })} />
      </label>
      <label className="field row"><span>Watch screen (OCR — CPU-heavy)</span>
        <input type="checkbox" checked={a.watchScreen} onChange={(e) => void patch({ watchScreen: e.target.checked })} />
      </label>
      <label className="field">
        <span>Poll interval (seconds)</span>
        <input type="number" min={2} max={60} value={a.pollSeconds} onChange={(e) => void patch({ pollSeconds: Math.max(2, Math.min(60, Number(e.target.value) || 8)) })} />
      </label>
      <label className="field">
        <span>Cooldown between same-kind suggestions (seconds)</span>
        <input type="number" min={10} value={a.cooldownSeconds} onChange={(e) => void patch({ cooldownSeconds: Math.max(10, Number(e.target.value) || 120) })} />
      </label>
      <label className="field row"><span>Enable native OS notifications</span>
        <input type="checkbox" checked={settings.notificationsEnabled} onChange={(e) => void onSave({ notificationsEnabled: e.target.checked })} />
      </label>
      <label className="field row"><span>Continuous voice mode (always-listening)</span>
        <input type="checkbox" checked={settings.voiceContinuous} onChange={(e) => void onSave({ voiceContinuous: e.target.checked })} />
      </label>

      <hr />
      <div className="muted-note">
        <strong>Autopilot rules.</strong> Pre-approve specific ambient triggers so PAiA acts
        automatically instead of asking. Each fire is audit-logged, rate-limited, and emits a
        notification so you always know something ran in your name.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rules.length === 0 && <div className="muted-note">No autopilot rules yet.</div>}
        {rules.map((r) => {
          const fireCount = fires.filter((f) => f.ruleId === r.id).length;
          return (
            <div key={r.id} className="schedule-row">
              <div className="schedule-head">
                <div>
                  <strong style={{ color: r.enabled ? 'inherit' : 'var(--muted)' }}>{r.name}</strong>{' '}
                  <span className="schedule-meta">
                    {r.match.triggerKind} → {r.action.kind} · cap {r.guardrails.dailyCap || '∞'}/day ·
                    cooldown {r.guardrails.cooldownSeconds}s
                    {r.guardrails.allowedHourStart !== null && r.guardrails.allowedHourEnd !== null && (
                      <> · {r.guardrails.allowedHourStart}h–{r.guardrails.allowedHourEnd}h</>
                    )}
                    {' · '}
                    {fireCount} fire{fireCount === 1 ? '' : 's'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="secondary" onClick={() => void toggle(r)}>
                    {r.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button type="button" className="danger" onClick={() => void del(r.id)}>Delete</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
        <label className="field"><span>Rule name</span>
          <input type="text" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <label className="field"><span>Trigger kind</span>
          <select
            value={draft.match?.triggerKind ?? 'error-on-screen'}
            onChange={(e) => setDraft({ ...draft, match: { ...(draft.match ?? { triggerKind: 'error-on-screen' }), triggerKind: e.target.value as import('../../shared/types').AmbientTriggerKind } })}
          >
            <option value="error-on-screen">Error copied to clipboard</option>
            <option value="question-in-clipboard">Question copied to clipboard</option>
            <option value="url-in-clipboard">URL copied to clipboard</option>
            <option value="long-idle-on-file">Long idle on editor file</option>
            <option value="custom">Custom (plugin-contributed)</option>
          </select>
        </label>
        <label className="field"><span>Detail regex (optional)</span>
          <input
            type="text"
            value={draft.match?.detailPattern ?? ''}
            onChange={(e) => setDraft({ ...draft, match: { ...(draft.match ?? { triggerKind: 'error-on-screen' }), detailPattern: e.target.value } })}
            placeholder="TypeError|ReferenceError"
          />
        </label>
        <label className="field"><span>Action</span>
          <select
            value={draft.action?.kind ?? 'chat'}
            onChange={(e) => setDraft({ ...draft, action: { kind: e.target.value as import('../../shared/types').AutopilotActionKind, prompt: draft.action?.prompt ?? '{{detail}}' } })}
          >
            <option value="chat">Ask the model (chat)</option>
            <option value="agent">Start an agent run</option>
            <option value="research">Start a deep research run</option>
            <option value="canvas">Save as a canvas artifact</option>
          </select>
        </label>
        <label className="field"><span>Prompt template (use {'{{detail}}'}, {'{{title}}'})</span>
          <textarea
            rows={3}
            value={draft.action?.prompt ?? ''}
            onChange={(e) => setDraft({ ...draft, action: { kind: draft.action?.kind ?? 'chat', prompt: e.target.value } })}
          />
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <label className="field" style={{ flex: 1 }}><span>Daily cap (0 = unlimited)</span>
            <input
              type="number"
              min={0}
              value={draft.guardrails?.dailyCap ?? 10}
              onChange={(e) => setDraft({ ...draft, guardrails: { ...(draft.guardrails ?? { dailyCap: 10, cooldownSeconds: 120, allowedHourStart: null, allowedHourEnd: null }), dailyCap: Math.max(0, Number(e.target.value) || 0) } })}
            />
          </label>
          <label className="field" style={{ flex: 1 }}><span>Cooldown seconds</span>
            <input
              type="number"
              min={0}
              value={draft.guardrails?.cooldownSeconds ?? 120}
              onChange={(e) => setDraft({ ...draft, guardrails: { ...(draft.guardrails ?? { dailyCap: 10, cooldownSeconds: 120, allowedHourStart: null, allowedHourEnd: null }), cooldownSeconds: Math.max(0, Number(e.target.value) || 0) } })}
            />
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <label className="field" style={{ flex: 1 }}><span>Allowed from hour (leave empty for 24/7)</span>
            <input
              type="number"
              min={0}
              max={23}
              value={draft.guardrails?.allowedHourStart ?? ''}
              onChange={(e) => setDraft({ ...draft, guardrails: { ...(draft.guardrails ?? { dailyCap: 10, cooldownSeconds: 120, allowedHourStart: null, allowedHourEnd: null }), allowedHourStart: e.target.value === '' ? null : Math.max(0, Math.min(23, Number(e.target.value))) } })}
            />
          </label>
          <label className="field" style={{ flex: 1 }}><span>Allowed to hour</span>
            <input
              type="number"
              min={0}
              max={23}
              value={draft.guardrails?.allowedHourEnd ?? ''}
              onChange={(e) => setDraft({ ...draft, guardrails: { ...(draft.guardrails ?? { dailyCap: 10, cooldownSeconds: 120, allowedHourStart: null, allowedHourEnd: null }), allowedHourEnd: e.target.value === '' ? null : Math.max(0, Math.min(23, Number(e.target.value))) } })}
            />
          </label>
        </div>
        <button type="button" className="primary" onClick={() => void saveRule()}>
          {draft.id ? 'Update rule' : 'Add autopilot rule'}
        </button>
      </div>

      {fires.length > 0 && (
        <>
          <hr />
          <div className="muted-note"><strong>Recent autopilot fires</strong></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11 }}>
            {fires.slice(0, 10).map((f) => (
              <div key={f.id} className="feed-row">
                <span className="feed-time">{new Date(f.firedAt).toLocaleTimeString()}</span>
                <span className="feed-name">{f.ruleName}</span>
                <span className="feed-kind">{f.ok ? 'ok' : 'error'}</span>
                <span className="feed-detail">{f.error ?? 'fired'}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Plugins ────────────────────────────────────────────────────

function PluginsTab({ settings, onSave }: { settings: Settings; onSave: (p: Partial<Settings>) => Promise<void> }) {
  const [list, setList] = useState<import('../../shared/types').PluginState[]>([]);
  const [pluginsDir, setPluginsDir] = useState('');

  async function refresh(): Promise<void> {
    setList(await api.pluginsList());
    setPluginsDir(await api.pluginsDir());
  }
  useEffect(() => { void refresh(); }, []);

  return (
    <div className="settings-form">
      <div className="muted-note">
        Drop a plugin folder containing a <code>paia-plugin.json</code> manifest and an <code>index.js</code>
        entry into <code>{pluginsDir}</code>. Plugins run in the main process and can register new Agent
        tools, ambient triggers, and slash commands. <strong>Only enable plugins you trust.</strong>
      </div>
      <label className="field row"><span>Enable plugin loader</span>
        <input type="checkbox" checked={settings.pluginsEnabled} onChange={(e) => void onSave({ pluginsEnabled: e.target.checked })} />
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="secondary" onClick={() => void (async () => { await api.pluginsRescan(); void refresh(); })()}>Rescan</button>
        <button type="button" className="secondary" onClick={() => void api.openUserPath('plugins')}>Open folder</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
        {list.length === 0 && <div className="muted-note">No plugins found.</div>}
        {list.map((p) => (
          <div key={p.manifest.id} className="connector-row">
            <div className="connector-head">
              <div>
                <div className="connector-name">{p.manifest.name} <span style={{ fontWeight: 400, color: 'var(--muted)' }}>v{p.manifest.version}</span></div>
                <div className="connector-desc">{p.manifest.description}</div>
                <div className="connector-desc" style={{ marginTop: 4 }}>
                  Contributes: {Object.entries(p.manifest.contributes ?? {}).map(([k, v]) => `${k}: ${(v as string[]).length}`).join(', ') || 'none declared'}
                </div>
                {p.error && <div style={{ color: '#c0392b', fontSize: 11 }}>{p.error}</div>}
              </div>
              <button
                type="button"
                className={p.enabled ? 'secondary' : 'primary'}
                onClick={async () => { await api.pluginsSetEnabled(p.manifest.id, !p.enabled); void refresh(); }}
              >
                {p.enabled ? 'Disable' : 'Enable'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Enforcement ────────────────────────────────────────────────

function EnforcementTab() {
  const [state, setState] = useState<import('../../shared/types').EnforcementState | null>(null);
  const [hosts, setHosts] = useState('youtube.com\nnetflix.com\ntiktok.com\nreddit.com');
  const [disableTaskMgr, setDisableTaskMgr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function refresh(): Promise<void> {
    setState(await api.enforcementState());
  }
  useEffect(() => { void refresh(); }, []);

  async function apply(): Promise<void> {
    setBusy(true); setErr('');
    const list = hosts.split('\n').map((s) => s.trim()).filter(Boolean);
    const res = await api.enforcementApply({ blockedHostnames: list, disableTaskMgr });
    setBusy(false);
    if ('error' in res) setErr(res.error);
    else void refresh();
  }

  async function release(): Promise<void> {
    setBusy(true); setErr('');
    await api.enforcementRelease();
    setBusy(false);
    void refresh();
  }

  if (!state) return <div className="settings-form">Loading…</div>;

  return (
    <div className="settings-form">
      <div className="muted-note">
        <strong>OS-level enforcement</strong> actually <em>blocks</em> the listed hostnames (vs just
        reporting). It writes platform-specific firewall / hosts-file entries when you apply the
        lock and reverses them when you release. This requires admin / sudo — the OS will prompt.
        If PAiA crashes while a lock is active, it self-heals on next start (after 12h).
      </div>
      <div className="muted-note">
        Platform detected: <strong>{state.platform}</strong> · status: {state.active ? <span style={{ color: '#e67e22' }}>LOCK ACTIVE since {state.activatedAt && new Date(state.activatedAt).toLocaleString()}</span> : 'idle'}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {state.capabilities.map((c, i) => (
          <div key={i} style={{ fontSize: 12 }}>
            {c.supported ? '✓' : '✗'} <strong>{c.label}</strong>
            {c.requiresAdmin && <span style={{ color: 'var(--muted)' }}> (needs admin)</span>}
            <div style={{ color: 'var(--muted)', fontSize: 11 }}>{c.description}</div>
          </div>
        ))}
      </div>
      <label className="field">
        <span>Blocked hostnames (one per line)</span>
        <textarea rows={5} value={hosts} onChange={(e) => setHosts(e.target.value)} disabled={state.active} />
      </label>
      {state.platform === 'win32' && (
        <label className="field row">
          <span>Also disable Task Manager (Windows only)</span>
          <input type="checkbox" checked={disableTaskMgr} onChange={(e) => setDisableTaskMgr(e.target.checked)} disabled={state.active} />
        </label>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        {state.active ? (
          <button type="button" className="danger" disabled={busy} onClick={() => void release()}>
            {busy ? 'Releasing…' : 'Release lock'}
          </button>
        ) : (
          <button type="button" className="primary" disabled={busy} onClick={() => void apply()}>
            {busy ? 'Applying…' : 'Apply lock'}
          </button>
        )}
      </div>
      {err && <div className="muted-note" style={{ color: '#c0392b' }}>{err}</div>}
      {state.lastLog && <pre className="step-result">{state.lastLog}</pre>}
    </div>
  );
}

// ─── Media ──────────────────────────────────────────────────────

function MediaTab() {
  const [configs, setConfigs] = useState<import('../../shared/types').MediaProviderConfig[]>([]);
  const [states, setStates] = useState<import('../../shared/types').MediaProviderState[]>([]);
  const [testPrompt, setTestPrompt] = useState('a calico cat reading a newspaper, photoreal');
  const [testProvider, setTestProvider] = useState<import('../../shared/types').MediaProviderId>('openai');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<import('../../shared/types').MediaGenerateResult | null>(null);
  const [err, setErr] = useState('');

  async function refresh(): Promise<void> {
    setConfigs(await api.mediaLoadConfigs());
    setStates(await api.mediaListProviders());
  }
  useEffect(() => { void refresh(); }, []);

  async function patch(id: import('../../shared/types').MediaProviderId, p: Partial<import('../../shared/types').MediaProviderConfig>): Promise<void> {
    const next = configs.map((c) => (c.id === id ? { ...c, ...p } : c));
    await api.mediaSaveConfigs(next);
    void refresh();
  }

  async function runTest(): Promise<void> {
    setBusy(true); setErr(''); setResult(null);
    try {
      const r = await api.mediaGenerate({ provider: testProvider, kind: 'image', prompt: testPrompt });
      if (!r.ok) setErr(r.error ?? 'failed');
      else setResult(r.result ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-form">
      <div className="muted-note">
        Image + video providers. OpenAI / Stability / Replicate / fal.ai need API keys; ComfyUI and
        Automatic1111 are local self-hosted. Once configured, the Agent gains <code>image.generate</code>
        and <code>video.generate</code> tools automatically.
      </div>
      {configs.map((c) => {
        const s = states.find((x) => x.id === c.id);
        return (
          <div key={c.id} className="provider-row">
            <div className="provider-head">
              <strong>{s?.name ?? c.id}</strong>
              <label className="provider-toggle">
                <input type="checkbox" checked={c.enabled} onChange={(e) => void patch(c.id, { enabled: e.target.checked })} />
                {c.enabled ? 'enabled' : 'disabled'}
              </label>
            </div>
            <div className="muted-note" style={{ fontSize: 11 }}>Supports: {s?.supports.join(', ') ?? '?'} · {s?.status ?? ''}</div>
            {(c.id === 'openai' || c.id === 'stability' || c.id === 'replicate' || c.id === 'fal') && (
              <label className="field"><span>API key</span>
                <input type="password" value={c.apiKey ?? ''} onChange={(e) => void patch(c.id, { apiKey: e.target.value })} />
              </label>
            )}
            {(c.id === 'comfyui' || c.id === 'automatic1111') && (
              <label className="field"><span>Base URL</span>
                <input type="text" value={c.baseUrl ?? ''} onChange={(e) => void patch(c.id, { baseUrl: e.target.value })} />
              </label>
            )}
            <label className="field"><span>Default model (optional)</span>
              <input type="text" value={c.defaultModel ?? ''} onChange={(e) => void patch(c.id, { defaultModel: e.target.value })} />
            </label>
          </div>
        );
      })}
      <hr />
      <label className="field"><span>Test prompt</span>
        <input type="text" value={testPrompt} onChange={(e) => setTestPrompt(e.target.value)} />
      </label>
      <label className="field"><span>Test provider</span>
        <select value={testProvider} onChange={(e) => setTestProvider(e.target.value as import('../../shared/types').MediaProviderId)}>
          {configs.map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}
        </select>
      </label>
      <button type="button" className="primary" disabled={busy} onClick={() => void runTest()}>{busy ? 'Generating…' : 'Test generate'}</button>
      {err && <div className="muted-note" style={{ color: '#c0392b' }}>{err}</div>}
      {result && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          {result.items.map((it, i) => (
            <img key={i} src={it.dataUrl ?? it.url} alt="generated" style={{ maxWidth: 200, borderRadius: 8, border: '1px solid var(--border)' }} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sync ───────────────────────────────────────────────────────

function SyncTab() {
  const [state, setState] = useState<import('../../shared/types').SyncSettings | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<import('../../shared/types').SyncSummary | null>(null);
  const [err, setErr] = useState('');

  async function refresh(): Promise<void> {
    setState(await api.syncSettings());
    setUnlocked(await api.syncIsUnlocked());
  }
  useEffect(() => { void refresh(); }, []);

  async function save(patch: Partial<import('../../shared/types').SyncSettings>): Promise<void> {
    if (!state) return;
    const next = { ...state, ...patch };
    await api.syncSaveSettings(next);
    void refresh();
  }

  async function unlock(): Promise<void> {
    if (!state?.backend || !passphrase) return;
    setBusy(true); setErr('');
    const r = await api.syncUnlock(passphrase, state.backend.kdfSaltBase64);
    setBusy(false);
    if (!r.ok) setErr(r.error ?? 'failed');
    else { setPassphrase(''); setUnlocked(true); }
  }

  async function run(direction: import('../../shared/types').SyncDirection): Promise<void> {
    setBusy(true); setErr(''); setSummary(null);
    const s = await api.syncRun(direction);
    setBusy(false);
    if (!s.ok) setErr(s.error ?? 'failed');
    else setSummary(s);
    void refresh();
  }

  if (!state) return <div className="settings-form">Loading…</div>;

  return (
    <div className="settings-form">
      <div className="muted-note">
        <strong>End-to-end encrypted sync.</strong> Everything is encrypted with a key derived from
        your passphrase before it leaves this device. Storage operators (WebDAV host, Syncthing
        peers, etc.) can see how many objects you have but not what's inside. Passphrase lives only
        in memory — re-enter it after restart.
      </div>
      <label className="field row"><span>Enable sync</span>
        <input type="checkbox" checked={state.enabled} onChange={(e) => void save({ enabled: e.target.checked })} />
      </label>
      <label className="field"><span>Backend kind</span>
        <select
          value={state.backend?.kind ?? 'folder'}
          onChange={(e) => void save({
            backend: {
              kind: e.target.value as 'folder' | 'webdav' | 's3',
              endpoint: state.backend?.endpoint ?? '',
              kdfSaltBase64: state.backend?.kdfSaltBase64 ?? '',
              username: state.backend?.username,
              password: state.backend?.password,
              region: state.backend?.region,
              bucket: state.backend?.bucket,
              prefix: state.backend?.prefix,
              accessKeyId: state.backend?.accessKeyId,
              secretAccessKey: state.backend?.secretAccessKey,
            },
          })}
        >
          <option value="folder">Local folder (Syncthing / Dropbox / iCloud)</option>
          <option value="webdav">WebDAV (Nextcloud, ownCloud, etc.)</option>
          <option value="s3">S3-compatible (AWS, R2, B2, MinIO, Wasabi)</option>
        </select>
      </label>
      <label className="field"><span>Endpoint</span>
        <input
          type="text"
          value={state.backend?.endpoint ?? ''}
          onChange={(e) => state.backend && void save({ backend: { ...state.backend, endpoint: e.target.value } })}
          placeholder={state.backend?.kind === 'webdav' ? 'https://nc.example.com/remote.php/dav/files/me/paia' : '/Users/me/Dropbox/paia-sync'}
        />
      </label>
      {state.backend?.kind === 'webdav' && (
        <>
          <label className="field"><span>WebDAV username</span>
            <input type="text" value={state.backend.username ?? ''} onChange={(e) => state.backend && void save({ backend: { ...state.backend, username: e.target.value } })} />
          </label>
          <label className="field"><span>WebDAV password</span>
            <input type="password" value={state.backend.password ?? ''} onChange={(e) => state.backend && void save({ backend: { ...state.backend, password: e.target.value } })} />
          </label>
        </>
      )}
      {state.backend?.kind === 's3' && (
        <>
          <label className="field"><span>S3 region (e.g. us-east-1, auto for R2)</span>
            <input type="text" value={state.backend.region ?? ''} onChange={(e) => state.backend && void save({ backend: { ...state.backend, region: e.target.value } })} />
          </label>
          <label className="field"><span>Bucket</span>
            <input type="text" value={state.backend.bucket ?? ''} onChange={(e) => state.backend && void save({ backend: { ...state.backend, bucket: e.target.value } })} />
          </label>
          <label className="field"><span>Prefix (optional folder inside the bucket)</span>
            <input type="text" value={state.backend.prefix ?? ''} onChange={(e) => state.backend && void save({ backend: { ...state.backend, prefix: e.target.value } })} placeholder="paia" />
          </label>
          <label className="field"><span>Access key id</span>
            <input type="text" value={state.backend.accessKeyId ?? ''} onChange={(e) => state.backend && void save({ backend: { ...state.backend, accessKeyId: e.target.value } })} />
          </label>
          <label className="field"><span>Secret access key</span>
            <input type="password" value={state.backend.secretAccessKey ?? ''} onChange={(e) => state.backend && void save({ backend: { ...state.backend, secretAccessKey: e.target.value } })} />
          </label>
        </>
      )}
      <div>
        <strong>What to sync</strong>
        {(['threads', 'messages', 'memory', 'artifacts', 'attachments', 'settings'] as const).map((k) => (
          <label key={k} className="field row"><span>{k}</span>
            <input type="checkbox" checked={state.include[k]} onChange={(e) => void save({ include: { ...state.include, [k]: e.target.checked } })} />
          </label>
        ))}
        {state.include.attachments && (
          <>
            <label className="field"><span>Attachment chunk size (KB)</span>
              <input
                type="number"
                min={64}
                max={8192}
                value={Math.round((state.attachmentChunkBytes ?? 1_048_576) / 1024)}
                onChange={(e) => void save({ attachmentChunkBytes: Math.max(64 * 1024, Math.min(8 * 1024 * 1024, (Number(e.target.value) || 1024) * 1024)) })}
              />
            </label>
            <label className="field"><span>Max attachment size (MB, 0 = unlimited)</span>
              <input
                type="number"
                min={0}
                value={Math.round((state.attachmentMaxBytes ?? 0) / 1_048_576)}
                onChange={(e) => void save({ attachmentMaxBytes: Math.max(0, Number(e.target.value) || 0) * 1_048_576 })}
              />
            </label>
          </>
        )}
      </div>
      <hr />
      {!unlocked ? (
        <>
          <div className="muted-note">Enter your sync passphrase to unlock encryption.</div>
          <label className="field"><span>Passphrase</span>
            <input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
          </label>
          <button type="button" className="primary" disabled={busy || !state.backend} onClick={() => void unlock()}>Unlock</button>
        </>
      ) : (
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="primary" disabled={busy} onClick={() => void run('both')}>{busy ? 'Syncing…' : 'Sync now'}</button>
          <button type="button" className="secondary" disabled={busy} onClick={() => void run('push')}>Push only</button>
          <button type="button" className="secondary" disabled={busy} onClick={() => void run('pull')}>Pull only</button>
          <button type="button" className="secondary" onClick={async () => { await api.syncLock(); void refresh(); }}>Lock</button>
        </div>
      )}
      {state.lastSyncAt && (
        <div className="muted-note" style={{ fontSize: 11 }}>
          Last sync: {new Date(state.lastSyncAt).toLocaleString()} · {state.lastStatus ?? ''}
          {state.lastError && <> · {state.lastError}</>}
        </div>
      )}
      {summary && (
        <div className="muted-note" style={{ fontSize: 12 }}>
          ↑ {summary.uploaded} · ↓ {summary.downloaded} · skipped {summary.skipped} · {summary.durationMs}ms
        </div>
      )}
      {err && <div className="muted-note" style={{ color: '#c0392b' }}>{err}</div>}
    </div>
  );
}

// ─── Companion ──────────────────────────────────────────────────

function CompanionTab() {
  const [state, setState] = useState<import('../../shared/types').CompanionState | null>(null);
  const [port, setPort] = useState(8743);

  async function refresh(): Promise<void> { setState(await api.companionState()); }
  useEffect(() => { void refresh(); }, []);

  async function start(): Promise<void> {
    await api.companionStart(port);
    void refresh();
  }
  async function stop(): Promise<void> {
    await api.companionStop();
    void refresh();
  }

  if (!state) return <div className="settings-form">Loading…</div>;

  return (
    <div className="settings-form">
      <div className="muted-note">
        Run a tiny web endpoint on your LAN so your phone can use PAiA without a separate app.
        Open the pairing URL on your phone — the PWA handles the rest. Pairing tokens rotate on
        every start.
      </div>
      <label className="field"><span>Port</span>
        <input type="number" value={port} onChange={(e) => setPort(Number(e.target.value) || 8743)} disabled={state.running} />
      </label>
      {!state.running ? (
        <button type="button" className="primary" onClick={() => void start()}>Start companion</button>
      ) : (
        <>
          <div className="license-status pro">
            <div className="license-tier">RUNNING</div>
            <div className="license-source">
              Open on phone (same WiFi): <code>{state.pairUrl}</code>
            </div>
          </div>
          <div className="muted-note" style={{ fontSize: 11 }}>
            Raw token (paste manually if QR isn't handy): <code>{state.pairToken}</code>
          </div>
          <button type="button" className="danger" onClick={() => void stop()}>Stop companion</button>
        </>
      )}
    </div>
  );
}

// ─── Remote browser ─────────────────────────────────────────────

function RemoteBrowserTab() {
  const [cfg, setCfg] = useState<import('../../shared/types').RemoteBrowserConfig | null>(null);
  const [state, setState] = useState<import('../../shared/types').RemoteBrowserState | null>(null);
  const [localAvail, setLocalAvail] = useState<{ available: boolean; path: string | null }>({ available: false, path: null });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function refresh(): Promise<void> {
    setCfg(await api.remoteBrowserConfig());
    setState(await api.remoteBrowserState());
    setLocalAvail(await api.remoteBrowserHasLocalChromium());
  }
  useEffect(() => { void refresh(); }, []);

  async function save(patch: Partial<import('../../shared/types').RemoteBrowserConfig>): Promise<void> {
    if (!cfg) return;
    await api.remoteBrowserSaveConfig({ ...cfg, ...patch });
    void refresh();
  }

  async function connect(): Promise<void> {
    setBusy(true); setErr('');
    const r = await api.remoteBrowserConnect();
    setBusy(false);
    if (!r.ok) setErr(r.error ?? 'connect failed');
    void refresh();
  }

  async function startLocal(): Promise<void> {
    setBusy(true); setErr('');
    const r = await api.remoteBrowserStartLocal();
    setBusy(false);
    if (!r.ok) { setErr(r.error ?? 'failed'); return; }
    // Auto-connect after the spawn settles.
    setTimeout(() => void connect(), 500);
    void refresh();
  }

  async function stopLocal(): Promise<void> {
    setBusy(true);
    await api.remoteBrowserStopLocal();
    setBusy(false);
    void refresh();
  }

  if (!cfg || !state) return <div className="settings-form">Loading…</div>;

  return (
    <div className="settings-form">
      <div className="muted-note">
        Drive a browser running on a different machine (VM, container, remote host) via Chrome
        DevTools Protocol. Launch Chromium with <code>--remote-debugging-port=9222
        --remote-allow-origins=*</code> and point the endpoint here — or click <strong>Start local
        Chromium</strong> to spawn one on this machine with a disposable profile.
      </div>
      <label className="field row"><span>Enable remote browser tools</span>
        <input type="checkbox" checked={cfg.enabled} onChange={(e) => void save({ enabled: e.target.checked })} />
      </label>
      <label className="field"><span>CDP endpoint</span>
        <input type="text" value={cfg.endpoint} onChange={(e) => void save({ endpoint: e.target.value })} />
      </label>
      <label className="field"><span>Optional auth token (appended as ?token=…)</span>
        <input type="password" value={cfg.token ?? ''} onChange={(e) => void save({ token: e.target.value })} />
      </label>
      <div className="muted-note" style={{ fontSize: 11 }}>
        Status: {state.connected ? <span style={{ color: '#27ae60' }}>connected{state.currentUrl ? ' → ' + state.currentUrl : ''}</span> : 'disconnected'}
        {state.error && <> · last error: {state.error}</>}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {state.connected ? (
          <button type="button" className="secondary" onClick={async () => { await api.remoteBrowserDisconnect(); void refresh(); }}>Disconnect</button>
        ) : (
          <button type="button" className="primary" disabled={busy || !cfg.enabled} onClick={() => void connect()}>Connect</button>
        )}
      </div>
      <hr />
      <div className="muted-note">
        <strong>Local Chromium orchestrator.</strong>{' '}
        {localAvail.available
          ? <>Found at <code>{localAvail.path}</code>. Click Start to launch it with a disposable profile; PAiA auto-fills the endpoint and connects.</>
          : <>No Chrome / Chromium / Edge found in the usual install paths. Install one or set the endpoint manually.</>}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="primary" disabled={busy || !localAvail.available} onClick={() => void startLocal()}>Start local Chromium</button>
        <button type="button" className="secondary" onClick={() => void stopLocal()}>Stop local</button>
      </div>
      {err && <div className="muted-note" style={{ color: '#c0392b' }}>{err}</div>}
    </div>
  );
}

// ─── API server ─────────────────────────────────────────────────

function ApiServerTab() {
  const [state, setState] = useState<import('../../shared/types').ApiServerState | null>(null);
  const [port, setPort] = useState(8744);
  const [pinned, setPinned] = useState(false);

  async function refresh(): Promise<void> {
    const s = await api.apiServerState();
    setState(s);
    setPort(s.port);
  }
  useEffect(() => { void refresh(); }, []);

  async function toggle(): Promise<void> {
    if (state?.running) await api.apiServerStop();
    else await api.apiServerStart(port);
    void refresh();
  }

  async function regen(): Promise<void> {
    if (!confirm('Regenerate the API key? Existing scripts will stop working until you update them.')) return;
    await api.apiServerRegenerateKey();
    void refresh();
  }

  if (!state) return <div className="settings-form">Loading…</div>;

  const curlChat = state.apiKey
    ? `curl -N -H "Authorization: Bearer ${state.apiKey}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"threadId":"<id>","text":"Summarise this."}' \\\n  http://127.0.0.1:${state.port}/v1/chat`
    : '# start the server to generate a key';

  return (
    <div className="settings-form">
      <div className="muted-note">
        Exposes a bearer-auth REST API on <code>127.0.0.1</code> so other programs on the same
        machine (Raycast, Alfred, macOS Shortcuts, CLI tools, IDE plugins) can drive PAiA. LAN /
        internet access is deliberately not supported — for phone access, use the Companion tab.
      </div>
      <label className="field"><span>Port</span>
        <input
          type="number"
          value={port}
          onChange={(e) => setPort(Number(e.target.value) || 8744)}
          disabled={state.running}
        />
      </label>
      <label className="field row"><span>Pin the API key across restarts</span>
        <input
          type="checkbox"
          checked={pinned}
          onChange={async (e) => { setPinned(e.target.checked); await api.apiServerSetPinned(e.target.checked); void refresh(); }}
        />
      </label>
      {!state.running ? (
        <button type="button" className="primary" onClick={() => void toggle()}>Start API server</button>
      ) : (
        <>
          <div className="license-status pro">
            <div className="license-tier">RUNNING</div>
            <div className="license-source">
              Endpoint: <code>http://127.0.0.1:{state.port}</code>
            </div>
          </div>
          <div className="muted-note" style={{ fontSize: 11 }}>
            API key: <code>{state.apiKey}</code>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="secondary" onClick={() => void regen()}>Regenerate key</button>
            <button type="button" className="danger" onClick={() => void toggle()}>Stop server</button>
          </div>
          <details style={{ marginTop: 12 }}>
            <summary className="muted-note">Example: streaming chat</summary>
            <pre className="step-result">{curlChat}</pre>
          </details>
        </>
      )}
      {state.error && <div className="muted-note" style={{ color: '#c0392b' }}>Error: {state.error}</div>}
    </div>
  );
}

// ─── Beta ───────────────────────────────────────────────────────

function BetaTab() {
  const [state, setState] = useState<import('../../shared/types').BetaState | null>(null);
  const [paste, setPaste] = useState('');
  const [err, setErr] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [feedbackBody, setFeedbackBody] = useState('');
  const [feedbackSent, setFeedbackSent] = useState(false);

  async function refresh(): Promise<void> {
    setState(await api.betaState());
    const cfg = await api.feedbackConfig();
    setEndpoint(cfg.endpoint ?? '');
  }
  useEffect(() => { void refresh(); }, []);

  async function activate(): Promise<void> {
    setErr('');
    const s = await api.betaActivate(paste.trim());
    if (!s.enabled) setErr(s.reason ?? 'failed');
    setState(s);
    if (s.enabled) setPaste('');
  }

  async function revoke(): Promise<void> {
    if (!confirm('Revoke your beta invite?')) return;
    setState(await api.betaRevoke());
  }

  async function saveEndpoint(): Promise<void> {
    await api.feedbackSaveConfig({ endpoint: endpoint.trim() || undefined });
  }

  async function sendFeedback(): Promise<void> {
    if (!feedbackBody.trim()) return;
    const r = await api.feedbackSubmit({ body: feedbackBody });
    setFeedbackSent(r.sent);
    setFeedbackBody('');
    setTimeout(() => setFeedbackSent(false), 3000);
  }

  if (!state) return <div className="settings-form">Loading…</div>;

  return (
    <div className="settings-form">
      <div className="muted-note">
        Closed beta gating. Paste your signed invite blob to activate the <code>beta</code> feature
        flag. Invites are Ed25519-signed; we verify against the <code>PAIA_PUBLIC_KEY</code> baked
        into this build.
      </div>
      {state.enabled ? (
        <div className="license-status pro">
          <div className="license-tier">BETA</div>
          <div className="license-source">
            {state.invite?.name} · {state.invite?.email}
            {state.invite?.cohort && <> · cohort {state.invite.cohort}</>}
            {state.invite?.expiresAt && <> · expires {new Date(state.invite.expiresAt).toLocaleDateString()}</>}
          </div>
        </div>
      ) : (
        <>
          <label className="field"><span>Paste invite (JSON or base64)</span>
            <textarea rows={5} value={paste} onChange={(e) => setPaste(e.target.value)} />
          </label>
          <button type="button" className="primary" disabled={!paste.trim()} onClick={() => void activate()}>Activate</button>
          {state.reason && <div className="muted-note" style={{ color: '#c0392b' }}>{state.reason}</div>}
        </>
      )}
      {err && <div className="muted-note" style={{ color: '#c0392b' }}>{err}</div>}
      {state.enabled && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="danger" onClick={() => void revoke()}>Revoke invite</button>
        </div>
      )}

      <hr />
      <div className="muted-note">
        <strong>Feedback.</strong> Send thoughts straight from the app. Submissions post to the
        endpoint you configure below (a Slack webhook, a Linear API route, or your own collector).
        If no endpoint is set, messages queue locally and retry on restart.
      </div>
      <label className="field"><span>Feedback endpoint</span>
        <input type="text" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} onBlur={() => void saveEndpoint()} placeholder="https://hooks.example.com/paia-feedback" />
      </label>
      <label className="field"><span>Your feedback</span>
        <textarea rows={4} value={feedbackBody} onChange={(e) => setFeedbackBody(e.target.value)} placeholder="What's working? What's broken? What would you change?" />
      </label>
      <button type="button" className="primary" disabled={!feedbackBody.trim()} onClick={() => void sendFeedback()}>Send feedback</button>
      {feedbackSent && <div className="muted-note" style={{ color: '#27ae60' }}>Thanks — feedback sent.</div>}
    </div>
  );
}
