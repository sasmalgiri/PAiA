// PAiA preload — narrow contextBridge surface for the sandboxed renderer.
//
// This is the ONLY place where the renderer can reach into Electron / Node.
// Every method here corresponds to an `ipcMain.handle('paia:...')` in main.ts.

import { contextBridge, ipcRenderer } from 'electron';
import type {
  ActiveWindowInfo,
  AgentApprovalRequest,
  AgentAutonomy,
  AgentRun,
  AgentStep,
  Artifact,
  ArtifactKind,
  AgentTeamMember,
  AgentTeamRun,
  AgentTeamTurn,
  AmbientSuggestion,
  ChatMessage,
  ClassroomPolicy,
  ClassroomState,
  ClassroomSession,
  CommandPaletteEntry,
  CompanionState,
  EnforcementState,
  ApiServerState,
  AutopilotFire,
  AutopilotRule,
  BetaState,
  FeedbackSubmission,
  RemoteBrowserConfig,
  RemoteBrowserState,
  MediaGenerateOptions,
  MediaGenerateResult,
  MediaProviderConfig,
  MediaProviderState,
  PluginState,
  SyncDirection,
  SyncProgress,
  SyncSettings,
  SyncSummary,
  ConnectorConfig,
  ConnectorDescriptor,
  ConnectorId,
  ConnectorStatus,
  DbAttachment,
  DbMessage,
  DbThread,
  HotkeyMap,
  KnowledgeCollection,
  KnowledgeDocument,
  McpServerConfig,
  McpServerState,
  McpToolCallApprovalRequest,
  McpToolCallResult,
  McpToolInfo,
  MemoryEntry,
  MemoryScope,
  ProviderConfig,
  ProviderState,
  FeatureFlag,
  LicenseStatus,
  PiperDownloadProgress,
  PiperStatus,
  PiperVoice,
  ResearchProgress,
  ResearchRun,
  ScheduledTask,
  SignedLicense,
  ToolDefinition,
  WakeWordState,
  WebSearchResponse,
  OcrResult,
  OllamaPullProgress,
  OllamaStatus,
  Persona,
  RagIngestProgress,
  RedactionResult,
  Settings,
  TranscribeResult,
  UpdateInfo,
  CaptureSource,
} from '../shared/types';

export type ViewName = 'ball' | 'panel' | 'settings' | 'onboarding' | 'quick';

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  arch: string;
  electron: string;
  node: string;
  userDataPath: string;
}

interface ChatSendPayload {
  threadId: string;
  model: string;
  systemPrompt: string;
  userText: string;
  attachments: Omit<DbAttachment, 'id' | 'messageId'>[];
}

const api = {
  // ── view / window ────────────────────────────────────────
  setView: (view: ViewName): Promise<void> => ipcRenderer.invoke('paia:set-view', view),

  // ── settings ─────────────────────────────────────────────
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('paia:get-settings'),
  saveSettings: (patch: Partial<Settings>): Promise<Settings> =>
    ipcRenderer.invoke('paia:save-settings', patch),

  // ── personas ─────────────────────────────────────────────
  listPersonas: (): Promise<Persona[]> => ipcRenderer.invoke('paia:list-personas'),
  createPersona: (p: { name: string; emoji: string; systemPrompt: string }): Promise<Persona> =>
    ipcRenderer.invoke('paia:create-persona', p),
  updatePersona: (id: string, patch: Partial<Persona>): Promise<Persona | null> =>
    ipcRenderer.invoke('paia:update-persona', { id, patch }),
  deletePersona: (id: string): Promise<boolean> => ipcRenderer.invoke('paia:delete-persona', id),

  // ── threads / messages ───────────────────────────────────
  listThreads: (): Promise<DbThread[]> => ipcRenderer.invoke('paia:list-threads'),
  getThread: (id: string): Promise<DbThread | null> => ipcRenderer.invoke('paia:get-thread', id),
  createThread: (p: { title: string; personaId: string | null; model: string | null }): Promise<DbThread> =>
    ipcRenderer.invoke('paia:create-thread', p),
  updateThread: (id: string, patch: Partial<{ title: string; personaId: string | null; model: string | null; pinned: boolean }>): Promise<void> =>
    ipcRenderer.invoke('paia:update-thread', { id, patch }),
  deleteThread: (id: string): Promise<void> => ipcRenderer.invoke('paia:delete-thread', id),
  restoreThread: (id: string): Promise<void> => ipcRenderer.invoke('paia:restore-thread', id),
  listMessages: (threadId: string): Promise<DbMessage[]> =>
    ipcRenderer.invoke('paia:list-messages', threadId),
  searchMessages: (query: string, limit?: number): Promise<DbMessage[]> =>
    ipcRenderer.invoke('paia:search-messages', { query, limit }),

  // ── ollama / chat ────────────────────────────────────────
  redact: (text: string): Promise<RedactionResult> => ipcRenderer.invoke('paia:redact', text),
  ollamaStatus: (): Promise<OllamaStatus> => ipcRenderer.invoke('paia:ollama-status'),
  ollamaDeleteModel: (name: string): Promise<boolean> =>
    ipcRenderer.invoke('paia:ollama-delete-model', name),
  ollamaPullModel: (name: string): Promise<boolean> =>
    ipcRenderer.invoke('paia:ollama-pull-model', name),
  ollamaCancelPull: (name: string): Promise<boolean> =>
    ipcRenderer.invoke('paia:ollama-cancel-pull', name),
  chatSend: (payload: ChatSendPayload): Promise<{ ok: boolean; text?: string; error?: string }> =>
    ipcRenderer.invoke('paia:chat-send', payload),

  // legacy single-shot chat (still used for screen "ask" path)
  chat: (model: string, messages: ChatMessage[]): Promise<string> =>
    ipcRenderer.invoke('paia:chat-send', {
      threadId: '__ephemeral__',
      model,
      systemPrompt: messages[0]?.role === 'system' ? messages[0].content : '',
      userText: messages[messages.length - 1]?.content ?? '',
      attachments: [],
    }),

  // ── screen / OCR ─────────────────────────────────────────
  captureListSources: (): Promise<CaptureSource[]> =>
    ipcRenderer.invoke('paia:capture-list-sources'),
  captureSource: (sourceId: string): Promise<string> =>
    ipcRenderer.invoke('paia:capture-source', sourceId),
  capturePrimary: (): Promise<string> => ipcRenderer.invoke('paia:capture-primary'),
  captureRegion: (): Promise<string | null> => ipcRenderer.invoke('paia:capture-region'),
  ocr: (dataUrl: string, lang?: string): Promise<OcrResult> =>
    ipcRenderer.invoke('paia:ocr', { dataUrl, lang }),

  // ── region overlay (used only by region.html) ──────────
  regionResult: (rect: { x: number; y: number; width: number; height: number } | null): Promise<void> =>
    ipcRenderer.invoke('paia:region-result', rect),
  regionCancel: (): Promise<void> => ipcRenderer.invoke('paia:region-cancel'),

  // ── RAG / knowledge ──────────────────────────────────────
  listCollections: (): Promise<KnowledgeCollection[]> =>
    ipcRenderer.invoke('paia:list-collections'),
  createCollection: (p: { name: string; description: string; embeddingModel: string }): Promise<KnowledgeCollection> =>
    ipcRenderer.invoke('paia:create-collection', p),
  deleteCollection: (id: string): Promise<void> =>
    ipcRenderer.invoke('paia:delete-collection', id),
  listDocuments: (collectionId: string): Promise<KnowledgeDocument[]> =>
    ipcRenderer.invoke('paia:list-documents', collectionId),
  deleteDocument: (id: string): Promise<void> =>
    ipcRenderer.invoke('paia:delete-document', id),
  ingestDocument: (payload: {
    collectionId: string;
    filename: string;
    mimeType: string;
    bytesBase64?: string;
    filePath?: string;
    embeddingModel?: string;
  }): Promise<{ ok: boolean; document?: KnowledgeDocument; error?: string }> =>
    ipcRenderer.invoke('paia:ingest-document', payload),
  listThreadCollections: (threadId: string): Promise<string[]> =>
    ipcRenderer.invoke('paia:list-thread-collections', threadId),
  attachCollection: (threadId: string, collectionId: string): Promise<void> =>
    ipcRenderer.invoke('paia:attach-collection', { threadId, collectionId }),
  detachCollection: (threadId: string, collectionId: string): Promise<void> =>
    ipcRenderer.invoke('paia:detach-collection', { threadId, collectionId }),

  // ── web search ───────────────────────────────────────────
  webSearch: (query: string, limit?: number): Promise<WebSearchResponse> =>
    ipcRenderer.invoke('paia:web-search', { query, limit }),

  // ── active window ────────────────────────────────────────
  activeWindow: (): Promise<ActiveWindowInfo | null> =>
    ipcRenderer.invoke('paia:active-window'),

  // ── piper TTS ────────────────────────────────────────────
  piperStatus: (): Promise<PiperStatus> => ipcRenderer.invoke('paia:piper-status'),
  piperVoices: (): Promise<PiperVoice[]> => ipcRenderer.invoke('paia:piper-voices'),
  piperDeleteVoice: (voiceId: string): Promise<boolean> =>
    ipcRenderer.invoke('paia:piper-delete-voice', voiceId),
  piperSynthesize: (voiceId: string, text: string): Promise<{ ok: boolean; wav?: string; error?: string }> =>
    ipcRenderer.invoke('paia:piper-synthesize', { voiceId, text }),

  // ── wake word ────────────────────────────────────────────
  wakeWordStatus: (): Promise<WakeWordState> => ipcRenderer.invoke('paia:wake-word-status'),
  wakeWordKeywords: (): Promise<string[]> => ipcRenderer.invoke('paia:wake-word-keywords'),

  // ── analytics ────────────────────────────────────────────
  analyticsEvent: (name: string, props?: Record<string, unknown>): Promise<void> =>
    ipcRenderer.invoke('paia:analytics-event', { name, props }),
  analyticsResetId: (): Promise<void> => ipcRenderer.invoke('paia:analytics-reset-id'),
  analyticsCurrentId: (): Promise<string | null> =>
    ipcRenderer.invoke('paia:analytics-current-id'),

  // ── clipboard ───────────────────────────────────────────
  readClipboardImage: (): Promise<string | null> => ipcRenderer.invoke('paia:read-clipboard-image'),
  readClipboardText: (): Promise<string> => ipcRenderer.invoke('paia:read-clipboard-text'),

  // ── license / trial ──────────────────────────────────────
  licenseStatus: (): Promise<LicenseStatus> => ipcRenderer.invoke('paia:license-status'),
  licenseActivate: (license: SignedLicense): Promise<{ ok: boolean; reason?: string }> =>
    ipcRenderer.invoke('paia:license-activate', license),
  licenseActivateText: (raw: string): Promise<{ ok: boolean; reason?: string }> =>
    ipcRenderer.invoke('paia:license-activate-text', raw),
  licenseDeactivate: (): Promise<LicenseStatus> => ipcRenderer.invoke('paia:license-deactivate'),
  licenseRedeemExtension: (raw: string): Promise<{ ok: boolean; reason?: string; addedDays?: number }> =>
    ipcRenderer.invoke('paia:license-redeem-extension', raw),
  meteringSnapshots: (): Promise<{ kind: string; label: string; perDay: boolean; limit: number; used: number; capped: boolean }[]> =>
    ipcRenderer.invoke('paia:metering-snapshots'),
  featureEnabled: (feature: FeatureFlag): Promise<boolean> =>
    ipcRenderer.invoke('paia:feature-enabled', feature),

  // ── providers (LLM backends) ─────────────────────────────
  listProviderStates: (): Promise<ProviderState[]> => ipcRenderer.invoke('paia:list-provider-states'),
  getProviderConfigs: (): Promise<ProviderConfig[]> => ipcRenderer.invoke('paia:get-provider-configs'),
  saveProviderConfigs: (list: ProviderConfig[]): Promise<ProviderConfig[]> =>
    ipcRenderer.invoke('paia:save-provider-configs', list),

  // ── MCP (Model Context Protocol) ─────────────────────────
  mcpListConfigs: (): Promise<McpServerConfig[]> => ipcRenderer.invoke('paia:mcp-list-configs'),
  mcpSaveConfigs: (list: McpServerConfig[]): Promise<McpServerConfig[]> =>
    ipcRenderer.invoke('paia:mcp-save-configs', list),
  mcpListStates: (): Promise<McpServerState[]> => ipcRenderer.invoke('paia:mcp-list'),
  mcpListTools: (): Promise<McpToolInfo[]> => ipcRenderer.invoke('paia:mcp-list-tools'),
  mcpCallTool: (serverId: string, toolName: string, args: unknown): Promise<McpToolCallResult> =>
    ipcRenderer.invoke('paia:mcp-call-tool', { serverId, toolName, args }),
  mcpApprove: (requestId: string, allow: boolean): Promise<void> =>
    ipcRenderer.invoke('paia:mcp-approve', { requestId, allow }),

  // ── voice / whisper ──────────────────────────────────────
  transcribe: (pcm: Float32Array, lang?: string): Promise<TranscribeResult> =>
    ipcRenderer.invoke('paia:transcribe', { pcm, lang }),
  transcribeStream: (pcm: Float32Array, lang?: string, streamId?: string): Promise<{ ok: boolean; streamId?: string; text?: string; error?: string }> =>
    ipcRenderer.invoke('paia:transcribe-stream', { pcm, lang, streamId }),
  onWhisperToken: (handler: (p: { streamId: string; token: string }) => void) =>
    sub('paia:whisper-token', handler),
  onWhisperDone: (handler: (p: { streamId: string; text: string; error?: string }) => void) =>
    sub('paia:whisper-done', handler),
  onWhisperDownloadProgress: (
    handler: (p: {
      status: string;
      file?: string;
      progress?: number;
      loaded?: number;
      total?: number;
    }) => void,
  ) => sub('paia:whisper-download-progress', handler),

  // ── updater ──────────────────────────────────────────────
  checkForUpdates: (): Promise<UpdateInfo> => ipcRenderer.invoke('paia:check-for-updates'),
  downloadUpdate: (): Promise<void> => ipcRenderer.invoke('paia:download-update'),
  quitAndInstall: (): Promise<void> => ipcRenderer.invoke('paia:quit-and-install'),

  // ── misc ─────────────────────────────────────────────────
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('paia:open-external', url),
  openUserPath: (subpath: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('paia:open-user-path', subpath),
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('paia:get-app-info'),
  quit: (): Promise<void> => ipcRenderer.invoke('paia:quit'),
  detachThread: (threadId: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('paia:detach-thread', threadId),

  // ── event subscriptions ──────────────────────────────────
  onChatToken: (handler: (payload: { threadId: string; token: string }) => void) =>
    sub('paia:chat-token', handler),
  onChatDone: (handler: (payload: { threadId: string; text: string }) => void) =>
    sub('paia:chat-done', handler),
  onChatError: (handler: (payload: { threadId: string; error: string }) => void) =>
    sub('paia:chat-error', handler),
  onTriggerCapture: (handler: () => void) => sub('paia:trigger-capture', handler),
  onTriggerPushToTalk: (handler: () => void) => sub('paia:trigger-ptt', handler),
  onTriggerQuickActions: (handler: (p: { text: string }) => void) =>
    sub('paia:trigger-quick-actions', handler),
  onOllamaPullProgress: (
    handler: (p: OllamaPullProgress & { name: string }) => void,
  ) => sub('paia:ollama-pull-progress', handler),
  onIngestProgress: (
    handler: (p: RagIngestProgress & { collectionId: string }) => void,
  ) => sub('paia:ingest-progress', handler),
  onRagCited: (
    handler: (p: { threadId: string; sources: { n: number; filename?: string; ordinal: number; score?: number }[] }) => void,
  ) => sub('paia:rag-cited', handler),
  onUpdateAvailable: (handler: (info: UpdateInfo) => void) =>
    sub('paia:update-available', handler),
  onUpdateDownloaded: (handler: () => void) => sub('paia:update-downloaded', handler),
  onMcpToolApproval: (
    handler: (req: McpToolCallApprovalRequest) => void,
  ) => sub('paia:mcp-tool-approval', handler),
  onMcpState: (
    handler: (state: McpServerState) => void,
  ) => sub('paia:mcp-state', handler),
  onPiperProgress: (
    handler: (p: PiperDownloadProgress) => void,
  ) => sub('paia:piper-progress', handler),

  // ── agent ────────────────────────────────────────────────
  agentStart: (opts: { threadId: string; goal: string; model: string; autonomy?: AgentAutonomy; stepBudget?: number; extraContext?: string }): Promise<AgentRun> =>
    ipcRenderer.invoke('paia:agent-start', opts),
  agentAbort: (runId: string): Promise<boolean> => ipcRenderer.invoke('paia:agent-abort', runId),
  agentApprove: (requestId: string, allow: boolean): Promise<void> =>
    ipcRenderer.invoke('paia:agent-approve', { requestId, allow }),
  agentListTools: (): Promise<ToolDefinition[]> => ipcRenderer.invoke('paia:agent-list-tools'),
  agentListRuns: (threadId?: string): Promise<AgentRun[]> =>
    ipcRenderer.invoke('paia:agent-list-runs', threadId),
  agentListSteps: (runId: string): Promise<AgentStep[]> =>
    ipcRenderer.invoke('paia:agent-list-steps', runId),
  onAgentRun: (handler: (run: AgentRun) => void) => sub('paia:agent-run', handler),
  onAgentStep: (handler: (step: AgentStep) => void) => sub('paia:agent-step', handler),
  onAgentToken: (handler: (p: { runId: string; token: string }) => void) =>
    sub('paia:agent-token', handler),
  onAgentApproval: (handler: (req: AgentApprovalRequest) => void) =>
    sub('paia:agent-approval', handler),

  // ── research ────────────────────────────────────────────
  researchStart: (opts: { threadId: string; question: string; model: string; depth?: number; maxSources?: number }): Promise<ResearchRun> =>
    ipcRenderer.invoke('paia:research-start', opts),
  researchList: (threadId?: string): Promise<ResearchRun[]> =>
    ipcRenderer.invoke('paia:research-list', threadId),
  onResearchRun: (handler: (run: ResearchRun) => void) => sub('paia:research-run', handler),
  onResearchToken: (handler: (p: { runId: string; token: string }) => void) =>
    sub('paia:research-token', handler),
  onResearchProgress: (handler: (p: ResearchProgress) => void) =>
    sub('paia:research-progress', handler),

  // ── memory ──────────────────────────────────────────────
  memoryList: (scope?: MemoryScope): Promise<MemoryEntry[]> =>
    ipcRenderer.invoke('paia:memory-list', scope),
  memoryAdd: (p: { scope: MemoryScope; text: string; tags?: string[]; pinned?: boolean }): Promise<{ ok: boolean; entry?: MemoryEntry; error?: string }> =>
    ipcRenderer.invoke('paia:memory-add', p),
  memoryRecall: (p: { query: string; topK?: number; scope?: MemoryScope }): Promise<{ ok: boolean; entries?: MemoryEntry[]; error?: string }> =>
    ipcRenderer.invoke('paia:memory-recall', p),
  memoryDelete: (id: string): Promise<void> => ipcRenderer.invoke('paia:memory-delete', id),

  // ── experience (self-learning) ──────────────────────────
  experienceFeedback: (p: { messageId: string; kind: 'up' | 'down' | 'clear'; note?: string }): Promise<{ ok: boolean; reflectionSavedMemoryIds?: string[]; error?: string }> =>
    ipcRenderer.invoke('paia:experience-feedback', p),
  experienceGetFeedback: (messageId: string): Promise<{ messageId: string; kind: 'up' | 'down'; note: string; createdAt: number } | null> =>
    ipcRenderer.invoke('paia:experience-get-feedback', messageId),
  experienceListReflections: (p?: { threadId?: string; limit?: number }): Promise<Array<{ id: string; threadId: string; lastMessageId: string | null; trigger: string; extractedMemoryIds: string[]; summary: string; createdAt: number }>> =>
    ipcRenderer.invoke('paia:experience-list-reflections', p),
  onReflectionSaved: (handler: (p: { threadId: string; summary: string; count: number }) => void) =>
    sub('paia:experience-reflection-saved', handler),

  // ── message actions ─────────────────────────────────────
  trimMessagesAfter: (p: { threadId: string; fromMessageId: string }): Promise<number> =>
    ipcRenderer.invoke('paia:trim-messages-after', p),
  forkThread: (p: { sourceThreadId: string; untilMessageId: string; title: string }): Promise<DbThread | null> =>
    ipcRenderer.invoke('paia:fork-thread', p),
  exportThreadMarkdown: (threadId: string): Promise<{ ok: true; path: string } | { ok: false; cancelled?: true; error?: string }> =>
    ipcRenderer.invoke('paia:export-thread-markdown', threadId),

  // ── artifacts / canvas ──────────────────────────────────
  artifactsList: (threadId?: string): Promise<Artifact[]> =>
    ipcRenderer.invoke('paia:artifacts-list', threadId),
  artifactsGet: (id: string): Promise<Artifact | null> =>
    ipcRenderer.invoke('paia:artifacts-get', id),
  artifactsCreate: (p: { threadId: string | null; title: string; kind: ArtifactKind; language: string; content: string }): Promise<Artifact> =>
    ipcRenderer.invoke('paia:artifacts-create', p),
  artifactsUpdate: (id: string, content: string): Promise<Artifact | null> =>
    ipcRenderer.invoke('paia:artifacts-update', { id, content }),
  artifactsDelete: (id: string): Promise<void> => ipcRenderer.invoke('paia:artifacts-delete', id),

  // ── connectors ──────────────────────────────────────────
  connectorsList: (): Promise<{ descriptor: ConnectorDescriptor; config: ConnectorConfig; status: ConnectorStatus }[]> =>
    ipcRenderer.invoke('paia:connectors-list'),
  connectorsSaveConfigs: (list: ConnectorConfig[]): Promise<ConnectorConfig[]> =>
    ipcRenderer.invoke('paia:connectors-save-configs', list),
  connectorsConnect: (id: ConnectorId): Promise<{ ok: boolean; status?: ConnectorStatus; error?: string }> =>
    ipcRenderer.invoke('paia:connectors-connect', id),
  connectorsDisconnect: (id: ConnectorId): Promise<ConnectorStatus> =>
    ipcRenderer.invoke('paia:connectors-disconnect', id),

  // ── scheduler ───────────────────────────────────────────
  schedulerList: (): Promise<ScheduledTask[]> => ipcRenderer.invoke('paia:scheduler-list'),
  schedulerSave: (task: Partial<ScheduledTask>): Promise<ScheduledTask> =>
    ipcRenderer.invoke('paia:scheduler-save', task),
  schedulerDelete: (id: string): Promise<void> => ipcRenderer.invoke('paia:scheduler-delete', id),
  schedulerRunNow: (id: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('paia:scheduler-run-now', id),

  // ── classroom ───────────────────────────────────────────
  classroomState: (): Promise<ClassroomState> => ipcRenderer.invoke('paia:classroom-state'),
  classroomDefaultPolicy: (): Promise<ClassroomPolicy> => ipcRenderer.invoke('paia:classroom-default-policy'),
  classroomStartTeacher: (p: { teacherName: string; policy: ClassroomPolicy; port?: number }): Promise<{ ok: boolean; session?: ClassroomSession; error?: string }> =>
    ipcRenderer.invoke('paia:classroom-start-teacher', p),
  classroomStopTeacher: (): Promise<{ ok: true }> => ipcRenderer.invoke('paia:classroom-stop-teacher'),
  classroomEndForAll: (): Promise<{ ok: true }> => ipcRenderer.invoke('paia:classroom-end-for-all'),
  classroomBroadcast: (text: string): Promise<{ ok: true }> =>
    ipcRenderer.invoke('paia:classroom-broadcast', { text }),
  classroomJoin: (p: { host: string; port: number; code: string; name: string }): Promise<{ ok: boolean; session?: ClassroomSession; error?: string }> =>
    ipcRenderer.invoke('paia:classroom-join', p),
  classroomLeave: (): Promise<{ ok: true }> => ipcRenderer.invoke('paia:classroom-leave'),
  onClassroomState: (handler: (state: ClassroomState) => void) => sub('paia:classroom-state', handler),
  onClassroomActivity: (handler: (activity: import('../shared/types').StudentActivity) => void) =>
    sub('paia:classroom-activity', handler),
  onClassroomMessage: (handler: (msg: { kind: 'end' | 'message'; text: string }) => void) =>
    sub('paia:classroom-message', handler),

  // ── enforcement ─────────────────────────────────────────
  enforcementState: (): Promise<EnforcementState> => ipcRenderer.invoke('paia:enforcement-state'),
  enforcementApply: (p: { blockedHostnames: string[]; disableTaskMgr?: boolean }): Promise<EnforcementState | { error: string }> =>
    ipcRenderer.invoke('paia:enforcement-apply', p),
  enforcementRelease: (): Promise<EnforcementState> => ipcRenderer.invoke('paia:enforcement-release'),

  // ── ambient ────────────────────────────────────────────
  ambientList: (): Promise<AmbientSuggestion[]> => ipcRenderer.invoke('paia:ambient-list'),
  ambientResolve: (id: string, resolution: 'accepted' | 'dismissed'): Promise<void> =>
    ipcRenderer.invoke('paia:ambient-resolve', { id, resolution }),
  ambientRestart: (): Promise<void> => ipcRenderer.invoke('paia:ambient-restart'),
  onAmbientSuggestion: (handler: (s: AmbientSuggestion) => void) =>
    sub('paia:ambient-suggestion', handler),

  // ── team ──────────────────────────────────────────────
  teamStart: (opts: { threadId: string; goal: string; model: string; members?: AgentTeamMember[]; maxRounds?: number }): Promise<AgentTeamRun> =>
    ipcRenderer.invoke('paia:team-start', opts),
  teamAbort: (runId: string): Promise<boolean> => ipcRenderer.invoke('paia:team-abort', runId),
  onTeamRun: (handler: (run: AgentTeamRun) => void) => sub('paia:team-run', handler),
  onTeamTurn: (handler: (turn: AgentTeamTurn) => void) => sub('paia:team-turn', handler),

  // ── plugins ────────────────────────────────────────────
  pluginsList: (): Promise<PluginState[]> => ipcRenderer.invoke('paia:plugins-list'),
  pluginsRescan: (): Promise<PluginState[]> => ipcRenderer.invoke('paia:plugins-rescan'),
  pluginsSetEnabled: (id: string, enabled: boolean): Promise<PluginState | null> =>
    ipcRenderer.invoke('paia:plugins-set-enabled', { id, enabled }),
  pluginsDir: (): Promise<string> => ipcRenderer.invoke('paia:plugins-dir'),

  // ── command palette ───────────────────────────────────
  paletteSuggest: (_q: string): CommandPaletteEntry[] => [],

  // ── browser agent ─────────────────────────────────────
  browserAgentVisible: (): Promise<boolean> => ipcRenderer.invoke('paia:browser-agent-visible'),
  browserAgentShow: (show: boolean): Promise<boolean> => ipcRenderer.invoke('paia:browser-agent-show', show),
  browserAgentClose: (): Promise<boolean> => ipcRenderer.invoke('paia:browser-agent-close'),
  browserAgentScreenshot: (): Promise<string> => ipcRenderer.invoke('paia:browser-agent-screenshot'),

  // ── media generation ──────────────────────────────────
  mediaListProviders: (): Promise<MediaProviderState[]> => ipcRenderer.invoke('paia:media-list-providers'),
  mediaLoadConfigs: (): Promise<MediaProviderConfig[]> => ipcRenderer.invoke('paia:media-load-configs'),
  mediaSaveConfigs: (list: MediaProviderConfig[]): Promise<MediaProviderConfig[]> =>
    ipcRenderer.invoke('paia:media-save-configs', list),
  mediaGenerate: (opts: MediaGenerateOptions): Promise<{ ok: boolean; result?: MediaGenerateResult; error?: string }> =>
    ipcRenderer.invoke('paia:media-generate', opts),

  // ── sync ──────────────────────────────────────────────
  syncSettings: (): Promise<SyncSettings> => ipcRenderer.invoke('paia:sync-settings'),
  syncSaveSettings: (next: SyncSettings): Promise<SyncSettings> =>
    ipcRenderer.invoke('paia:sync-save-settings', next),
  syncUnlock: (passphrase: string, saltBase64: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('paia:sync-unlock', { passphrase, saltBase64 }),
  syncLock: (): Promise<{ ok: true }> => ipcRenderer.invoke('paia:sync-lock'),
  syncIsUnlocked: (): Promise<boolean> => ipcRenderer.invoke('paia:sync-is-unlocked'),
  syncRun: (direction?: SyncDirection): Promise<SyncSummary> =>
    ipcRenderer.invoke('paia:sync-run', { direction }),
  onSyncProgress: (handler: (p: SyncProgress) => void) => sub('paia:sync-progress', handler),

  // ── companion (phone) ─────────────────────────────────
  companionState: (): Promise<CompanionState> => ipcRenderer.invoke('paia:companion-state'),
  companionStart: (port?: number): Promise<CompanionState> =>
    ipcRenderer.invoke('paia:companion-start', { port }),
  companionStop: (): Promise<CompanionState> => ipcRenderer.invoke('paia:companion-stop'),

  // ── remote browser ────────────────────────────────────
  remoteBrowserConfig: (): Promise<RemoteBrowserConfig> => ipcRenderer.invoke('paia:remote-browser-config'),
  remoteBrowserSaveConfig: (next: RemoteBrowserConfig): Promise<RemoteBrowserConfig> =>
    ipcRenderer.invoke('paia:remote-browser-save-config', next),
  remoteBrowserState: (): Promise<RemoteBrowserState> => ipcRenderer.invoke('paia:remote-browser-state'),
  remoteBrowserConnect: (): Promise<{ ok: boolean; error?: string; state: RemoteBrowserState }> =>
    ipcRenderer.invoke('paia:remote-browser-connect'),
  remoteBrowserDisconnect: (): Promise<RemoteBrowserState> =>
    ipcRenderer.invoke('paia:remote-browser-disconnect'),
  remoteBrowserStartLocal: (): Promise<{ ok: boolean; info?: { pid: number; port: number; binary: string }; error?: string; state: RemoteBrowserState }> =>
    ipcRenderer.invoke('paia:remote-browser-start-local'),
  remoteBrowserStopLocal: (): Promise<{ ok: boolean; stopped: boolean; state: RemoteBrowserState }> =>
    ipcRenderer.invoke('paia:remote-browser-stop-local'),
  remoteBrowserHasLocalChromium: (): Promise<{ available: boolean; path: string | null }> =>
    ipcRenderer.invoke('paia:remote-browser-has-local-chromium'),

  // ── local REST API server ─────────────────────────────
  apiServerState: (): Promise<ApiServerState> => ipcRenderer.invoke('paia:api-server-state'),
  apiServerStart: (port?: number): Promise<ApiServerState> => ipcRenderer.invoke('paia:api-server-start', { port }),
  apiServerStop: (): Promise<ApiServerState> => ipcRenderer.invoke('paia:api-server-stop'),
  apiServerRegenerateKey: (): Promise<ApiServerState> => ipcRenderer.invoke('paia:api-server-regenerate-key'),
  apiServerSetPinned: (pinned: boolean): Promise<ApiServerState> => ipcRenderer.invoke('paia:api-server-set-pinned', pinned),

  // ── closed beta + feedback ────────────────────────────
  betaState: (): Promise<BetaState> => ipcRenderer.invoke('paia:beta-state'),
  betaActivate: (raw: string): Promise<BetaState> => ipcRenderer.invoke('paia:beta-activate', raw),
  betaRevoke: (): Promise<BetaState> => ipcRenderer.invoke('paia:beta-revoke'),
  feedbackConfig: (): Promise<{ endpoint?: string; headers?: Record<string, string> }> =>
    ipcRenderer.invoke('paia:feedback-config'),
  feedbackSaveConfig: (cfg: { endpoint?: string; headers?: Record<string, string> }): Promise<typeof cfg> =>
    ipcRenderer.invoke('paia:feedback-save-config', cfg),
  feedbackSubmit: (p: { body: string; email?: string; rating?: number }): Promise<FeedbackSubmission> =>
    ipcRenderer.invoke('paia:feedback-submit', p),
  feedbackList: (): Promise<FeedbackSubmission[]> => ipcRenderer.invoke('paia:feedback-list'),
  feedbackClear: (): Promise<FeedbackSubmission[]> => ipcRenderer.invoke('paia:feedback-clear'),

  // ── autopilot (ambient → auto-action rules) ──────────
  autopilotList: (): Promise<AutopilotRule[]> => ipcRenderer.invoke('paia:autopilot-list'),
  autopilotFires: (): Promise<AutopilotFire[]> => ipcRenderer.invoke('paia:autopilot-fires'),
  autopilotSave: (rule: Partial<AutopilotRule> & { name: string }): Promise<AutopilotRule> =>
    ipcRenderer.invoke('paia:autopilot-save', rule),
  autopilotDelete: (id: string): Promise<void> => ipcRenderer.invoke('paia:autopilot-delete', id),
};

function sub<T>(channel: string, handler: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T) => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('paia', api);

export type PaiaApi = typeof api;
// Re-exports so the renderer can pull shared types from a single place.
export type {
  Settings,
  Persona,
  DbThread,
  DbMessage,
  DbAttachment,
  HotkeyMap,
  OllamaStatus,
};
