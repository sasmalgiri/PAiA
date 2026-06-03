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
import { CouncilPanel, type CouncilState } from './components/CouncilPanel';
import { MapReducePanel, type MapReduceState } from './components/MapReducePanel';
import { EscalationPrompt } from './components/EscalationPrompt';
import { isCloudModel } from './lib/modelGroups';
import { TipCard } from './components/TipCard';
import { pickNextTip, allTipIds, type TipDefinition } from './lib/tipCards';
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
  // Last persona-routing decision, surfaced as a chip above the response.
  // Lets the user see why the active persona changed and override.
  const [lastRouteDecision, setLastRouteDecision] = useState<{
    personaIds: string[];
    reason: string;
    mode: 'embedding-only' | 'embedding+llm' | 'no-personas';
  } | null>(null);
  // Active council-of-experts run.
  const [councilState, setCouncilState] = useState<CouncilState | null>(null);
  // Active long-read (map-reduce) run.
  const [mapReduceState, setMapReduceState] = useState<MapReduceState | null>(null);
  // Pending cloud-escalation prompt. The send is parked on a resolver
  // until the user picks; ESC resolves to 'no'.
  const [escalationPrompt, setEscalationPrompt] = useState<{
    query: string;
    reason: string;
    cloudModel: string;
    resolve: (choice: 'this-turn' | 'always' | 'no') => void;
  } | null>(null);
  const [activeTip, setActiveTip] = useState<TipDefinition | null>(null);
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

  // Long-read (map-reduce) event stream.
  useEffect(() => {
    const off = api.onMapReduceEvent((ev) => {
      setMapReduceState((prev) => {
        if (!prev) return prev;
        if (prev.runId !== null && ev.runId !== prev.runId) return prev;
        switch (ev.kind) {
          case 'started':
            return {
              ...prev,
              runId: ev.runId,
              totalChunks: ev.totalChunks ?? 0,
              status: 'mapping',
            };
          case 'chunk-progress':
            return {
              ...prev,
              chunksDone: ev.k ?? prev.chunksDone,
              chunksWithContent: prev.chunksWithContent + (ev.hasContent ? 1 : 0),
            };
          case 'reduce-started':
            return {
              ...prev,
              usableChunks: ev.usableChunks ?? prev.chunksWithContent,
              status: 'reducing',
            };
          case 'reduce-token':
            return { ...prev, answer: prev.answer + (ev.token ?? '') };
          case 'finished':
            return {
              ...prev,
              answer: ev.answer ?? prev.answer,
              usableChunks: ev.sourceChunkCount ?? prev.usableChunks,
              status: 'done',
            };
          case 'error':
            return { ...prev, status: 'error', error: ev.error };
          default:
            return prev;
        }
      });
    });
    return off;
  }, []);

  // Tip cards (E2). Pre-populates tipsShown for existing users (so they
  // don't get nagged) and picks the next tip when context changes.
  useEffect(() => {
    if (!settings) return;
    // Existing users: settings.onboarded is true but tipsShown is empty
    // → they predate the tip system. Mark every tip as already-shown so
    // we don't ambush them with notifications about features they use.
    if (settings.onboarded && settings.tipsShown.length === 0) {
      void api.saveSettings({ tipsShown: allTipIds() });
    }
  }, [settings?.onboarded]);

  // Onboarding telemetry — fires only once per install via the
  // tipsShown bookkeeping (which doubles as a "have we seen this
  // milestone?" record). Analytics is itself opt-in upstream so this
  // is a no-op unless the user enabled it.
  const milestoneRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!settings || settings.tipsDisabled) return;
    function fire(name: string, props: Record<string, unknown> = {}): void {
      if (milestoneRef.current.has(name)) return;
      milestoneRef.current.add(name);
      void api.analyticsEvent(name, props);
    }
    if (messages.length >= 1) {
      fire('onboarding:first-message');
    }
    if (messages.length >= 5) {
      fire('onboarding:engaged');
    }
  }, [settings?.tipsDisabled, messages.length]);

  useEffect(() => {
    if (!settings) return;
    if (settings.tipsDisabled) { setActiveTip(null); return; }
    // Don't surface tips while a modal/panel is taking over the screen.
    if (councilState || mapReduceState || agentRun || researchRun || canvasOpen || escalationPrompt) return;

    const ctx = {
      view: view,
      messageCount: messages.length,
      hasAttachment: messages.some((m) => m.attachments.length > 0),
      personaCount: personas.length,
    };
    const next = pickNextTip(ctx, settings.tipsShown);
    setActiveTip((prev) => (prev?.id === next?.id ? prev : next));
  }, [
    settings?.tipsDisabled,
    settings?.tipsShown,
    view,
    messages.length,
    personas.length,
    councilState,
    mapReduceState,
    agentRun,
    researchRun,
    canvasOpen,
    escalationPrompt,
  ]);

  const dismissTip = useCallback(async (tipId: string): Promise<void> => {
    setActiveTip(null);
    if (!settings) return;
    if (settings.tipsShown.includes(tipId)) return;
    await api.saveSettings({ tipsShown: [...settings.tipsShown, tipId] });
  }, [settings]);

  // Council-of-experts event stream. Maintains the modal's state as
  // each expert reports and the synthesis streams.
  useEffect(() => {
    const off = api.onCouncilEvent((ev) => {
      setCouncilState((prev) => {
        if (!prev) return prev;
        if (prev.runId !== null && ev.runId !== prev.runId) return prev;
        switch (ev.kind) {
          case 'started':
            return {
              ...prev,
              runId: ev.runId,
              personaIds: ev.personaIds ?? prev.personaIds,
              status: 'experts-running',
            };
          case 'expert-done':
            return {
              ...prev,
              expertAnswers: [
                ...prev.expertAnswers.filter((a) => a.personaId !== ev.personaId),
                {
                  personaId: ev.personaId!,
                  personaName: ev.personaName ?? ev.personaId!,
                  emoji: ev.emoji ?? '🤖',
                  content: ev.content ?? '',
                  durationMs: ev.durationMs ?? 0,
                  error: ev.error,
                },
              ],
            };
          case 'experts-all-done':
            return {
              ...prev,
              expertAnswers: ev.expertAnswers ?? prev.expertAnswers,
              status: 'synthesising',
            };
          case 'synthesis-token':
            return { ...prev, synthesis: prev.synthesis + (ev.token ?? '') };
          case 'finished':
            return {
              ...prev,
              synthesis: ev.synthesis ?? prev.synthesis,
              expertAnswers: ev.expertAnswers ?? prev.expertAnswers,
              status: 'done',
            };
          case 'error':
            return { ...prev, status: 'error', error: ev.error };
          default:
            return prev;
        }
      });
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
      void api.analyticsEvent('feature-discovery:agent', { autonomy: settings.agentAutonomy });
      setAgentRun(run);
    } catch (err) {
      const upg = detectUpgradeError(err);
      if (upg) setUpgradeInfo(upg);
      else setChatError(friendlyError(err instanceof Error ? err.message : String(err)));
    }
  }, [settings, currentThread]);

  // ── Long-read (map-reduce) ──────────────────────────────────
  // Looks back through the current thread for the most recent
  // text/PDF attachment and runs map-reduce on it.
  const startMapReduce = useCallback(async (question: string) => {
    if (!settings) return;
    if (!question.trim()) return;
    const thread = currentThread;
    if (!thread) {
      setChatError({ title: 'Open a thread first', hint: 'Attach a long doc to a thread, then ask /longread <question>.' });
      return;
    }
    const model = thread.model ?? settings.model;
    if (!model) {
      setChatError({ title: 'No model selected', hint: 'Pick a model in Settings → Models before /longread.' });
      return;
    }

    // Find the most recent text/PDF attachment in this thread.
    const recent = await api.listMessages(thread.id);
    let docText: string | null = null;
    let docLabel = '';
    for (let i = recent.length - 1; i >= 0; i--) {
      const msg = recent[i];
      const att = msg.attachments.find((a) => a.kind === 'text' || a.kind === 'pdf');
      if (att && att.content && att.content.length > 0) {
        docText = att.content;
        docLabel = att.filename || (att.kind === 'pdf' ? 'PDF' : 'document');
        break;
      }
    }
    if (!docText) {
      setChatError({
        title: 'No long document in this thread',
        hint: 'Attach a PDF or text file first, then /longread <question>.',
      });
      return;
    }

    setMapReduceState({
      runId: null,
      question,
      documentLabel: docLabel,
      totalChunks: 0,
      chunksDone: 0,
      chunksWithContent: 0,
      usableChunks: 0,
      answer: '',
      status: 'pending',
    });
    void api.analyticsEvent('feature-discovery:longread', { docLabel: docLabel.slice(0, 40) });
    try {
      await api.mapReduceStart({
        threadId: thread.id,
        question,
        documentText: docText,
        documentLabel: docLabel,
        model,
        parallelism: settings.routerPoolSize, // reuse the same knob
        personaId: thread.personaId ?? undefined,
      });
    } catch (err) {
      setMapReduceState((prev) => prev ? { ...prev, status: 'error', error: err instanceof Error ? err.message : String(err) } : prev);
    }
  }, [settings, currentThread]);

  // ── Council ─────────────────────────────────────────────────
  // Kick off a council-of-experts run. Persona IDs are optional; if
  // omitted, the router is asked to pick `routerPoolSize` from the pool.
  const startCouncil = useCallback(async (question: string, picks?: string[]) => {
    if (!settings) return;
    if (!question.trim()) return;
    let thread = currentThread;
    if (!thread) {
      thread = await api.createThread({
        title: `Council: ${question.slice(0, 50)}`,
        personaId: settings.personaId,
        model: settings.model || null,
      });
      setCurrentThread(thread);
      setThreads(await api.listThreads());
    }
    const model = thread.model ?? settings.model;
    if (!model) {
      setChatError({ title: 'No model selected', hint: 'Pick a model in Settings → Models before starting a council.' });
      return;
    }

    let personaIds = picks;
    if (!personaIds || personaIds.length === 0) {
      try {
        const decision = await api.personaRoute({
          query: question,
          poolSize: settings.routerPoolSize,
        });
        personaIds = decision.personaIds;
        setLastRouteDecision({
          personaIds: decision.personaIds,
          reason: decision.reason,
          mode: decision.mode,
        });
      } catch (err) {
        // Routing failed — fall back to the active persona only (degenerate council of 1).
        personaIds = [settings.personaId];
      }
    }
    if (personaIds.length === 0) {
      setChatError({ title: 'No personas to consult', hint: 'The router returned an empty pick list.' });
      return;
    }

    // Open the modal immediately in pending state. The IPC event stream
    // updates it as the run progresses.
    setCouncilState({
      runId: null,
      question,
      personaIds,
      expertAnswers: [],
      synthesis: '',
      status: 'pending',
    });
    void api.analyticsEvent('feature-discovery:council', { experts: personaIds.length });
    try {
      await api.councilStart({
        threadId: thread.id,
        question,
        personaIds,
        model,
      });
    } catch (err) {
      setCouncilState((prev) => prev ? { ...prev, status: 'error', error: err instanceof Error ? err.message : String(err) } : prev);
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
      void api.analyticsEvent('feature-discovery:research', { depth: settings.researchDepth });
      setResearchRun(run);
    } catch (err) {
      const upg = detectUpgradeError(err);
      if (upg) setUpgradeInfo(upg);
      else setChatError(friendlyError(err instanceof Error ? err.message : String(err)));
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
        await switchView('panel');
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

      // Auto-route: if enabled, ask the router which persona(s) fit best
      // and either swap the active persona (single mode) or fire a
      // council run (council mode). The router also classifies query
      // difficulty so we can offer cloud escalation for hard ones.
      let effectivePersonaId: string = settings.personaId;
      let effectiveModelOverride: string | null = null;
      if (settings.autoRoutePersona !== 'off' && text.trim().length > 0) {
        try {
          const decision = await api.personaRoute({
            query: text,
            poolSize: settings.routerPoolSize,
          });
          if (decision.personaIds.length > 0) {
            setLastRouteDecision({
              personaIds: decision.personaIds,
              reason: decision.reason,
              mode: decision.mode,
            });

            // Council mode + at least 2 valid picks → fire a council
            // run and skip the normal single-chat path entirely.
            if (settings.autoRoutePersona === 'council' && decision.personaIds.length >= 2) {
              sendingRef.current = false;
              await startCouncil(text, decision.personaIds);
              return;
            }

            // Single mode (or council fallback when only 1 pick).
            effectivePersonaId = decision.personaIds[0];
            if (effectivePersonaId !== thread.personaId) {
              await api.updateThread(thread.id, { personaId: effectivePersonaId });
              thread = { ...thread, personaId: effectivePersonaId };
              setCurrentThread(thread);
            }

            // Cloud escalation: only consider when the current model is
            // local, the router said the query is hard, escalation is
            // configured, and a cloud target model is set.
            const currentModel = thread.model ?? settings.model;
            const isLocalNow = currentModel && !isCloudModel(currentModel);
            if (
              isLocalNow &&
              decision.difficulty === 'hard' &&
              settings.cloudEscalation !== 'off' &&
              settings.cloudEscalationModel
            ) {
              if (settings.cloudEscalation === 'auto') {
                effectiveModelOverride = settings.cloudEscalationModel;
              } else {
                // 'ask' — park the send on the user's choice.
                const choice = await new Promise<'this-turn' | 'always' | 'no'>((resolve) => {
                  setEscalationPrompt({
                    query: text,
                    reason: decision.reason,
                    cloudModel: settings.cloudEscalationModel,
                    resolve,
                  });
                });
                setEscalationPrompt(null);
                if (choice === 'this-turn') {
                  effectiveModelOverride = settings.cloudEscalationModel;
                } else if (choice === 'always') {
                  effectiveModelOverride = settings.cloudEscalationModel;
                  await persistSettings({ cloudEscalation: 'auto' });
                }
                // 'no' → keep local; effectiveModelOverride stays null.
              }
            }
          }
        } catch (err) {
          // Routing is best-effort; never block the chat send on it.
          // eslint-disable-next-line no-console
          console.warn('persona route failed, falling back to current persona', err);
        }
      } else {
        setLastRouteDecision(null);
      }

      const persona = personas.find((p) => p.id === effectivePersonaId) ?? personas[0];
      const systemPrompt = persona?.systemPrompt ?? 'You are a helpful assistant.';
      const model = effectiveModelOverride ?? thread.model ?? settings.model;
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
          onModelChange={(m, extra) => void persistSettings({ model: m, ...(extra ?? {}) })}
          onStartAgent={(goal) => void startAgent(goal)}
          onStartResearch={(q) => void startResearch(q)}
          onStartCouncil={(q) => void startCouncil(q)}
          onStartLongread={(q) => void startMapReduce(q)}
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

      {councilState && (
        <CouncilPanel
          state={councilState}
          onClose={() => setCouncilState(null)}
          onAbort={() => {
            if (councilState.runId) void api.councilAbort(councilState.runId);
            setCouncilState((prev) => prev ? { ...prev, status: 'error', error: 'Aborted by user.' } : prev);
          }}
        />
      )}

      {mapReduceState && (
        <MapReducePanel
          state={mapReduceState}
          onClose={() => setMapReduceState(null)}
          onAbort={() => {
            if (mapReduceState.runId) void api.mapReduceAbort(mapReduceState.runId);
            setMapReduceState((prev) => prev ? { ...prev, status: 'error', error: 'Aborted by user.' } : prev);
          }}
        />
      )}

      {escalationPrompt && (
        <EscalationPrompt
          query={escalationPrompt.query}
          reason={escalationPrompt.reason}
          cloudModel={escalationPrompt.cloudModel}
          onChoice={(c) => escalationPrompt.resolve(c)}
        />
      )}

      {activeTip && (
        <TipCard
          tip={activeTip}
          onDismiss={() => void dismissTip(activeTip.id)}
          onAction={() => {
            if (activeTip.action?.kind === 'open-settings') void switchView('settings');
            else if (activeTip.action?.kind === 'open-palette') setPaletteOpen(true);
          }}
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

      {lastRouteDecision && lastRouteDecision.personaIds.length > 0 && view === 'panel' && (
        <div className="route-chip" role="status" aria-live="polite">
          <span className="route-chip-icon" aria-hidden>{lastRouteDecision.personaIds.length > 1 ? '🏛' : '🎯'}</span>
          <span className="route-chip-text">
            {(() => {
              const picks = lastRouteDecision.personaIds
                .map((id) => personas.find((p) => p.id === id))
                .filter((p): p is Persona => !!p);
              if (picks.length === 0) return 'Routed';
              if (picks.length === 1) {
                return <>Routed to <strong>{picks[0].emoji} {picks[0].name}</strong>{lastRouteDecision.mode === 'embedding-only' ? ' (semantic match)' : ''}</>;
              }
              return <>Council of {picks.length}: {picks.map((p, i) => (
                <span key={p.id}>{i > 0 ? ' · ' : ''}{p.emoji} {p.name}</span>
              ))}</>;
            })()}
          </span>
          {lastRouteDecision.reason && (
            <span className="route-chip-reason" title={lastRouteDecision.reason}>
              — {lastRouteDecision.reason.length > 60 ? lastRouteDecision.reason.slice(0, 57) + '…' : lastRouteDecision.reason}
            </span>
          )}
          <button
            type="button"
            className="icon-btn"
            onClick={() => setLastRouteDecision(null)}
            aria-label="Dismiss routing chip"
            title="Dismiss"
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
