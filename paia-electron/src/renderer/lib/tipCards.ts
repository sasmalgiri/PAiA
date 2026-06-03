// Tip-card registry.
//
// Each tip is shown at most once per user (dismissal persists to
// settings.tipsShown). New users see them in order of priority as the
// matching context appears. Existing users (settings.onboarded === true
// when this module was added) have all tip IDs pre-populated into
// tipsShown so they don't get nagged about features they already use.
//
// To add a new tip:
//   1. Add an entry to TIP_REGISTRY
//   2. Add data-tip-anchor="<id>" to the UI element it points at
//   3. The TipCoach will surface it next time `condition()` is true
//
// Keep the seed set small and high-signal. Five tips = five wow moments;
// twenty tips = nag screens.

export type TipTrigger =
  | { kind: 'view-enters'; view: 'panel' | 'settings' }
  | { kind: 'message-count-at-least'; count: number }
  | { kind: 'has-attachment' }
  | { kind: 'persona-count-at-least'; count: number };

export interface TipDefinition {
  id: string;
  /** Element to point at (must have data-tip-anchor="<this>" attribute). */
  anchorId: string;
  /** Priority — higher wins when multiple tips qualify. */
  priority: number;
  title: string;
  body: string;
  /** Optional "show me" / "open settings" / etc. action. */
  action?: {
    label: string;
    kind: 'open-settings' | 'open-palette' | 'dismiss';
  };
  /** When this tip should become eligible. All triggers must hold. */
  triggers: TipTrigger[];
  /** Auto-dismiss after N ms. 0 / undefined = manual only. */
  autoDismissMs?: number;
}

export const TIP_REGISTRY: TipDefinition[] = [
  {
    id: 'command-palette',
    anchorId: 'panel-settings-btn',
    priority: 90,
    title: 'Tip: Command palette',
    body: 'Press Ctrl+K (⌘K on Mac) to fuzzy-search threads, artifacts, memory, and every action — without hunting through menus.',
    action: { label: 'Try it', kind: 'open-palette' },
    triggers: [{ kind: 'view-enters', view: 'panel' }, { kind: 'message-count-at-least', count: 1 }],
  },
  {
    id: 'screen-capture',
    anchorId: 'composer-capture-btn',
    priority: 80,
    title: 'Tip: PAiA can see your screen',
    body: 'Click the camera or press Ctrl+Alt+S to send a screenshot. Pair with a vision-capable model to ask "what is this UI doing?"',
    triggers: [{ kind: 'view-enters', view: 'panel' }, { kind: 'message-count-at-least', count: 2 }],
  },
  {
    id: 'smart-router',
    anchorId: 'panel-persona-btn',
    priority: 70,
    title: 'Tip: 56 experts on call',
    body: 'Settings → Personas → Smart Router lets PAiA auto-pick the best persona (or 4 in parallel for hard queries). Stops you from typing into the wrong specialist.',
    action: { label: 'Open Settings', kind: 'open-settings' },
    triggers: [{ kind: 'view-enters', view: 'panel' }, { kind: 'persona-count-at-least', count: 10 }, { kind: 'message-count-at-least', count: 3 }],
  },
  {
    id: 'longread',
    anchorId: 'composer-attach-btn',
    priority: 75,
    title: 'Tip: Long-doc map-reduce',
    body: 'Attach a long PDF and type /longread <question>. PAiA splits it into chunks, processes them in parallel, and synthesises an answer with chunk-level provenance.',
    triggers: [{ kind: 'view-enters', view: 'panel' }, { kind: 'has-attachment' }],
  },
  {
    id: 'settings-search',
    anchorId: 'settings-search-input',
    priority: 60,
    title: 'Tip: Search settings',
    body: 'The 24 settings tabs are grouped, but the fastest way is to type a keyword (e.g. "voice", "license", "cron") in the search box at the top.',
    triggers: [{ kind: 'view-enters', view: 'settings' }],
  },
];

export interface TipContext {
  view: 'panel' | 'settings' | 'ball' | 'onboarding' | 'quick';
  messageCount: number;
  hasAttachment: boolean;
  personaCount: number;
}

function triggerMatches(t: TipTrigger, ctx: TipContext): boolean {
  switch (t.kind) {
    case 'view-enters':
      return ctx.view === t.view;
    case 'message-count-at-least':
      return ctx.messageCount >= t.count;
    case 'has-attachment':
      return ctx.hasAttachment;
    case 'persona-count-at-least':
      return ctx.personaCount >= t.count;
  }
}

/**
 * Picks the next tip to show, or null if none qualify.
 * Filters out already-shown tips. When multiple tips qualify, the
 * highest-priority one wins.
 */
export function pickNextTip(ctx: TipContext, shown: string[]): TipDefinition | null {
  const shownSet = new Set(shown);
  const candidates = TIP_REGISTRY
    .filter((t) => !shownSet.has(t.id))
    .filter((t) => t.triggers.every((trg) => triggerMatches(trg, ctx)))
    .sort((a, b) => b.priority - a.priority);
  return candidates[0] ?? null;
}

/** Returns every tip ID. Used to pre-populate tipsShown for existing users. */
export function allTipIds(): string[] {
  return TIP_REGISTRY.map((t) => t.id);
}
