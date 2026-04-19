// English — canonical source of truth. Every other locale translates
// this exact key set; missing keys fall back to English at runtime.
//
// Convention: dotted-scope keys (`panel.close`) so grepping for a
// specific surface finds every string on it. Only user-visible UI
// text goes here — error messages thrown deep in the main process
// are kept in English for v1; localising them needs a second round.

export const en = {
  // ── generic / reused ─────────────────────────────────────
  common: {
    cancel: 'Cancel',
    save: 'Save',
    delete: 'Delete',
    edit: 'Edit',
    copy: 'Copy',
    close: 'Close',
    back: 'Back',
    yes: 'Yes',
    no: 'No',
    ok: 'OK',
    loading: 'Loading…',
    error: 'Error',
    retry: 'Retry',
    enable: 'Enable',
    disable: 'Disable',
    connect: 'Connect',
    disconnect: 'Disconnect',
  },

  // ── ball / panel header ──────────────────────────────────
  panel: {
    title: 'PAiA',
    close: 'Close',
    settings: 'Settings',
    newThread: 'New conversation',
    captureFullScreen: 'Capture full screen',
    captureRegion: 'Capture region',
    canvas: 'Canvas / artifacts',
    attachCollection: 'Attach knowledge collection',
  },

  // ── composer ─────────────────────────────────────────────
  composer: {
    placeholder: 'Ask PAiA… (try / for commands, drop or paste images)',
    send: 'Send',
    attach: 'Attach files',
    micStart: 'Start listening',
    micStop: 'Stop listening',
    hintRedacted: 'PII redacted locally before send.',
    hintListening: 'Listening… click mic to stop.',
    hintDuplex: 'Duplex voice active — speak any time.',
    hintWhisperContinuous: 'Continuous voice (Whisper) — speak; pause to send.',
    hintTranscribing: 'Transcribing…',
    visionWarning: "Selected model doesn't look like a vision model. For images, try llava, bakllava, moondream, or llama3.2-vision.",
  },

  // ── empty states ─────────────────────────────────────────
  empty: {
    howCanIHelp: 'How can I help?',
    hint: 'Type a message, drop a file, capture your screen, or click 🎙 to talk.',
  },

  // ── settings tabs ────────────────────────────────────────
  settings: {
    title: 'Settings',
    tabs: {
      general: 'general',
      models: 'models',
      personas: 'personas',
      knowledge: 'knowledge',
      tools: 'tools',
      agent: 'agent',
      memory: 'memory',
      connectors: 'connectors',
      schedule: 'schedule',
      classroom: 'classroom',
      enforcement: 'enforcement',
      ambient: 'ambient',
      plugins: 'plugins',
      media: 'media',
      sync: 'sync',
      companion: 'companion',
      'remote-browser': 'remote browser',
      voice: 'voice',
      hotkeys: 'hotkeys',
      privacy: 'privacy',
      license: 'license',
      about: 'about',
    },
    general: {
      theme: 'Theme',
      themeSystem: 'System',
      themeDark: 'Dark',
      themeLight: 'Light',
      language: 'Language',
      alwaysOnTop: 'Stay on top of all windows',
      startAtLogin: 'Start at login',
    },
  },

  // ── classroom ────────────────────────────────────────────
  classroom: {
    title: 'Classroom',
    teacher: 'Teacher',
    student: 'Student',
    startSession: 'Start session',
    joinSession: 'Join',
    endForAll: 'End for all',
    broadcast: 'Broadcast a message to all students…',
    onTask: 'On task',
    offTask: 'Off task — your teacher will see this',
    leaveSession: 'Leave session',
    leaveConfirm: 'Leave this session? Your teacher will be notified.',
  },

  // ── agent ────────────────────────────────────────────────
  agent: {
    thinking: 'Thinking…',
    abort: 'Abort',
    approveTitle: 'Approve tool call?',
    approve: 'Approve',
    deny: 'Deny',
    result: 'Result',
  },

  // ── research ────────────────────────────────────────────
  research: {
    plan: 'Plan',
    sources: 'Sources',
    report: 'Report',
    writing: 'Writing…',
  },

  // ── canvas ───────────────────────────────────────────────
  canvas: {
    title: 'Canvas',
    newArtifact: '+ New',
    noArtifacts: 'No artifacts yet.',
    selectOrCreate: 'Select an artifact or create a new one.',
  },

  // ── memory ───────────────────────────────────────────────
  memory: {
    addPlaceholder: 'Add a memory…',
    scopeFact: 'Fact',
    scopePreference: 'Preference',
    scopeUser: 'User',
    scopeEpisode: 'Episode',
    noEntries: 'No memories yet.',
    forgetConfirm: 'Forget this memory?',
  },

  // ── ambient toast ────────────────────────────────────────
  ambient: {
    errorTitle: 'Looks like an error',
    questionTitle: 'Answer this?',
    urlTitle: 'Summarize this URL?',
    idleTitle: 'Stuck on something?',
  },

  // ── onboarding ───────────────────────────────────────────
  onboarding: {
    welcome: 'Welcome to PAiA',
    tagline: 'Your privacy-first AI assistant.',
    next: 'Next',
    done: 'Done',
  },
} as const;

export type Strings = typeof en;
