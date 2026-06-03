// Council of Experts — parallel persona consultation.
//
// Given a question and a list of N persona IDs, fires N concurrent chat
// calls (one per persona, each with that persona's RAG bound in), then
// runs a synthesis pass that merges the expert answers into one coherent
// reply that flags disagreements.
//
// Events are streamed back to the renderer:
//   {kind:'started',     personaIds}
//   {kind:'expert-done', personaId, content, durationMs}
//   {kind:'experts-all-done', expertAnswers}
//   {kind:'synthesis-token', token}
//   {kind:'finished',    synthesis, expertAnswers}
//   {kind:'error',       error}
//
// The synthesised reply is also persisted into the thread as an
// assistant message so it shows up in chat history. The per-expert
// answers are stored on the message as JSON in attachments (kind='council')
// so the renderer can re-render the panel after a reload.

import { randomUUID } from 'crypto';
import type { BrowserWindow } from 'electron';
import * as personas from './personas';
import * as providers from './providers';
import * as rag from './rag';
import * as db from './db';
import { logger } from './logger';
import type { ChatMessage, Persona } from '../shared/types';

const SYNTHESIS_SYSTEM = `You are the synthesiser at the end of a council of expert opinions.
Several experts have answered the same user question independently.
Your job is to produce ONE coherent reply for the user:
  1. Lead with the answer the user needs, written in the user's voice (not "Expert A says…").
  2. Where the experts agree, state confidently.
  3. Where they disagree, name the disagreement, summarise each position briefly, and recommend which to weight more (and why).
  4. Cite specific experts inline by their role name in [brackets] when their input is load-bearing — e.g. [Cardiologist] or [Pharmacist].
  5. Keep it concise. No headers like "Synthesis" or "Final answer" — just the reply.`;

export interface ExpertAnswer {
  personaId: string;
  personaName: string;
  emoji: string;
  content: string;
  durationMs: number;
  error?: string;
}

export interface CouncilEvent {
  runId: string;
  threadId: string;
  kind:
    | 'started'
    | 'expert-done'
    | 'experts-all-done'
    | 'synthesis-token'
    | 'finished'
    | 'error';
  personaIds?: string[];
  personaId?: string;
  personaName?: string;
  emoji?: string;
  content?: string;
  token?: string;
  durationMs?: number;
  expertAnswers?: ExpertAnswer[];
  synthesis?: string;
  error?: string;
}

interface RunOptions {
  threadId: string;
  question: string;
  personaIds: string[];
  model: string;
  win: BrowserWindow;
}

const activeRuns = new Map<string, AbortController>();

function emit(win: BrowserWindow, ev: CouncilEvent): void {
  if (!win.isDestroyed()) {
    win.webContents.send('paia:council-event', ev);
  }
}

async function buildExpertPrompt(persona: Persona, threadId: string, question: string): Promise<ChatMessage[]> {
  // Persona system prompt + RAG context (persona-bound stacks + thread-bound stacks).
  const threadCollections = db.listThreadCollections(threadId);
  const personaCollections = persona.ragCollectionIds ?? [];
  const collectionIds = Array.from(new Set([...threadCollections, ...personaCollections]));

  let systemPrompt = persona.systemPrompt;
  if (collectionIds.length > 0) {
    try {
      const chunks = await rag.retrieve(collectionIds, question, 5);
      if (chunks.length > 0) {
        systemPrompt = `${systemPrompt}\n\n${rag.formatContext(chunks)}`;
      }
    } catch (err) {
      logger.warn('council: RAG retrieve failed for persona ' + persona.id, err);
    }
  }

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: question },
  ];
}

export async function runCouncil(opts: RunOptions): Promise<string> {
  const { threadId, question, personaIds, model, win } = opts;
  const runId = randomUUID();
  const abort = new AbortController();
  activeRuns.set(runId, abort);

  try {
    // Resolve personas; drop unknowns.
    const resolved: Persona[] = personaIds
      .map((id) => personas.getPersona(id))
      .filter((p): p is Persona => p !== null);

    if (resolved.length === 0) {
      emit(win, { runId, threadId, kind: 'error', error: 'No valid personas in council request.' });
      return runId;
    }

    emit(win, {
      runId,
      threadId,
      kind: 'started',
      personaIds: resolved.map((p) => p.id),
    });

    // Phase 1: parallel expert calls. Each is independent.
    const start = Date.now();
    const tasks = resolved.map(async (persona): Promise<ExpertAnswer> => {
      const t0 = Date.now();
      try {
        const messages = await buildExpertPrompt(persona, threadId, question);
        const content = await providers.chat(model, messages, () => {
          /* discard intermediate tokens — v1 doesn't stream per-expert */
        });
        const answer: ExpertAnswer = {
          personaId: persona.id,
          personaName: persona.name,
          emoji: persona.emoji,
          content,
          durationMs: Date.now() - t0,
        };
        emit(win, {
          runId,
          threadId,
          kind: 'expert-done',
          personaId: persona.id,
          personaName: persona.name,
          emoji: persona.emoji,
          content,
          durationMs: answer.durationMs,
        });
        return answer;
      } catch (err) {
        const e = err instanceof Error ? err.message : String(err);
        const answer: ExpertAnswer = {
          personaId: persona.id,
          personaName: persona.name,
          emoji: persona.emoji,
          content: '',
          durationMs: Date.now() - t0,
          error: e,
        };
        emit(win, {
          runId,
          threadId,
          kind: 'expert-done',
          personaId: persona.id,
          personaName: persona.name,
          emoji: persona.emoji,
          content: '',
          durationMs: answer.durationMs,
          error: e,
        });
        return answer;
      }
    });

    const expertAnswers = await Promise.all(tasks);
    if (abort.signal.aborted) {
      emit(win, { runId, threadId, kind: 'error', error: 'Aborted.' });
      return runId;
    }

    const usable = expertAnswers.filter((a) => !a.error && a.content.trim().length > 0);
    emit(win, { runId, threadId, kind: 'experts-all-done', expertAnswers });

    if (usable.length === 0) {
      emit(win, {
        runId,
        threadId,
        kind: 'error',
        error: 'All experts errored — see individual results.',
      });
      return runId;
    }

    // Phase 2: synthesis. Stream tokens to renderer.
    const synthesisUser = [
      `User question: ${question}`,
      '',
      'Expert opinions:',
      ...usable.map(
        (a, i) =>
          `--- Expert ${i + 1}: ${a.personaName} (${a.emoji}) ---\n${a.content}`,
      ),
      '',
      'Synthesised reply:',
    ].join('\n');

    let synthesis = '';
    try {
      synthesis = await providers.chat(
        model,
        [
          { role: 'system', content: SYNTHESIS_SYSTEM },
          { role: 'user', content: synthesisUser },
        ],
        (token) => {
          if (abort.signal.aborted) return;
          synthesis += token;
          emit(win, { runId, threadId, kind: 'synthesis-token', token });
        },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emit(win, { runId, threadId, kind: 'error', error: `Synthesis failed: ${msg}` });
      return runId;
    }

    logger.info(`council run ${runId} finished in ${Date.now() - start}ms (${usable.length}/${resolved.length} experts ok)`);
    emit(win, { runId, threadId, kind: 'finished', synthesis, expertAnswers });

    // Persist as a normal assistant message in the thread. The full
    // council details are stored alongside as an attachment of kind
    // 'council-payload' so the renderer can re-render the panel after
    // a reload.
    try {
      const payload = JSON.stringify({ question, expertAnswers, picks: resolved.map((p) => p.id) });
      db.addMessage(
        threadId,
        'assistant',
        synthesis,
        0,
        [
          {
            kind: 'council-payload',
            mimeType: 'application/json',
            filename: 'council.json',
            sizeBytes: payload.length,
            content: payload,
          },
        ],
      );
    } catch (err) {
      logger.warn('council: persist message failed', err);
    }

    return runId;
  } finally {
    activeRuns.delete(runId);
  }
}

export function abortCouncil(runId: string): boolean {
  const ctrl = activeRuns.get(runId);
  if (!ctrl) return false;
  ctrl.abort();
  return true;
}
