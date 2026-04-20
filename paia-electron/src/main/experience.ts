// Self-learning from experience.
//
// After each assistant turn completes, this module asynchronously reviews
// the recent exchange and extracts durable lessons into the existing
// cross-session memory. Thumbs-down feedback triggers an immediate
// "what went wrong here" extraction with higher priority so the mistake
// is recorded as a preference, not just an episode.
//
// Design principles:
//   - Never block the chat response. Reflection runs on a trailing timer.
//   - Never surprise the user. Each reflection writes a `reflections` row
//     so Settings → Memory can show "here's what PAiA learned from that
//     conversation" — fully auditable and deletable.
//   - Privacy: reflection uses the same local model the user is chatting
//     with. If only a cloud model is configured, we skip reflection
//     rather than silently exfiltrate the conversation.
//   - Dedup: before saving, we check for near-duplicate memories so a
//     repeated preference doesn't spam the store.
//
// Two triggers:
//   1. Debounced post-turn (20 s after the last assistant message in a
//      thread). Low priority; pulls at most 6 recent turns.
//   2. Explicit feedback (thumbs up/down). High priority; runs immediately
//      and tags the resulting memory with 'feedback'.

import { randomUUID } from 'crypto';
import type { DbMessage, MemoryEntry, MemoryScope } from '../shared/types';
import * as db from './db';
import * as memorySvc from './memory';
import * as settingsStore from './settings';
import { logger } from './logger';
import * as providers from './providers';

const DEBOUNCE_MS = 20_000;
const WINDOW_MESSAGES = 6;
const MIN_GAP_BETWEEN_REFLECTIONS_MS = 60_000; // per-thread rate limit

const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const lastReflectionAt = new Map<string, number>();

interface ExtractedLesson {
  scope: MemoryScope;
  text: string;
  tags?: string[];
}

function localChatModel(): string | null {
  // Pick the local (Ollama) model for reflection. If the user is running
  // on cloud-only we skip — we never exfiltrate turns to a third party
  // the user hasn't already consented to.
  //
  // Accepts:
  //   - "ollama:<name>"    (qualified)
  //   - "<name>"           (legacy / unqualified — treated as ollama)
  //   - anything else      → skip
  const s = settingsStore.load();
  const m = s.model;
  if (!m || typeof m !== 'string') return null;
  if (m.startsWith('ollama:')) return m;
  // Cloud provider prefixes that should always skip reflection.
  if (m.startsWith('openai:') || m.startsWith('anthropic:') || m.startsWith('openai-compatible:')) return null;
  // Bare model name — upgrade to ollama:<name>. providers.parseQualified()
  // treats unqualified strings as ollama, so this stays consistent.
  return `ollama:${m}`;
}

async function isDuplicateMemory(candidate: string): Promise<MemoryEntry | null> {
  // v1 dedup: case-insensitive exact-text match among the top semantic
  // hits. Good enough to stop "user prefers concise replies" from landing
  // twice; not a substitute for proper embedding comparison (future work).
  try {
    const hits = await memorySvc.recall(candidate, 3);
    const needle = candidate.trim().toLowerCase();
    for (const h of hits) {
      if (h.text.trim().toLowerCase() === needle) return h;
    }
    return null;
  } catch {
    return null;
  }
}

function buildExtractionPrompt(
  userTurn: string,
  assistantTurn: string,
  feedback: 'up' | 'down' | null,
  note: string,
): string {
  const header = feedback === 'down'
    ? `The user gave the following response a THUMBS DOWN${note ? ` with note: "${note}"` : ''}. What went wrong and what lesson should PAiA remember so it avoids this mistake next time?`
    : feedback === 'up'
      ? `The user approved this response (thumbs up). What specifically worked that PAiA should keep doing?`
      : `Review the exchange below and extract any durable lessons worth remembering across future conversations.`;

  return [
    header,
    '',
    'Output strict JSON with a "lessons" array. Each lesson is {scope, text, tags}:',
    '  scope ∈ { "preference", "user", "fact", "episode" }',
    '    - preference  : a rule about how to respond ("user prefers imperative tone")',
    '    - user        : a stable fact about the user ("user is a motor designer")',
    '    - fact        : durable domain info ("the motor has 12 slots / 10 poles")',
    '    - episode     : a specific thing that was learned in this exchange',
    '  text : ONE sentence, ≤ 160 chars, actionable / recognizable next time.',
    '  tags : ≤ 3 short topic tags.',
    '',
    'If nothing about the exchange is worth remembering across sessions, return {"lessons": []}.',
    'Do NOT include the conversation content verbatim. Do NOT invent facts the exchange does not support.',
    '',
    '─── EXCHANGE ───',
    `USER: ${userTurn.slice(0, 2000)}`,
    `ASSISTANT: ${assistantTurn.slice(0, 2000)}`,
    '─── END EXCHANGE ───',
    '',
    'Respond with ONLY the JSON object, no prose.',
  ].join('\n');
}

function parseLessons(raw: string): ExtractedLesson[] {
  // Tolerate models that wrap JSON in fences or prose.
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]) as { lessons?: unknown };
    if (!parsed.lessons || !Array.isArray(parsed.lessons)) return [];
    const out: ExtractedLesson[] = [];
    for (const l of parsed.lessons) {
      if (!l || typeof l !== 'object') continue;
      const scope = (l as { scope?: unknown }).scope;
      const text = (l as { text?: unknown }).text;
      const tags = (l as { tags?: unknown }).tags;
      if (typeof scope !== 'string' || typeof text !== 'string') continue;
      if (!['preference', 'user', 'fact', 'episode'].includes(scope)) continue;
      const cleanText = text.trim().slice(0, 300);
      if (cleanText.length < 8) continue;
      const cleanTags = Array.isArray(tags)
        ? (tags as unknown[])
            .filter((t): t is string => typeof t === 'string')
            .slice(0, 3)
            .map((t) => t.slice(0, 24))
        : [];
      out.push({ scope: scope as MemoryScope, text: cleanText, tags: cleanTags });
    }
    return out.slice(0, 4); // cap so one turn can't flood the store
  } catch {
    return [];
  }
}

async function saveLessons(
  lessons: ExtractedLesson[],
  baseTags: string[],
): Promise<string[]> {
  const saved: string[] = [];
  for (const l of lessons) {
    const dup = await isDuplicateMemory(l.text);
    if (dup) {
      logger.info('[experience] skipping duplicate of memory', dup.id);
      continue;
    }
    try {
      const entry = await memorySvc.remember(l.scope, l.text, [...baseTags, ...(l.tags ?? [])]);
      saved.push(entry.id);
    } catch (err) {
      logger.warn('[experience] failed to save lesson:', err);
    }
  }
  return saved;
}

async function runExtraction(
  threadId: string,
  lastMessageId: string | null,
  userTurn: string,
  assistantTurn: string,
  feedback: 'up' | 'down' | null,
  note: string,
  trigger: string,
): Promise<void> {
  if (!settingsStore.load().memoryEnabled) return;
  const model = localChatModel();
  if (!model) {
    logger.info('[experience] skipping reflection — no local model configured');
    return;
  }
  try {
    const prompt = buildExtractionPrompt(userTurn, assistantTurn, feedback, note);
    const response = await providers.chat(
      model,
      [
        { role: 'system', content: 'You extract durable lessons about a user and a domain from a single conversation exchange. Be conservative: most exchanges yield zero lessons.' },
        { role: 'user', content: prompt },
      ],
      () => { /* tokens discarded — we only use the final text */ },
    );
    const lessons = parseLessons(response);
    if (lessons.length === 0) {
      logger.info('[experience] no lessons extracted');
      return;
    }
    const baseTags = feedback ? [`feedback:${feedback}`, 'auto-reflect'] : ['auto-reflect'];
    const savedIds = await saveLessons(lessons, baseTags);
    db.saveReflection({
      id: randomUUID(),
      threadId,
      lastMessageId,
      trigger,
      extractedMemoryIds: savedIds,
      summary: lessons.map((l) => `(${l.scope}) ${l.text}`).join('\n'),
    });
    logger.info(`[experience] saved ${savedIds.length} lessons for thread ${threadId} (trigger=${trigger})`);
  } catch (err) {
    logger.warn('[experience] reflection failed:', err);
  }
}

async function getLastExchange(
  threadId: string,
): Promise<{ user: DbMessage; assistant: DbMessage } | null> {
  const msgs = db.listMessages(threadId) as DbMessage[];
  if (msgs.length < 2) return null;
  // Find the last assistant message and the user message just before it.
  for (let i = msgs.length - 1; i >= 1; i--) {
    const m = msgs[i];
    if (m.role !== 'assistant') continue;
    for (let j = i - 1; j >= 0; j--) {
      const p = msgs[j];
      if (p.role === 'user') return { user: p, assistant: m };
    }
    break;
  }
  return null;
}

// Public: debounced post-turn reflection. Call this after every
// completed assistant response.
export function scheduleReflection(threadId: string): void {
  const existing = pendingTimers.get(threadId);
  if (existing) clearTimeout(existing);
  const t = setTimeout(async () => {
    pendingTimers.delete(threadId);
    const last = lastReflectionAt.get(threadId) ?? 0;
    if (Date.now() - last < MIN_GAP_BETWEEN_REFLECTIONS_MS) {
      logger.info(`[experience] skipping reflection for ${threadId} — rate-limited`);
      return;
    }
    const exchange = await getLastExchange(threadId);
    if (!exchange) return;
    lastReflectionAt.set(threadId, Date.now());
    void runExtraction(
      threadId,
      exchange.assistant.id,
      exchange.user.content,
      exchange.assistant.content,
      null,
      '',
      `debounced-turn(${WINDOW_MESSAGES})`,
    );
  }, DEBOUNCE_MS);
  pendingTimers.set(threadId, t);
}

// Public: explicit feedback. Records the thumbs rating and (for
// downvotes, and optionally upvotes-with-notes) runs an immediate
// reflection so the mistake is captured while fresh.
export async function recordFeedback(
  messageId: string,
  kind: 'up' | 'down' | 'clear',
  note: string = '',
): Promise<{ reflectionSavedMemoryIds: string[] }> {
  if (kind === 'clear') {
    db.clearMessageFeedback(messageId);
    return { reflectionSavedMemoryIds: [] };
  }
  db.setMessageFeedback(messageId, kind, note);

  // Find the thread + exchange. We don't have a direct getMessage(id),
  // so we locate via the feedback row's message_id and then pull the
  // thread's messages.
  const feedback = db.getMessageFeedback(messageId);
  if (!feedback) return { reflectionSavedMemoryIds: [] };
  const threadRow = db.findThreadForMessage(messageId);
  if (!threadRow) return { reflectionSavedMemoryIds: [] };
  const threadId = threadRow.threadId;
  const allMsgs = db.listMessages(threadId) as DbMessage[];
  const msg = allMsgs.find((m) => m.id === messageId);
  if (!msg || msg.role !== 'assistant') return { reflectionSavedMemoryIds: [] };
  const idx = allMsgs.findIndex((m) => m.id === messageId);
  if (idx <= 0) return { reflectionSavedMemoryIds: [] };
  let userMsg: DbMessage | null = null;
  for (let j = idx - 1; j >= 0; j--) {
    if (allMsgs[j].role === 'user') { userMsg = allMsgs[j]; break; }
  }
  if (!userMsg) return { reflectionSavedMemoryIds: [] };

  // Only trigger an LLM-powered reflection on downvote, or on upvote WITH note.
  const shouldReflect = kind === 'down' || (kind === 'up' && note.trim().length > 0);
  if (!shouldReflect) return { reflectionSavedMemoryIds: [] };

  const model = localChatModel();
  if (!model || !settingsStore.load().memoryEnabled) return { reflectionSavedMemoryIds: [] };

  const prompt = buildExtractionPrompt(userMsg.content, msg.content, kind, note);
  try {
    const response = await providers.chat(
      model,
      [
        { role: 'system', content: 'You extract durable lessons about a user and a domain from a single conversation exchange. Be conservative: most exchanges yield zero lessons.' },
        { role: 'user', content: prompt },
      ],
      () => { /* tokens discarded — we only use the final text */ },
    );
    const lessons = parseLessons(response);
    if (lessons.length === 0) return { reflectionSavedMemoryIds: [] };
    const savedIds = await saveLessons(lessons, [`feedback:${kind}`, 'user-rated']);
    db.saveReflection({
      id: randomUUID(),
      threadId,
      lastMessageId: messageId,
      trigger: `feedback:${kind}`,
      extractedMemoryIds: savedIds,
      summary: lessons.map((l) => `(${l.scope}) ${l.text}`).join('\n'),
    });
    return { reflectionSavedMemoryIds: savedIds };
  } catch (err) {
    logger.warn('[experience] feedback reflection failed:', err);
    return { reflectionSavedMemoryIds: [] };
  }
}

export function getFeedback(messageId: string): db.MessageFeedback | null {
  return db.getMessageFeedback(messageId);
}

export function listReflections(threadId?: string, limit = 200): db.Reflection[] {
  return threadId ? db.listReflectionsForThread(threadId, limit) : db.listAllReflections(limit);
}
