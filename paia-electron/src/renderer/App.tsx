// Top-level PAiA component. Owns:
//   - the current view (ball / panel / settings / onboarding)
//   - the current settings (loaded once on mount, refreshed on save)
//   - the current thread + messages
//
// Child components receive callbacks from here so all state mutations
// flow through one place. This keeps things simple without adding a
// state library.

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AgentApprovalRequest,
  AgentRun,
  ClassroomState,
  DbAttachment,
  DbMessage,
  DbThread,
  McpToolCallApprovalRequest,
  Persona,
  ResearchRun,
  Settings,
} from '../shared/types';
import { api } from './lib/api';
import { Ball } from './components/Ball';
import { Panel } from './components/Panel';
import { SettingsView } from './components/Settings';
import { Onboarding } from './components/Onboarding';
import { McpApprovalModal } from './components/McpApprovalModal';
import { QuickActions } from './components/QuickActions';
import { AgentPanel } from './components/AgentPanel';
import { ResearchPanel } from './components/ResearchPanel';
import { Canvas } from './components/Canvas';
import { TeacherDashboard, StudentLock } from './components/Classroom';
import { CommandPalette } from './components/CommandPalette';
import { AmbientToast } from './components/AmbientToast';
import { LearnedToast } from './components/LearnedToast';
import { ShortcutHelp } from './components/ShortcutHelp';
import { friendlyError, type FriendlyError } from './lib/errors';
import { UpgradePrompt, detectUpgradeError, type UpgradeInfo } from './components/UpgradePrompt';
import { TrialExpiredModal } from './components/TrialExpiredModal';
import { InputModal } from './components/InputModal';
import { setLocale } from './lib/i18n';

type GoalKind = 'agent' | 'research' | 'team';

type ViewName = 'ball' | 'panel' | 'settings' | 'onboarding' | 'quick';

export function App() {
  const [view, setView] = useState<ViewName>('ball');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [threads, setThreads] = useState<DbThread[]>([]);
  const [currentThread, setCurrentThread] = useState<DbThread | null>(null);
  // Mirrors currentThread into a ref so async subscriptions (e.g. chat token
  // stream) can filter against the *currently displayed* thread without
  // capturing a stale thread id from when the send started.
  const currentThreadIdRef = useRef<string | null>(null);
  useEffect(() => { currentThreadIdRef.current = currentThread?.id ?? null; }, [currentThread?.id]);
  const [messages, setMessages] = useState<DbMessage[]>([]);
  const [approval, setApproval] = useState<McpToolCallApprovalRequest | null>(null);
  const [quickText, setQuickText] = useState('');
  const [agentRun, setAgentRun] = useState<AgentRun | null>(null);
  const [agentApproval, setAgentApproval] = useState<AgentApprovalRequest | null>(null);
  const [researchRun, setResearchRun] = useState<ResearchRun | null>(null);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [classroomState, setClassroomState] = useState<ClassroomState>({ role: 'off' });
  const [classroomMessages, setClassroomMessages] = useState<{ kind: 'end' | 'message'; text: string }[]>([]);
  const [teacherDashboardOpen, setTeacherDashboardOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [upgradeInfo, setUpgradeInfo] = useState<UpgradeInfo | null>(null);
  const [showTrialExpired, setShowTrialExpired] = useState(false);
  const [goalPrompt, setGoalPrompt] = useState<GoalKind | null>(null);
  // Undo-toast for thread soft-delete. Holds the id + name of the
  // just-deleted thread; a timer clears it after 7 seconds.
  const [undoState, setUndoState] = useState<{ id: string; title: string } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

  // MCP tool-call approval prompts can fire any time. Subscribe globally.
  useEffect(() => {
    const off = api.onMcpToolApproval((req) => setApproval(req));
    return off;
  }, []);

  // Agent-run approval prompts — same idea, different channel.
  useEffect(() => {
    const off = api.onAgentApproval((req) => setAgentApproval(req));
    return off;
  }, []);

  // Track the currently-open agent run so the panel stays in sync with
  // status transitions coming back from main.
  useEffect(() => {
    const off = api.onAgentRun((run) => {
      setAgentRun((prev) => (prev && prev.id === run.id ? run : prev));
    });
    return off;
  }, []);

  // Global keyboard shortcuts. Ctrl/⌘+K for the command palette,
  // Ctrl/⌘+, for Settings, bare `?` for the shortcut help (unless the
  // user is typing into an input/textarea/contentEditable).
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [chatError, setChatError] = useState<FriendlyError | null>(null);
  useEffect(() => {
    if (!chatError) return;
    const t = setTimeout(() => setChatError(null), 8000);
    return () => clearTimeout(t);
  }, [chatError]);
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (mod && e.key === ',') {
        e.preventDefault();
        void switchView('settings');
      } else if (e.key === 'Escape' && paletteOpen) {
        setPaletteOpen(false);
      } else if (e.key === '?' && !mod) {
        const t = e.target as HTMLElement | null;
        const tag = t?.tagName?.toLowerCase();
        const typing = tag === 'input' || tag === 'textarea' || t?.isContentEditable;
        if (!typing) { e.preventDefault(); setShortcutHelpOpen(true); }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen]);

  // Classroom state + message subscriptions.
  useEffect(() => {
    void api.classroomState().then(setClassroomState);
    const offState = api.onClassroomState((s) => {
      setClassroomState(s);
      if (s.role === 'teacher' && !teacherDashboardOpen) {
        setTeacherDashboardOpen(true);
        void switchView('panel');
      }
      if (s.role === 'student') {
        void switchView('panel');
      }
    });
    const offMsg = api.onClassroomMessage((m) => {
      setClassroomMessages((prev) => [...prev, m]);
      if (m.kind === 'end') {
        setTimeout(() => setClassroomMessages((prev) => prev.filter((x) => x !== m)), 5000);
      }
    });
    return () => { offState(); offMsg(); };
  }, []);

  async function decideApproval(allow: boolean): Promise<void> {
    if (!approval) return;
    await api.mcpApprove(approval.requestId, allow);
    setApproval(null);
  }

  async function decideAgentApproval(allow: boolean): Promise<void> {
    if (!agentApproval) return;
    await api.agentApprove(agentApproval.requestId, allow);
    setAgentApproval(null);
  }

  const startAgent = useCallback(async (goal: string) => {
    if (!settings) return;
    // Snapshot the thread's model BEFORE any await so a concurrent
    // thread switch can't change which model the run is dispatched on.
    let threadId = currentThread?.id;
    let threadModel = currentThread?.model ?? null;
    if (!threadId) {
      const t = await api.createThread({
        title: goal.slice(0, 60) || 'Agent run',
        personaId: settings.personaId,
        model: settings.model || null,
      });
      threadId = t.id;
      threadModel = t.model;
      setCurrentThread(t);
      setThreads(await api.listThreads());
    }
    try {
      const run = await api.agentStart({
        threadId,
        goal,
        model: (threadModel ?? settings.model) || '',
        autonomy: settings.agentAutonomy,
        stepBudget: settings.agentStepBudget,
      });
      setAgentRun(run);
    } catch (err) {
      const upg = detectUpgradeError(err);
      if (upg) setUpgradeInfo(upg);
      else alert(err instanceof Error ? err.message : String(err));
    }
  }, [settings, currentThread]);

  const startResearch = useCallback(async (question: string) => {
    if (!settings) return;
    let threadId = currentThread?.id;
    let threadModel = currentThread?.model ?? null;
    if (!threadId) {
      const t = await api.createThread({
        title: `Research: ${question.slice(0, 50)}`,
        personaId: settings.personaId,
        model: settings.model || null,
      });
      threadId = t.id;
      threadModel = t.model;
      setCurrentThread(t);
      setThreads(await api.listThreads());
    }
    try {
      const run = await api.researchStart({
        threadId,
        question,
        model: (threadModel ?? settings.model) || '',
      });
      setResearchRun(run);
    } catch (err) {
      const upg = detectUpgradeError(err);
      if (upg) setUpgradeInfo(upg);
      else alert(err instanceof Error ? err.message : String(err));
    }
  }, [settings, currentThread]);

  // ── TTS playback ─────────────────────────────────────────────
  // Routes between system speechSynthesis and Piper based on settings.
  async function speakText(text: string): Promise<void> {
    if (!settings) return;
    if (settings.ttsEngine === 'piper') {
      try {
        const result = await api.piperSynthesize(settings.piperVoice, text);
        if (result.ok && result.wav) {
          const audio = new Audio(result.wav);
          await audio.play();
        }
      } catch (err) {
        console.warn('Piper TTS failed, falling back to system voice', err);
        speakSystem(text);
      }
      return;
    }
    speakSystem(text);
  }

  function speakSystem(text: string): void {
    if (!settings) return;
    if (typeof window.speechSynthesis === 'undefined') return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = settings.voiceLang || 'en-US';
      window.speechSynthesis.speak(u);
    } catch {
      /* ignore */
    }
  }

  // ── boot ──────────────────────────────────────────────────────
  useEffect(() => {
    void (async () => {
      const s = await api.getSettings();
      setSettings(s);
      setPersonas(await api.listPersonas());
      const ts = await api.listThreads();
      setThreads(ts);

      if (!s.onboarded) {
        await switchView('onboarding');
        return;
      }

      // Restore the last open thread, or create a fresh one.
      let active: DbThread | null = null;
      if (s.currentThreadId) {
        active = await api.getThread(s.currentThreadId);
      }
      if (!active && ts.length > 0) {
        active = ts[0];
      }
      if (active) {
        setCurrentThread(active);
        setMessages(await api.listMessages(active.id));
      }
    })();
  }, []);

  // Apply theme to the document.
  useEffect(() => {
    if (!settings) return;
    const root = document.documentElement;
    if (settings.theme === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', settings.theme);
    }
  }, [settings?.theme]);

  // Keep the i18n runtime in sync with the user's locale choice.
  useEffect(() => {
    if (!settings) return;
    setLocale(settings.locale);
  }, [settings?.locale]);

  // One-shot "your trial ended" modal. Fires the first boot after the
  // 14-day window lapses and only if the user never saw it before.
  useEffect(() => {
    if (!settings) return;
    if (settings.trialExpiryAcknowledged) return;
    void (async () => {
      const status = await api.licenseStatus();
      if (status.source === 'free' && status.trialDaysLeft === 0) {
        setShowTrialExpired(true);
      }
    })();
  }, [settings?.trialExpiryAcknowledged]);

  // Listen for global hotkeys forwarded from main.
  useEffect(() => {
    const offCap = api.onTriggerCapture(() => {
      void switchView('panel');
    });
    const offPtt = api.onTriggerPushToTalk(() => {
      void switchView('panel');
    });
    const offQuick = api.onTriggerQuickActions(({ text }) => {
      setQuickText(text);
      void switchView('quick');
    });
    return () => {
      offCap();
      offPtt();
      offQuick();
    };
  }, []);

  // ── helpers ───────────────────────────────────────────────────
  const switchView = useCallback(async (next: ViewName) => {
    setView(next);
    await api.setView(next);
  }, []);

  const persistSettings = useCallback(async (patch: Partial<Settings>) => {
    const next = await api.saveSettings(patch);
    setSettings(next);
  }, []);

  const refreshThreads = useCallback(async () => {
    setThreads(await api.listThreads());
  }, []);

  const openThread = useCallback(async (id: string) => {
    const t = await api.getThread(id);
    if (!t) return;
    setCurrentThread(t);
    setMessages(await api.listMessages(id));
    await persistSettings({ currentThreadId: id });
  }, [persistSettings]);

  const createNewThread = useCallback(async () => {
    if (!settings) return;
    const t = await api.createThread({
      title: 'New chat',
      personaId: settings.personaId,
      model: settings.model || null,
    });
    await refreshThreads();
    setCurrentThread(t);
    setMessages([]);
    await persistSettings({ currentThreadId: t.id });
  }, [settings, refreshThreads, persistSettings]);

  const deleteThread = useCallback(async (id: string) => {
    // Soft-delete + undo. Capture the title BEFORE the IPC so the toast
    // can reference it even after the thread is out of the active list.
    const title = threads.find((t) => t.id === id)?.title ?? 'thread';
    await api.deleteThread(id);
    await refreshThreads();
    if (currentThread?.id === id) {
      const remaining = await api.listThreads();
      const next = remaining[0] ?? null;
      setCurrentThread(next);
      if (next) {
        setMessages(await api.listMessages(next.id));
        await persistSettings({ currentThreadId: next.id });
      } else {
        setMessages([]);
        await persistSettings({ currentThreadId: null });
      }
    }
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoState({ id, title });
    undoTimerRef.current = setTimeout(() => setUndoState(null), 7000);
  }, [threads, currentThread, refreshThreads, persistSettings]);

  const restoreDeletedThread = useCallback(async (id: string) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoState(null);
    await api.restoreThread(id);
    await refreshThreads();
    // Re-open the restored thread so the user sees their work again.
    const restored = await api.getThread(id);
    if (restored) {
      setCurrentThread(restored);
      setMessages(await api.listMessages(restored.id));
      await persistSettings({ currentThreadId: restored.id });
    }
  }, [refreshThreads, persistSettings]);

  // Guard against double-send: if the user hits Enter twice fast (or
  // clicks Send while a reply is already streaming), we'd otherwise
  // spawn a second onChatToken subscription that tees both streams
  // into the same assistant message, producing duplicated tokens.
  const sendingRef = useRef(false);

  const sendMessage = useCallback(
    async (text: string, attachments: Omit<DbAttachment, 'id' | 'messageId'>[]) => {
      if (!settings) return;
      if (sendingRef.current) return;
      sendingRef.current = true;
      try {

      // Ensure we have a thread.
      let thread = currentThread;
      if (!thread) {
        thread = await api.createThread({
          title: text.slice(0, 60) || 'New chat',
          personaId: settings.personaId,
          model: settings.model || null,
        });
        setCurrentThread(thread);
        await refreshThreads();
        await persistSettings({ currentThreadId: thread.id });
      } else if (thread.title === 'New chat' && messages.length === 0) {
        // Auto-title from the first user message.
        const newTitle = text.slice(0, 60);
        await api.updateThread(thread.id, { title: newTitle });
        setCurrentThread({ ...thread, title: newTitle });
        await refreshThreads();
      }

      const persona = personas.find((p) => p.id === settings.personaId) ?? personas[0];
      const systemPrompt = persona?.systemPrompt ?? 'You are a helpful assistant.';
      const model = thread.model ?? settings.model;
      if (!model) {
        return; // UI shows the warning instead; outer finally releases the guard
      }

      // Optimistic UI: add the user message immediately.
      const optimisticUser: DbMessage = {
        id: 'optimistic-' + Date.now(),
        threadId: thread.id,
        role: 'user',
        content: text,
        createdAt: Date.now(),
        redactedCount: 0,
        attachments: attachments.map((a, i) => ({ ...a, id: `opt-${i}`, messageId: 'opt' })),
      };
      const optimisticAssistant: DbMessage = {
        id: 'optimistic-asst-' + Date.now(),
        threadId: thread.id,
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
        redactedCount: 0,
        attachments: [],
      };
      setMessages((prev) => [...prev, optimisticUser, optimisticAssistant]);

      // Subscribe to streaming tokens until this exchange completes.
      // Filter by both the original send's thread id AND the currently-open
      // thread — otherwise a mid-stream thread-switch would splice tokens
      // from thread A into thread B's message list.
      const offTok = api.onChatToken(({ threadId: tid, token }) => {
        if (tid !== thread!.id) return;
        if (currentThreadIdRef.current !== tid) return;
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === 'assistant') {
            next[next.length - 1] = { ...last, content: last.content + token };
          }
          return next;
        });
      });

      try {
        const result = await api.chatSend({
          threadId: thread.id,
          model,
          systemPrompt,
          userText: text,
          attachments,
        });
        if (result && result.ok === false) {
          // Main returned a structured failure — surface it with a friendly
          // message rather than letting the optimistic bubble hang empty.
          const f = friendlyError(result.error);
          setMessages(await api.listMessages(thread.id));
          setChatError(f);
          return;
        }
        // Replace the optimistic exchange with the persisted one.
        const real = await api.listMessages(thread.id);
        setMessages(real);

        // TTS: speak the assistant's reply if speak-aloud is on AND we're
        // in voice mode (so chat-mode users don't get unexpected audio).
        if (settings.ttsEnabled && settings.mode === 'voice') {
          const last = real[real.length - 1];
          if (last && last.role === 'assistant' && last.content) {
            void speakText(last.content);
          }
        }
      } finally {
        offTok();
      }
      } finally {
        // Outer guard-release — runs on every exit path from this
        // function, including early returns (no model, mid-create
        // throw) and the inner try/finally's rethrow.
        sendingRef.current = false;
      }
    },
    [settings, currentThread, personas, messages.length, refreshThreads, persistSettings],
  );

  // Regenerate the last assistant message in the current thread: find
  // the most recent user turn, trim everything after it, and re-run
  // chat-send with the same user text.
  const regenerateLast = useCallback(async (): Promise<void> => {
    if (!currentThread) return;
    const msgs = await api.listMessages(currentThread.id);
    let lastUser = null as DbMessage | null;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') { lastUser = msgs[i]; break; }
    }
    if (!lastUser) return;
    await api.trimMessagesAfter({ threadId: currentThread.id, fromMessageId: lastUser.id });
    setMessages(await api.listMessages(currentThread.id));
    await sendMessage(lastUser.content, []);
  }, [currentThread, sendMessage]);

  // Fork the current thread at a chosen message — creates a new thread
  // with history up to and including that message, then switches to it.
  const forkFromMessage = useCallback(async (messageId: string): Promise<void> => {
    if (!currentThread) return;
    const forked = await api.forkThread({
      sourceThreadId: currentThread.id,
      untilMessageId: messageId,
      title: `${currentThread.title} (fork)`,
    });
    if (!forked) return;
    await refreshThreads();
    setCurrentThread(forked);
    setMessages(await api.listMessages(forked.id));
    await persistSettings({ currentThreadId: forked.id });
  }, [currentThread, refreshThreads, persistSettings]);

  // ── render ────────────────────────────────────────────────────
  if (!settings) return null; // brief flash before settings load

  return (
    <>
      {view === 'ball' && (
        <Ball onClick={() => void switchView('panel')} />
      )}

      {view === 'panel' && (
        <Panel
          settings={settings}
          personas={personas}
          threads={threads}
          currentThread={currentThread}
          messages={messages}
          onClose={() => void switchView('ball')}
          onOpenSettings={() => void switchView('settings')}
          onOpenThread={openThread}
          onNewThread={createNewThread}
          onDeleteThread={deleteThread}
          onSend={sendMessage}
          onPersonaChange={(id) => void persistSettings({ personaId: id })}
          onModelChange={(m) => void persistSettings({ model: m })}
          onStartAgent={(goal) => void startAgent(goal)}
          onStartResearch={(q) => void startResearch(q)}
          onOpenCanvas={() => setCanvasOpen(true)}
          onRegenerateLast={() => void regenerateLast()}
          onForkFromMessage={(mid) => void forkFromMessage(mid)}
        />
      )}

      {agentRun && (
        <AgentPanel
          run={agentRun}
          approval={agentApproval}
          onApprove={(allow) => void decideAgentApproval(allow)}
          onClose={() => setAgentRun(null)}
        />
      )}

      {researchRun && (
        <ResearchPanel
          run={researchRun}
          onClose={() => setResearchRun(null)}
        />
      )}

      {canvasOpen && (
        <Canvas
          threadId={currentThread?.id ?? null}
          onClose={() => setCanvasOpen(false)}
        />
      )}

      {classroomState.role === 'teacher' && teacherDashboardOpen && (
        <TeacherDashboard
          state={classroomState}
          onClose={() => setTeacherDashboardOpen(false)}
        />
      )}

      {classroomState.role === 'student' && (
        <StudentLock
          state={classroomState}
          incoming={classroomMessages}
          onDismissMessage={(idx) => setClassroomMessages((prev) => prev.filter((_, i) => i !== idx))}
          onLeave={async () => { await api.classroomLeave(); setClassroomMessages([]); }}
        />
      )}

      {paletteOpen && (
        <CommandPalette
          threads={threads}
          onClose={() => setPaletteOpen(false)}
          onPick={async (action) => {
            if (action.kind === 'thread') {
              await openThread(action.payload);
              void switchView('panel');
            } else if (action.kind === 'artifact') {
              setCanvasOpen(true);
            } else if (action.kind === 'memory') {
              // Pre-fills a /recall style prompt in a fresh thread so the
              // user sees the memory alongside the LLM's synthesis.
              await sendMessage(`Recall from memory: ${action.payload}`, []);
            } else if (action.kind === 'slash') {
              void switchView('panel');
              // The composer listens for URL hash; simpler: just paste via clipboard.
              // For now, open panel and user types /<name>.
            } else if (action.kind === 'action') {
              if (action.payload === 'new-thread') await createNewThread();
              else if (action.payload === 'open-canvas') setCanvasOpen(true);
              else if (action.payload === 'start-agent') setGoalPrompt('agent');
              else if (action.payload === 'start-research') setGoalPrompt('research');
              else if (action.payload === 'start-team') setGoalPrompt('team');
            } else if (action.kind === 'setting') {
              void switchView('settings');
            }
          }}
        />
      )}

      {upgradeInfo && (
        <UpgradePrompt
          info={upgradeInfo}
          onClose={() => setUpgradeInfo(null)}
          onOpenLicense={() => void switchView('settings')}
        />
      )}

      {showTrialExpired && (
        <TrialExpiredModal
          onAcknowledge={async () => {
            setShowTrialExpired(false);
            await persistSettings({ trialExpiryAcknowledged: true });
          }}
          onOpenLicense={() => void switchView('settings')}
        />
      )}

      {goalPrompt && (
        <InputModal
          title={
            goalPrompt === 'agent' ? 'Start an agent run'
            : goalPrompt === 'research' ? 'Start deep research'
            : 'Start a team run'
          }
          description={
            goalPrompt === 'agent'
              ? 'Give the agent a goal. It\'ll plan the steps, ask for approval before touching anything risky, and stream results into the panel.'
              : goalPrompt === 'research'
                ? 'Ask a research question. PAiA will plan sub-questions, search the web, fetch sources, and write a cited report.'
                : 'A planner, researcher, coder, and reviewer will collaborate on one goal. Best for non-trivial tasks.'
          }
          placeholder={
            goalPrompt === 'agent'
              ? 'Book a table for two at 7pm Friday and put it in my calendar'
              : goalPrompt === 'research'
                ? 'What changed in US GPU export controls in 2026?'
                : 'Write a blog post about PAiA\'s classroom mode, with citations.'
          }
          examples={
            goalPrompt === 'agent'
              ? ['Summarise unread email and draft replies as artifacts', 'Find flights to Lisbon under $500 next Thursday', 'Research the top three competitors and save the report to Canvas']
              : goalPrompt === 'research'
                ? ['Compare Llama 3.3 vs Qwen 2.5 on reasoning benchmarks', 'What are the known bugs in Ollama 0.5.0?', 'Effects of classroom AI tutoring on K-12 outcomes since 2023']
                : undefined
          }
          submitLabel="Start"
          multiline
          onCancel={() => setGoalPrompt(null)}
          onSubmit={async (value) => {
            const kind = goalPrompt;
            setGoalPrompt(null);
            if (kind === 'agent') { void startAgent(value); return; }
            if (kind === 'research') { void startResearch(value); return; }
            if (kind === 'team' && settings && currentThread) {
              try {
                await api.teamStart({
                  threadId: currentThread.id,
                  goal: value,
                  model: (currentThread.model ?? settings.model) || '',
                });
              } catch (err) {
                const upg = detectUpgradeError(err);
                if (upg) setUpgradeInfo(upg);
              }
            }
          }}
        />
      )}

      {undoState && (
        <div className="undo-toast" role="status" aria-live="polite">
          <span>Deleted "{undoState.title.length > 40 ? undoState.title.slice(0, 40) + '…' : undoState.title}"</span>
          <button
            type="button"
            className="secondary"
            onClick={() => void restoreDeletedThread(undoState.id)}
          >
            Undo
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => {
              if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
              setUndoState(null);
            }}
            aria-label="Dismiss"
          >×</button>
        </div>
      )}

      <LearnedToast onOpenMemory={() => void switchView('settings')} />
      {shortcutHelpOpen && <ShortcutHelp onClose={() => setShortcutHelpOpen(false)} />}
      {chatError && (
        <div className="chat-error-toast" role="alert" onClick={() => setChatError(null)}>
          <div className="chat-error-title">{chatError.title}</div>
          {chatError.hint && <div className="chat-error-hint">{chatError.hint}</div>}
        </div>
      )}

      <AmbientToast
        onAccept={async (s) => {
          if (s.actionKind === 'chat') {
            await sendMessage(s.actionPrompt, []);
            void switchView('panel');
          } else if (s.actionKind === 'agent') {
            void startAgent(s.actionPrompt);
          } else if (s.actionKind === 'research') {
            void startResearch(s.actionPrompt);
          } else if (s.actionKind === 'canvas') {
            setCanvasOpen(true);
          }
        }}
      />

      <div className="palette-hint">
        <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd> for commands
      </div>

      {view === 'settings' && (
        <SettingsView
          settings={settings}
          personas={personas}
          onSave={persistSettings}
          onBack={() => void switchView('panel')}
          onPersonasChanged={async () => setPersonas(await api.listPersonas())}
          onQuit={() => void api.quit()}
        />
      )}

      {view === 'onboarding' && (
        <Onboarding
          settings={settings}
          onComplete={async (patch) => {
            await persistSettings({ ...patch, onboarded: true });
            await switchView('ball');
          }}
        />
      )}

      {view === 'quick' && (
        <QuickActions
          text={quickText}
          onEditText={(t) => setQuickText(t)}
          onCancel={() => void switchView('ball')}
          onAction={async (prompt) => {
            // Always start a fresh thread for quick actions so they don't
            // pollute the user's main conversation history.
            if (!settings) return;
            const thread = await api.createThread({
              title: quickText.slice(0, 60) || 'Quick action',
              personaId: settings.personaId,
              model: settings.model || null,
            });
            await refreshThreads();
            setCurrentThread(thread);
            setMessages([]);
            await persistSettings({ currentThreadId: thread.id });
            await switchView('panel');
            // Tiny delay so the panel has mounted before sendMessage runs.
            setTimeout(() => void sendMessage(prompt, []), 60);
          }}
        />
      )}

      {approval && (
        <McpApprovalModal
          request={approval}
          onApprove={() => void decideApproval(true)}
          onDeny={() => void decideApproval(false)}
        />
      )}
    </>
  );
}
