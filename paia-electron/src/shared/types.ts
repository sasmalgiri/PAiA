// Shared types between main, preload, and renderer.

// ─── redaction ──────────────────────────────────────────────────────

export interface RedactionResult {
  redacted: string;
  matchCount: number;
  categories: Record<string, number>;
}

// ─── ollama ────────────────────────────────────────────────────────

export interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
  digest?: string;
}

export interface OllamaStatus {
  reachable: boolean;
  baseUrl: string;
  models: OllamaModel[];
  error?: string;
}

export interface OllamaPullProgress {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
}

// ─── chat ──────────────────────────────────────────────────────────

export type Role = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: Role;
  content: string;
  images?: string[]; // base64 PNGs for multimodal models (llava etc.)
}

// ─── persisted thread / message records ───────────────────────────

export interface DbMessage {
  id: string;
  threadId: string;
  role: Role;
  content: string;
  createdAt: number;
  redactedCount: number;
  attachments: DbAttachment[];
}

export interface DbThread {
  id: string;
  title: string;
  personaId: string | null;
  model: string | null;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  pinned: boolean;
}

export interface DbAttachment {
  id: string;
  messageId: string;
  kind: 'image' | 'text' | 'pdf' | 'screen';
  filename: string;
  mimeType: string;
  sizeBytes: number;
  // Inline data for small attachments (text/PDF extracted text);
  // image data is stored as a base64 data URL.
  content: string;
}

// ─── personas ──────────────────────────────────────────────────────

export interface Persona {
  id: string;
  name: string;
  emoji: string;
  systemPrompt: string;
  isBuiltin: boolean;
}

// ─── settings ──────────────────────────────────────────────────────

export type InteractionMode = 'chat' | 'voice';
export type SttEngine = 'chromium' | 'whisper';
export type TtsEngine = 'system' | 'piper';
export type Theme = 'light' | 'dark' | 'system';

export type LocaleId = 'en' | 'es' | 'fr' | 'de' | 'hi' | 'ja' | 'zh';

export interface PiperVoice {
  id: string;
  name: string;
  language: string;
  quality: 'low' | 'medium' | 'high' | 'x_low';
  sizeBytes: number;
  modelUrl: string;
  configUrl: string;
}

export interface PiperStatus {
  binaryInstalled: boolean;
  binaryPath?: string;
  installedVoices: string[];
  cacheDir: string;
  error?: string;
}

export interface PiperDownloadProgress {
  stage: 'binary' | 'voice' | 'done' | 'error';
  current: number;
  total: number;
  message: string;
}

// ─── wake word ─────────────────────────────────────────────────────

export type WakeWordStatus = 'disabled' | 'no-key' | 'no-package' | 'running' | 'error';

export interface WakeWordState {
  status: WakeWordStatus;
  keyword: string;
  error?: string;
}

export interface HotkeyMap {
  showHide: string;
  capture: string;
  pushToTalk: string;
  quickActions: string;
}

export interface QuickAction {
  id: string;
  label: string;
  emoji: string;
  // The prompt template — `{text}` is replaced with the user's selected text.
  prompt: string;
}

export interface Settings {
  // chat
  mode: InteractionMode;
  model: string;
  personaId: string;
  currentThreadId: string | null;

  // voice
  sttEngine: SttEngine;
  ttsEngine: TtsEngine;
  piperVoice: string;
  voiceLang: string;
  ttsEnabled: boolean;
  wakeWordEnabled: boolean;
  wakeWordAccessKey: string;
  wakeWordKeyword: string;

  // appearance
  theme: Theme;
  locale: LocaleId;
  ballX: number | null;
  ballY: number | null;
  ballSize: number;

  // window behavior
  alwaysOnTop: boolean;
  startAtLogin: boolean;

  // hotkeys
  hotkeys: HotkeyMap;

  // privacy / cloud
  allowCloudModels: boolean;

  // context awareness
  includeActiveWindow: boolean;

  // telemetry (all opt-in, all off by default)
  crashReportsEnabled: boolean;
  crashReportsDsn: string;
  analyticsEnabled: boolean;
  analyticsEndpoint: string;

  // first-run
  onboarded: boolean;

  // updater
  autoUpdate: boolean;

  // agent
  agentAutonomy: AgentAutonomy;
  agentStepBudget: number;
  agentAllowShell: boolean;
  agentAllowFs: boolean;
  agentAllowedRoots: string[];

  // research
  researchDepth: number;
  researchMaxSources: number;

  // memory
  memoryEnabled: boolean;

  // ambient / proactive watcher
  ambient: AmbientSettings;

  // duplex voice mode
  voiceContinuous: boolean;

  // plugins
  pluginsEnabled: boolean;

  // OS-level mouse/keyboard automation (off by default — high-risk).
  // When true, the `desktop.*` tool family becomes available to the
  // Agent. Even with this on, each desktop tool still goes through the
  // autonomy gate (medium risk = prompt per call under 'ask-medium').
  osAutomationEnabled: boolean;

  // notifications
  notificationsEnabled: boolean;

  // one-time modals (bitfield of shown flags so we don't nag)
  trialExpiryAcknowledged: boolean;
}

// ─── screen capture / OCR ──────────────────────────────────────────

export interface CaptureSource {
  id: string;
  name: string;
  thumbnail: string; // data URL
}

export interface OcrResult {
  text: string;
  confidence: number;
  durationMs: number;
}

// ─── transcription ────────────────────────────────────────────────

export interface TranscribeResult {
  ok: boolean;
  text?: string;
  error?: string;
}

// ─── updater ──────────────────────────────────────────────────────

export interface UpdateInfo {
  available: boolean;
  version?: string;
  releaseNotes?: string;
  error?: string;
}

// ─── slash commands (renderer-only, declared here for reuse) ──────

export interface SlashCommand {
  name: string; // without the /
  description: string;
  // Returns the rewritten prompt to actually send. Null = no-op.
  rewrite: (input: string) => string | null;
}

// ─── RAG (knowledge collections) ──────────────────────────────────

export interface KnowledgeCollection {
  id: string;
  name: string;
  description: string;
  embeddingModel: string;
  createdAt: number;
  updatedAt: number;
  documentCount: number;
  chunkCount: number;
}

export interface KnowledgeDocument {
  id: string;
  collectionId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  chunkCount: number;
  createdAt: number;
}

export interface KnowledgeChunk {
  id: string;
  documentId: string;
  collectionId: string;
  ordinal: number;
  text: string;
  // Returned by search; not stored directly here.
  score?: number;
  filename?: string;
}

export interface RagSearchResult {
  chunks: KnowledgeChunk[];
  durationMs: number;
}

export interface RagIngestProgress {
  stage: 'extract' | 'chunk' | 'embed' | 'persist' | 'done' | 'error';
  current: number;
  total: number;
  message?: string;
}

// ─── MCP (Model Context Protocol) ──────────────────────────────────

export interface McpServerConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
  /**
   * Tools listed here will run without prompting the user. Empty list
   * means every call requires approval. Use sparingly.
   */
  autoApprove: string[];
}

export type McpServerStatus = 'stopped' | 'starting' | 'running' | 'error';

export interface McpServerState {
  config: McpServerConfig;
  status: McpServerStatus;
  error?: string;
  tools: McpToolInfo[];
}

export interface McpToolInfo {
  serverId: string;
  serverName: string;
  name: string;
  description: string;
  inputSchema: unknown;
}

export interface McpToolCallResult {
  ok: boolean;
  content?: string;
  error?: string;
  isStructured?: boolean;
}

export interface McpToolCallApprovalRequest {
  requestId: string;
  serverId: string;
  serverName: string;
  toolName: string;
  args: unknown;
}

// ─── LLM providers (cloud + local) ─────────────────────────────────

export type ProviderId = 'ollama' | 'openai' | 'anthropic' | 'openai-compatible';

export interface ProviderConfig {
  id: ProviderId;
  enabled: boolean;
  apiKey?: string;
  baseUrl?: string;
  // Allow-list of model names for this provider. Empty = use whatever
  // the provider's list endpoint returns (Ollama) or all the user types in.
  models?: string[];
}

export interface ProviderState {
  id: ProviderId;
  name: string;
  reachable: boolean;
  models: string[];
  isCloud: boolean;
  error?: string;
}

/**
 * Fully-qualified model identifier — `provider:model`. The chat dropdown
 * lists these so we can route per-call regardless of which provider
 * served the model.
 */
export type QualifiedModel = string;

// ─── licensing ─────────────────────────────────────────────────────

export type LicenseTier = 'free' | 'pro' | 'team';

export interface LicensePayload {
  email: string;
  name: string;
  tier: LicenseTier;
  issuedAt: number; // unix ms
  expiresAt: number | null; // null = perpetual
  // Optional machine-fingerprint hash; ignored if absent.
  machineHash?: string;
}

export interface SignedLicense {
  payload: LicensePayload;
  signatureBase64: string;
}

export interface LicenseStatus {
  // Final answer for the renderer: which features should be unlocked.
  effectiveTier: LicenseTier;
  // Source of the answer.
  source: 'license' | 'trial' | 'free';
  // Trial info, if applicable.
  trialStartedAt?: number;
  trialEndsAt?: number;
  trialDaysLeft?: number;
  // License info, if loaded.
  license?: LicensePayload;
  // Why the license was rejected, if any.
  reason?: string;
}

/**
 * Names of features that can be gated. Used by isFeatureEnabled() in the
 * renderer to show/hide UI based on the current effective tier.
 */
// ─── closed beta ──────────────────────────────────────────────────

export interface BetaInvitePayload {
  kind: 'beta-invite';
  email: string;
  name: string;
  issuedAt: number;
  expiresAt: number | null;
  cohort?: string;
}

export interface SignedBetaInvite {
  payload: BetaInvitePayload;
  signatureBase64: string;
}

export interface TrialExtensionPayload {
  kind: 'trial-extension';
  email: string;
  extendDays: number;
  reason: string;
  issuedAt: number;
  /** Unique id used as a nonce so the same extension can't be redeemed twice. */
  nonce: string;
}

export interface SignedTrialExtension {
  payload: TrialExtensionPayload;
  signatureBase64: string;
}

export interface BetaState {
  enabled: boolean;
  invite?: BetaInvitePayload;
  enabledAt?: number;
  reason?: string;
}

export interface FeedbackSubmission {
  id: string;
  at: number;
  body: string;
  email?: string;
  rating?: number; // 1..5
  sent: boolean;
  endpoint?: string;
}

export type FeatureFlag =
  | 'rag'
  | 'screen-region'
  | 'mcp'
  | 'cloud-providers'
  | 'voice-whisper'
  | 'multi-thread'
  | 'personas-custom'
  | 'web-search'
  | 'quick-actions'
  | 'active-window'
  | 'agent'
  | 'deep-research'
  | 'canvas'
  | 'memory'
  | 'connectors'
  | 'scheduler'
  | 'classroom'
  | 'enforcement'
  | 'ambient'
  | 'team'
  | 'plugins'
  | 'beta';

// ─── web search ────────────────────────────────────────────────────

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResponse {
  query: string;
  results: WebSearchResult[];
  redactedCount: number;
  durationMs: number;
  error?: string;
}

// ─── active window awareness ───────────────────────────────────────

export interface ActiveWindowInfo {
  title: string;
  appName: string;
  processId?: number;
  url?: string; // browsers only, when we can detect it
  capturedAt: number;
}

// ─── agent orchestrator ────────────────────────────────────────────

/**
 * A single entry in the tool registry. `execute` must return quickly —
 * tools may not spawn long-running child processes without streaming
 * progress back to the renderer.
 *
 * Every call is routed through the approval gate unless the tool is
 * marked safe (read-only web search, OCR) or the user has pre-approved
 * the run via its autonomy level.
 */
export interface ToolDefinition {
  name: string;
  /** Human-readable description shown in approval prompts. */
  description: string;
  /** JSON Schema for the arguments (also fed to the LLM for tool use). */
  inputSchema: unknown;
  /** Risk tier — governs whether auto-approve can apply. */
  risk: 'safe' | 'low' | 'medium' | 'high';
  /** Tag surfaced in the UI (so users can filter/pre-approve by family). */
  category: 'web' | 'fs' | 'shell' | 'screen' | 'clipboard' | 'window' | 'memory' | 'rag' | 'connector' | 'artifact' | 'mcp' | 'desktop' | 'cad-sim';
}

export type AgentAutonomy = 'manual' | 'assisted' | 'autonomous';

export interface AgentStepToolCall {
  name: string;
  args: Record<string, unknown>;
  result?: string;
  error?: string;
  approved: boolean;
  durationMs: number;
}

export type AgentStepKind = 'plan' | 'thought' | 'tool' | 'final' | 'error';

export interface AgentStep {
  id: string;
  runId: string;
  ordinal: number;
  kind: AgentStepKind;
  content: string;
  tool?: AgentStepToolCall;
  createdAt: number;
}

export type AgentRunStatus = 'running' | 'awaiting-approval' | 'done' | 'error' | 'aborted';

export interface AgentRun {
  id: string;
  threadId: string;
  goal: string;
  model: string;
  autonomy: AgentAutonomy;
  status: AgentRunStatus;
  stepBudget: number;
  startedAt: number;
  endedAt?: number;
  summary?: string;
}

export interface AgentApprovalRequest {
  requestId: string;
  runId: string;
  tool: string;
  description: string;
  args: Record<string, unknown>;
  risk: ToolDefinition['risk'];
}

// ─── deep research ────────────────────────────────────────────────

export type ResearchStage =
  | 'planning'
  | 'searching'
  | 'fetching'
  | 'synthesizing'
  | 'done'
  | 'error';

export interface ResearchSource {
  n: number;
  title: string;
  url: string;
  snippet: string;
  fetchedChars?: number;
}

export interface ResearchRun {
  id: string;
  threadId: string;
  question: string;
  model: string;
  status: ResearchStage;
  subQuestions: string[];
  sources: ResearchSource[];
  report?: string;
  startedAt: number;
  endedAt?: number;
  error?: string;
}

export interface ResearchProgress {
  runId: string;
  stage: ResearchStage;
  current: number;
  total: number;
  message: string;
}

// ─── artifacts / canvas ───────────────────────────────────────────

export type ArtifactKind = 'code' | 'markdown' | 'html' | 'svg' | 'json' | 'whiteboard';

export interface Artifact {
  id: string;
  threadId: string | null;
  title: string;
  kind: ArtifactKind;
  language: string; // hint for syntax highlighting (ts, py, md …)
  content: string;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface ArtifactUpdate {
  id: string;
  version: number;
  content: string;
}

// ─── cross-session memory ─────────────────────────────────────────

export type MemoryScope = 'user' | 'preference' | 'fact' | 'episode';

export interface MemoryEntry {
  id: string;
  scope: MemoryScope;
  text: string;
  tags: string[];
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  /** Optional vector embedding; populated lazily for episodic memory. */
  embedding?: number[];
}

// ─── connectors ───────────────────────────────────────────────────

export type ConnectorId = 'gmail' | 'calendar' | 'drive' | 'github' | 'slack';

export interface ConnectorDescriptor {
  id: ConnectorId;
  name: string;
  emoji: string;
  description: string;
  /** The OAuth scopes this integration will request. */
  scopes: string[];
  /** Whether a client ID is bundled or must be user-supplied. */
  requiresClientId: boolean;
}

export interface ConnectorConfig {
  id: ConnectorId;
  enabled: boolean;
  clientId?: string;
  clientSecret?: string;
  /** Optional override (for enterprise Slack, self-hosted GitHub, etc.). */
  baseUrl?: string;
}

export interface ConnectorStatus {
  id: ConnectorId;
  connected: boolean;
  account?: string;
  scopes?: string[];
  error?: string;
  expiresAt?: number;
}

// ─── scheduler ────────────────────────────────────────────────────

export type ScheduleTrigger =
  | { kind: 'cron'; expression: string }
  | { kind: 'interval'; everyMinutes: number }
  | { kind: 'once'; at: number };

export type ScheduleAction =
  | { kind: 'agent'; goal: string; autonomy: AgentAutonomy }
  | { kind: 'research'; question: string }
  | { kind: 'prompt'; text: string };

export interface ScheduledTask {
  id: string;
  name: string;
  enabled: boolean;
  trigger: ScheduleTrigger;
  action: ScheduleAction;
  model: string;
  createdAt: number;
  lastRunAt?: number;
  lastStatus?: 'ok' | 'error';
  lastError?: string;
  nextRunAt?: number;
}

// ─── classroom / lab control ──────────────────────────────────────

export type ClassroomRole = 'off' | 'teacher' | 'student';

/**
 * The rules a teacher pushes to every student when starting a session.
 * Students' local PAiA enforces what it can (tools, slash commands,
 * panel lock, cloud providers). What it cannot truly prevent (quitting
 * PAiA, switching to other apps) it DETECTS and reports.
 */
export interface ClassroomPolicy {
  /** Short name shown on the lock screen. */
  title: string;
  /** Session length in minutes. 0 = open-ended (teacher ends manually). */
  durationMinutes: number;
  /** Process/executable names considered allowed when in focus. Case-insensitive substring match on activeWindow.appName. */
  allowedApps: string[];
  /** URL allow-list — substring match against activeWindow.url (browsers only). Empty = any URL inside an allowed browser app. */
  allowedUrls: string[];
  /** URLs to actively flag as violations even inside allowed apps. */
  blockedUrls: string[];
  /** Whether the student's PAiA is allowed to run Agent mode. */
  allowAgent: boolean;
  /** Whether shell.exec is enabled for the student's agent. */
  allowShell: boolean;
  /** Whether fs tools are enabled. */
  allowFs: boolean;
  /** Whether the student can use web search / web fetch. */
  allowWebTools: boolean;
  /** Whether cloud providers (OpenAI/Anthropic) can be called. */
  allowCloudProviders: boolean;
  /** If true, the panel locks always-on-top and the close button sends to tray instead of hiding. */
  lockPanel: boolean;
  /** How often the student's PAiA reports activity back to the teacher (seconds). */
  heartbeatSeconds: number;
}

export interface ClassroomSession {
  sessionId: string;
  /** Six-character uppercase join code — shared with students. */
  code: string;
  title: string;
  teacherName: string;
  /** LAN host/port the teacher's server is listening on. */
  host: string;
  port: number;
  startedAt: number;
  endsAt?: number; // undefined if durationMinutes === 0
  policy: ClassroomPolicy;
}

export interface StudentInfo {
  studentId: string;
  name: string;
  machine: string;
  joinedAt: number;
  lastSeenAt: number;
  online: boolean;
  violations: number;
}

export type StudentActivityKind =
  | 'joined'
  | 'left'
  | 'heartbeat'
  | 'focus-ok'
  | 'focus-off'
  | 'app-switch'
  | 'url-visit'
  | 'tool-denied'
  | 'violation'
  | 'message';

export interface StudentActivity {
  id: string;
  studentId: string;
  studentName: string;
  at: number;
  kind: StudentActivityKind;
  detail: string;
}

export interface ClassroomStudentState {
  role: 'student';
  session: ClassroomSession;
  studentId: string;
  name: string;
  connected: boolean;
  lastError?: string;
  violations: number;
  /** Current activeWindow — shown on the lock screen so the student knows why they're flagged. */
  focus?: { title: string; app: string; onTask: boolean };
}

export interface ClassroomTeacherState {
  role: 'teacher';
  session: ClassroomSession;
  students: StudentInfo[];
  recentActivity: StudentActivity[];
}

export type ClassroomState =
  | { role: 'off' }
  | ClassroomStudentState
  | ClassroomTeacherState;

// ─── OS-level enforcement ─────────────────────────────────────────

export type EnforcementPlatform = 'win32' | 'darwin' | 'linux';

export interface EnforcementCapability {
  /** Human label shown in the UI. */
  label: string;
  /** What the underlying script does. */
  description: string;
  /** Whether this capability needs elevation (sudo / UAC). */
  requiresAdmin: boolean;
  /** Whether we currently have the script wired for the detected OS. */
  supported: boolean;
}

export interface EnforcementState {
  platform: EnforcementPlatform;
  active: boolean;
  capabilities: EnforcementCapability[];
  /** Last script output (stdout+stderr) for troubleshooting. */
  lastLog?: string;
  /** Timestamp at which lock was last applied. */
  activatedAt?: number;
}

// ─── Ambient / proactive watcher ──────────────────────────────────

export type AmbientTriggerKind =
  | 'error-on-screen'
  | 'question-in-clipboard'
  | 'long-idle-on-file'
  | 'url-in-clipboard'
  | 'custom';

export interface AmbientSuggestion {
  id: string;
  kind: AmbientTriggerKind;
  title: string;
  detail: string;
  /** The slash command / agent goal to fire if the user accepts. */
  actionPrompt: string;
  actionKind: 'chat' | 'agent' | 'research' | 'canvas';
  createdAt: number;
  /** If the user dismissed or accepted, when. */
  resolvedAt?: number;
  resolution?: 'accepted' | 'dismissed' | 'expired';
}

export interface AmbientSettings {
  enabled: boolean;
  watchScreen: boolean;
  watchClipboard: boolean;
  watchActiveWindow: boolean;
  /** How often to sample (seconds). */
  pollSeconds: number;
  /** Minimum seconds between two suggestions of the same kind. */
  cooldownSeconds: number;
}

// ─── autopilot (pre-approved ambient → action rules) ──────────────
//
// An autopilot rule turns a specific class of ambient suggestion into an
// automatic action, with hard guardrails. Users pre-approve the pattern
// once — the app keeps firing silently inside their envelope instead of
// asking every time.

export type AutopilotActionKind = 'chat' | 'agent' | 'research' | 'canvas';

export interface AutopilotMatch {
  /** Which ambient trigger kind to match (e.g. 'error-on-screen'). */
  triggerKind: AmbientTriggerKind;
  /**
   * Optional regex (JS flags) the suggestion's detail must match for the
   * rule to fire. Empty string = any detail. Anchored at the caller's
   * discretion; we compile with defaults, not global.
   */
  detailPattern?: string;
}

export interface AutopilotAction {
  kind: AutopilotActionKind;
  /**
   * Prompt template. `{{detail}}` / `{{title}}` are replaced with the
   * matching suggestion's fields.
   */
  prompt: string;
}

export interface AutopilotGuardrails {
  /** Max fires per UTC day. 0 = uncapped. */
  dailyCap: number;
  /** Minimum seconds between consecutive fires. */
  cooldownSeconds: number;
  /** Hour-of-day window in local time (inclusive). Leave null for 24/7. */
  allowedHourStart: number | null;
  allowedHourEnd: number | null;
}

export interface AutopilotRule {
  id: string;
  name: string;
  enabled: boolean;
  match: AutopilotMatch;
  action: AutopilotAction;
  guardrails: AutopilotGuardrails;
  createdAt: number;
}

export interface AutopilotFire {
  id: string;
  ruleId: string;
  ruleName: string;
  suggestionId: string;
  firedAt: number;
  ok: boolean;
  error?: string;
}

// ─── Multi-agent team ─────────────────────────────────────────────

export type AgentTeamRole = 'planner' | 'researcher' | 'coder' | 'reviewer' | 'writer';

export interface AgentTeamMember {
  role: AgentTeamRole;
  /** Each role can pick its own model (e.g. strong for planner, fast for researcher). */
  model: string;
  /** Additional system prompt that gets appended to the role's default. */
  extraSystemPrompt?: string;
}

export interface AgentTeamTurn {
  id: string;
  teamRunId: string;
  ordinal: number;
  role: AgentTeamRole;
  /** Free-form text the role produced. */
  content: string;
  /** If the role triggered a sub-agent or tool call, its id for drill-down. */
  childRunId?: string;
  createdAt: number;
}

export type AgentTeamStatus = 'running' | 'awaiting-approval' | 'done' | 'error' | 'aborted';

export interface AgentTeamRun {
  id: string;
  threadId: string;
  goal: string;
  members: AgentTeamMember[];
  status: AgentTeamStatus;
  maxRounds: number;
  startedAt: number;
  endedAt?: number;
  summary?: string;
}

// ─── Plugins ──────────────────────────────────────────────────────

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  /** Entry file (relative to manifest); loaded in the main process. */
  main: string;
  /** Declarations the plugin claims to register (surfaced in the UI for permissions). */
  contributes: {
    tools?: string[];
    slashCommands?: string[];
    ambientTriggers?: string[];
  };
}

export interface PluginState {
  manifest: PluginManifest;
  path: string;
  enabled: boolean;
  loaded: boolean;
  error?: string;
}

// ─── Command palette ──────────────────────────────────────────────

export interface CommandPaletteEntry {
  id: string;
  kind: 'thread' | 'artifact' | 'memory' | 'slash' | 'action' | 'setting';
  title: string;
  subtitle?: string;
  /** Action identifier the renderer dispatches on Enter. Interpretation is kind-specific. */
  payload: string;
}

// ─── media generation ─────────────────────────────────────────────

export type MediaProviderId =
  | 'openai'
  | 'stability'
  | 'replicate'
  | 'fal'
  | 'comfyui'
  | 'automatic1111';

export type MediaKind = 'image' | 'video';

export interface MediaProviderConfig {
  id: MediaProviderId;
  enabled: boolean;
  apiKey?: string;
  /** Base URL for self-hosted backends (ComfyUI, A1111, custom Replicate-compat). */
  baseUrl?: string;
  /** Default model for this provider. */
  defaultModel?: string;
}

export interface MediaGenerateOptions {
  provider: MediaProviderId;
  kind: MediaKind;
  prompt: string;
  negativePrompt?: string;
  /** Model identifier; provider-specific. */
  model?: string;
  width?: number;
  height?: number;
  /** 1–4 typically. */
  count?: number;
  /** Seed if deterministic. */
  seed?: number;
}

export interface MediaGenerateResult {
  provider: MediaProviderId;
  kind: MediaKind;
  items: { dataUrl?: string; url?: string; mimeType: string }[];
  durationMs: number;
}

export interface MediaProviderState {
  id: MediaProviderId;
  name: string;
  supports: MediaKind[];
  configured: boolean;
  /** Human label for why this provider is or isn't ready. */
  status: string;
}

// ─── E2E encrypted cloud sync ─────────────────────────────────────

export type SyncBackendKind = 'folder' | 'webdav' | 's3';

export interface SyncBackendConfig {
  kind: SyncBackendKind;
  /**
   * For 'folder': absolute filesystem path.
   * For 'webdav': https://host/dav/path.
   * For 's3': base endpoint URL (e.g. https://s3.amazonaws.com or
   *            https://<account>.r2.cloudflarestorage.com).
   */
  endpoint: string;
  /** Optional auth (WebDAV). */
  username?: string;
  password?: string;
  /** S3 region — required for SigV4. */
  region?: string;
  /** S3 bucket name. */
  bucket?: string;
  /** Optional prefix inside the bucket so one bucket can host many users. */
  prefix?: string;
  /** S3 access key id. */
  accessKeyId?: string;
  /** S3 secret access key. */
  secretAccessKey?: string;
  /**
   * Deterministic-random salt saved once per install so re-deriving the key
   * from the same passphrase produces the same key across sessions. Stored
   * unencrypted in sync-config.json — the salt by itself reveals nothing
   * without the passphrase.
   */
  kdfSaltBase64: string;
}

export interface SyncSettings {
  enabled: boolean;
  backend: SyncBackendConfig | null;
  /** Which kinds of data to sync. */
  include: {
    threads: boolean;
    messages: boolean;
    memory: boolean;
    artifacts: boolean;
    /** Binary attachments (images, PDFs). Chunked + streaming — can be big. */
    attachments: boolean;
    settings: boolean;
  };
  /** Chunk size in bytes for attachment streaming. 1 MB is a sane default. */
  attachmentChunkBytes?: number;
  /** Skip attachments larger than this (bytes). 0 = no limit. */
  attachmentMaxBytes?: number;
  lastSyncAt?: number;
  lastStatus?: 'ok' | 'error';
  lastError?: string;
}

export type SyncDirection = 'push' | 'pull' | 'both';

export interface SyncProgress {
  stage: 'scan' | 'encrypt' | 'upload' | 'download' | 'decrypt' | 'merge' | 'done' | 'error';
  current: number;
  total: number;
  message: string;
}

export interface SyncSummary {
  ok: boolean;
  uploaded: number;
  downloaded: number;
  skipped: number;
  durationMs: number;
  error?: string;
}

// ─── mobile companion ─────────────────────────────────────────────

export interface CompanionState {
  running: boolean;
  host: string;
  port: number;
  /** Bearer token the paired phone uses for API calls. */
  pairToken?: string;
  /** Pairing URL embedded into the QR code. */
  pairUrl?: string;
  error?: string;
}

// ─── local REST API server (power users, Raycast, scripts) ────────

export interface ApiServerState {
  running: boolean;
  port: number;
  apiKey?: string;
  /** Last fatal error if the server crashed. */
  error?: string;
}

// ─── remote browser agent (Chrome DevTools Protocol) ──────────────

export interface RemoteBrowserConfig {
  enabled: boolean;
  /** Full URL to the Chrome DevTools Protocol endpoint, e.g. http://10.0.0.5:9222 */
  endpoint: string;
  /** Optional basic-auth token prepended as a query string (?token=…) on the discover request. */
  token?: string;
}

export interface RemoteBrowserState {
  connected: boolean;
  endpoint: string;
  /** URL currently loaded in the attached target. */
  currentUrl?: string;
  /** Last error, if any. */
  error?: string;
}
