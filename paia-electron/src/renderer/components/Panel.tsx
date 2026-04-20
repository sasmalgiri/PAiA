// The expanded chat panel: header, sidebar, message list, composer.
// Owns the persona/model dropdowns in the header. App.tsx feeds it
// data and the action callbacks.

import { useEffect, useRef, useState } from 'react';
import type {
  DbAttachment,
  DbMessage,
  DbThread,
  KnowledgeCollection,
  Persona,
  Settings,
} from '../../shared/types';
import { api } from '../lib/api';
import { useT } from '../lib/i18n';
import { Message } from './Message';
import { Composer } from './Composer';
import { Sidebar } from './Sidebar';
import { TrialPill } from './TrialPill';
import { ActivityBar } from './ActivityBar';
import { PersonaPicker } from './PersonaPicker';
import { ShortcutHelp } from './ShortcutHelp';

interface PanelProps {
  settings: Settings;
  personas: Persona[];
  threads: DbThread[];
  currentThread: DbThread | null;
  messages: DbMessage[];
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenThread: (id: string) => void;
  onNewThread: () => void;
  onDeleteThread: (id: string) => void;
  onSend: (text: string, attachments: Omit<DbAttachment, 'id' | 'messageId'>[]) => void;
  onPersonaChange: (id: string) => void;
  onModelChange: (model: string) => void;
  onStartAgent: (goal: string) => void;
  onStartResearch: (question: string) => void;
  onOpenCanvas: () => void;
  onRegenerateLast?: () => void;
  onForkFromMessage?: (messageId: string) => void;
}

export function Panel(props: PanelProps) {
  const {
    settings, personas, threads, currentThread, messages,
    onClose, onOpenSettings, onOpenThread, onNewThread, onDeleteThread,
    onSend, onPersonaChange, onModelChange,
    onStartAgent, onStartResearch, onOpenCanvas,
    onRegenerateLast, onForkFromMessage,
  } = props;

  const { t } = useT();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [personaPickerOpen, setPersonaPickerOpen] = useState(false);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [models, setModels] = useState<{ id: string; label: string }[]>([]);
  const [ollamaOk, setOllamaOk] = useState<boolean | null>(null);
  const [collections, setCollections] = useState<KnowledgeCollection[]>([]);
  const [attachedCollections, setAttachedCollections] = useState<string[]>([]);
  const [showCollMenu, setShowCollMenu] = useState(false);
  // Transient inline notice shown at the top of the panel — used by
  // slash commands and action errors instead of blocking browser alert()
  // dialogs that interrupt the user's flow.
  const [notice, setNotice] = useState<{ level: 'info' | 'warn' | 'error'; text: string } | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showNotice = (level: 'info' | 'warn' | 'error', text: string): void => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setNotice({ level, text });
    noticeTimerRef.current = setTimeout(() => setNotice(null), level === 'error' ? 6000 : 4000);
  };
  const messagesRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void api.listCollections().then(setCollections);
  }, []);

  useEffect(() => {
    if (!currentThread) {
      setAttachedCollections([]);
      return;
    }
    void api.listThreadCollections(currentThread.id).then(setAttachedCollections);
  }, [currentThread?.id]);

  async function toggleCollection(collId: string) {
    if (!currentThread) return;
    if (attachedCollections.includes(collId)) {
      await api.detachCollection(currentThread.id, collId);
    } else {
      await api.attachCollection(currentThread.id, collId);
    }
    setAttachedCollections(await api.listThreadCollections(currentThread.id));
  }

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, messages[messages.length - 1]?.content]);

  // Refresh provider status + model list periodically.
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const states = await api.listProviderStates();
      if (cancelled) return;
      const ollama = states.find((s) => s.id === 'ollama');
      setOllamaOk(ollama?.reachable ?? false);
      const list: { id: string; label: string }[] = [];
      for (const s of states) {
        for (const m of s.models) {
          list.push({
            id: `${s.id}:${m}`,
            label: `${s.isCloud ? '☁ ' : ''}${m}`,
          });
        }
      }
      setModels(list);
    };
    void refresh();
    const id = setInterval(refresh, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  function handleMetaCommand(name: string, rest: string): void {
    if (name === 'new') {
      onNewThread();
      return;
    }
    if (name === 'clear') {
      if (currentThread && confirm('Clear this conversation?')) {
        onDeleteThread(currentThread.id);
        onNewThread();
      }
      return;
    }
    if (name === 'screen') {
      void doScreenCapture(false);
      return;
    }
    if (name === 'region') {
      void doScreenCapture(true);
      return;
    }
    if (name === 'search') {
      void doWebSearch(rest);
      return;
    }
    if (name === 'image') {
      void doImageFromClipboard(rest);
      return;
    }
    if (name === 'agent') {
      const goal = rest.trim();
      if (!goal) { showNotice('warn', 'Tell the agent what to do — e.g. /agent summarise today\'s emails'); return; }
      onStartAgent(goal);
      return;
    }
    if (name === 'research') {
      const q = rest.trim();
      if (!q) { showNotice('warn', 'Ask a research question — e.g. /research why did GPT-4 fine-tuning get cheaper'); return; }
      onStartResearch(q);
      return;
    }
    if (name === 'canvas') {
      onOpenCanvas();
      return;
    }
    if (name === 'remember') {
      const text = rest.trim();
      if (!text) { showNotice('warn', 'What should I remember? e.g. /remember I use TypeScript strict mode'); return; }
      void doRemember(text);
      return;
    }
    if (name === 'recall') {
      const q = rest.trim();
      if (!q) { showNotice('warn', 'What are you looking for? e.g. /recall TypeScript preferences'); return; }
      void doRecall(q);
      return;
    }
    if (name === 'whiteboard') {
      onOpenCanvas();
      showNotice('info', 'Canvas opened. Click "+ Whiteboard" in the Canvas header.');
      return;
    }
    if (name === 'persona') {
      const id = rest.trim();
      if (id) {
        const match = personas.find((p) => p.id === id || p.name.toLowerCase() === id.toLowerCase());
        if (match) { onPersonaChange(match.id); showNotice('info', `Persona: ${match.emoji} ${match.name}`); }
        else showNotice('warn', `No persona matched "${id}". Type /persona with no argument to browse.`);
      } else {
        setPersonaPickerOpen(true);
      }
      return;
    }
    if (name === 'learned') {
      void doShowLearned();
      return;
    }
    if (name === 'export') {
      if (!currentThread) { showNotice('warn', 'Open a conversation first.'); return; }
      void doExportThread();
      return;
    }
    if (name === 'shortcuts') {
      setShortcutHelpOpen(true);
      return;
    }
  }

  async function doShowLearned(): Promise<void> {
    const reflections = await api.experienceListReflections({ threadId: currentThread?.id, limit: 8 });
    if (reflections.length === 0) {
      showNotice('info', 'Nothing learned yet in this thread — try a few exchanges and give a 👍/👎.');
      return;
    }
    const summary = reflections
      .map((r) => `• ${new Date(r.createdAt).toLocaleString()} — ${r.summary.split('\n')[0]}`)
      .join('\n');
    showNotice('info', `Recent lessons:\n${summary}`);
  }

  async function doExportThread(): Promise<void> {
    if (!currentThread) return;
    const res = await api.exportThreadMarkdown(currentThread.id);
    if (res.ok) showNotice('info', `Exported to ${res.path}`);
    else if (res.cancelled) return;
    else showNotice('error', `Export failed: ${res.error ?? 'unknown error'}`);
  }

  async function doRemember(text: string): Promise<void> {
    const result = await api.memoryAdd({ scope: 'fact', text });
    if (!result.ok) {
      showNotice('error', `Couldn't save memory: ${result.error ?? 'unknown error'}`);
      return;
    }
    onSend(`(saved to memory: ${text})`, []);
  }

  async function doRecall(q: string): Promise<void> {
    const result = await api.memoryRecall({ query: q, topK: 6 });
    if (!result.ok || !result.entries || result.entries.length === 0) {
      showNotice('info', `No memory matched "${q}". Add one with /remember first.`);
      return;
    }
    const blocks = result.entries
      .map((m, i) => `[${i + 1}] (${m.scope}) ${m.text}`)
      .join('\n');
    onSend(
      `Recall from long-term memory for: "${q}"\n\n${blocks}\n\nPlease summarize what PAiA knows that is relevant to the query.`,
      [],
    );
  }

  async function doImageFromClipboard(prompt: string): Promise<void> {
    const dataUrl = await api.readClipboardImage();
    if (!dataUrl) {
      showNotice('info', 'No image on the clipboard. Copy an image (⌘/Ctrl+C on any screenshot) and try again.');
      return;
    }
    const attachments: Omit<DbAttachment, 'id' | 'messageId'>[] = [
      {
        kind: 'image',
        filename: `clipboard-${Date.now()}.png`,
        mimeType: 'image/png',
        sizeBytes: dataUrl.length,
        content: dataUrl,
      },
    ];
    onSend(prompt.trim() || 'What is in this image?', attachments);
  }

  async function doWebSearch(query: string): Promise<void> {
    const trimmed = query.trim();
    if (!trimmed) {
      showNotice('warn', 'What should I search for? e.g. /search latest GPT-4 pricing');
      return;
    }
    showNotice('info', `Searching the web for "${trimmed}"…`);
    const result = await api.webSearch(trimmed, 8);
    if (result.error) {
      showNotice('error', `Web search failed: ${result.error}. Check your internet connection or disable VPN and retry.`);
      return;
    }
    if (result.results.length === 0) {
      showNotice('info', `No results for "${trimmed}" — try different keywords.`);
      return;
    }
    // Build a context block and send as a normal user message. The LLM
    // sees the question and the search results in one go and can cite.
    const blocks = result.results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`);
    const prompt = [
      `I searched the web for: "${trimmed}"`,
      result.redactedCount > 0 ? `(${result.redactedCount} PII item(s) were redacted from my query before sending)` : '',
      '',
      'Here are the top results:',
      '',
      ...blocks,
      '',
      `Based on these, please answer: ${trimmed}. Cite sources by their bracket number.`,
    ].filter(Boolean).join('\n');
    onSend(prompt, []);
  }

  async function doScreenCapture(region: boolean = false): Promise<void> {
    try {
      const dataUrl = region ? await api.captureRegion() : await api.capturePrimary();
      if (!dataUrl) return; // user cancelled the region selection
      const ocr = await api.ocr(dataUrl);
      const attachments: Omit<DbAttachment, 'id' | 'messageId'>[] = [
        {
          kind: 'screen',
          filename: `${region ? 'region' : 'screen'}-${Date.now()}.png`,
          mimeType: 'image/png',
          sizeBytes: dataUrl.length,
          content: dataUrl,
        },
      ];
      onSend(
        `What's on my screen? Here is the OCR text:\n\n${ocr.text || '(no text detected)'}`,
        attachments,
      );
    } catch (err) {
      showNotice('error', `Screen capture failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <section className="panel">
      <header className="panel-header drag">
        <div className="panel-title no-drag" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!sidebarOpen && (
            <button type="button" className="icon-btn" title="Show conversations" aria-label="Show conversations" onClick={() => setSidebarOpen(true)}>»</button>
          )}
          <span className={`dot ${ollamaOk === null ? '' : ollamaOk ? 'ok' : 'bad'}`} title="Ollama status" />
          <strong>PAiA</strong>
        </div>
        <div className="panel-actions no-drag">
          <button
            type="button"
            className="persona-header-btn"
            title="Switch persona"
            onClick={() => setPersonaPickerOpen(true)}
          >
            {(() => {
              const active = personas.find((p) => p.id === settings.personaId) ?? personas[0];
              return active ? (
                <>
                  <span className="persona-header-emoji">{active.emoji}</span>
                  <span className="persona-header-name">{active.name}</span>
                  <span className="persona-header-chev">▾</span>
                </>
              ) : <span className="persona-header-name">Pick persona</span>;
            })()}
          </button>
          <select
            value={settings.model}
            onChange={(e) => onModelChange(e.target.value)}
            title="Model"
            className="header-select"
          >
            {models.length === 0 ? (
              <option value="">no models</option>
            ) : (
              models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)
            )}
          </select>
          <button type="button" className="icon-btn" title={t('panel.captureFullScreen')} aria-label={t('panel.captureFullScreen')} onClick={() => void doScreenCapture(false)}>📸</button>
          <button type="button" className="icon-btn" title={t('panel.captureRegion')} aria-label={t('panel.captureRegion')} onClick={() => void doScreenCapture(true)}>✂</button>
          <button type="button" className="icon-btn" title={t('panel.canvas')} aria-label={t('panel.canvas')} onClick={onOpenCanvas}>🎨</button>
          <div className="coll-menu-wrap">
            <button
              type="button"
              className={`icon-btn ${attachedCollections.length > 0 ? 'mic active' : ''}`}
              title="Attach knowledge collection"
              onClick={() => setShowCollMenu((v) => !v)}
            >📚{attachedCollections.length > 0 ? attachedCollections.length : ''}</button>
            {showCollMenu && (
              <div className="coll-menu">
                {collections.length === 0 && (
                  <div className="coll-menu-empty">No collections yet. Create one in Settings → Knowledge.</div>
                )}
                {collections.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`coll-menu-item ${attachedCollections.includes(c.id) ? 'on' : ''}`}
                    onClick={() => void toggleCollection(c.id)}
                  >
                    <span>{attachedCollections.includes(c.id) ? '✓' : '○'}</span>
                    <span className="coll-menu-name">{c.name}</span>
                    <span className="coll-menu-meta">{c.chunkCount} chunks</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <TrialPill onOpenLicense={onOpenSettings} />
          <button type="button" className="icon-btn" title={t('panel.settings')} aria-label={t('panel.settings')} onClick={onOpenSettings}>⚙</button>
          <button type="button" className="icon-btn" title={t('panel.close')} aria-label={t('panel.close')} onClick={onClose}>×</button>
        </div>
      </header>
      <ActivityBar />

      <div className="panel-body">
        {sidebarOpen && (
          <Sidebar
            threads={threads}
            currentId={currentThread?.id ?? null}
            onOpen={onOpenThread}
            onNew={onNewThread}
            onDelete={onDeleteThread}
            onClose={() => setSidebarOpen(false)}
          />
        )}

        <div className="conversation">
          {notice && (
            <div className={`panel-notice panel-notice-${notice.level}`} role="status" aria-live="polite">
              <span>{notice.text}</span>
              <button
                type="button"
                className="icon-btn panel-notice-close"
                onClick={() => setNotice(null)}
                aria-label="Dismiss"
              >×</button>
            </div>
          )}
          <div
            className="messages"
            ref={messagesRef}
            role="log"
            aria-live="polite"
            aria-label="Conversation"
          >
            {messages.length === 0 && (
              <div className="empty-state">
                <div className="empty-emoji">👋</div>
                <div className="empty-title">{t('empty.howCanIHelp')}</div>
                <div className="empty-hint">{t('empty.hint')}</div>
                {models.length === 0 && (
                  <div
                    className="panel-notice panel-notice-warn"
                    style={{ marginTop: 14, textAlign: 'left', maxWidth: 380 }}
                  >
                    <span>
                      No model is connected yet.{' '}
                      {ollamaOk === false
                        ? 'Start Ollama, then '
                        : 'Pull a model in '}
                      <a
                        href="#"
                        onClick={(e) => { e.preventDefault(); onOpenSettings(); }}
                        style={{ color: 'var(--accent)' }}
                      >
                        Settings → Models
                      </a>.
                    </span>
                  </div>
                )}
              </div>
            )}
            {messages.map((m, i) => {
              const isLastAssistant =
                m.role === 'assistant' &&
                i === messages.length - 1;
              return (
                <Message
                  key={m.id}
                  message={m}
                  streaming={isLastAssistant && !m.content}
                  onRegenerate={isLastAssistant && m.content ? onRegenerateLast : undefined}
                  onFork={m.role === 'assistant' && m.content && onForkFromMessage ? () => onForkFromMessage(m.id) : undefined}
                />
              );
            })}
          </div>

          <Composer
            voiceLang={settings.voiceLang}
            sttEngine={settings.sttEngine}
            currentModel={currentThread?.model ?? settings.model}
            voiceContinuous={settings.voiceContinuous}
            onSend={onSend}
            onMetaCommand={handleMetaCommand}
          />
        </div>
      </div>
      {personaPickerOpen && (
        <PersonaPicker
          personas={personas}
          currentId={settings.personaId}
          onSelect={(id) => onPersonaChange(id)}
          onClose={() => setPersonaPickerOpen(false)}
        />
      )}
      {shortcutHelpOpen && <ShortcutHelp onClose={() => setShortcutHelpOpen(false)} />}
    </section>
  );
}
