// Deep Research pipeline.
//
// Pipeline shape, per run:
//
//   1. PLAN  — one LLM call decomposes the question into N sub-questions.
//   2. SEARCH — for each sub-question, run webSearch + optional rag.query.
//   3. FETCH  — pick the top-K deduped URLs across all sub-queries and
//               pull their readable text via tools.web.fetch.
//   4. SYNTH  — one LLM call assembles the final report with [n] citations.
//
// Depth (from Settings → Research → researchDepth) controls whether we
// also run a second "refine" pass: after the first synthesis, we ask the
// model for follow-up sub-questions and loop 2→3→4 once more. depth=1
// is fast, depth=2 is the default, depth=3 is thorough.
//
// The whole thing streams progress to the renderer via `paia:research-*`
// events and persists the final run in `research_runs`.

import { app, ipcMain, BrowserWindow } from 'electron';
import { randomUUID } from 'crypto';
import type {
  ChatMessage,
  ResearchProgress,
  ResearchRun,
  ResearchSource,
} from '../shared/types';
import * as db from './db';
import * as webSearch from './webSearch';
import * as providers from './providers';
import * as settingsStore from './settings';
import { extractReadableText } from './tools';
import { requireFeature } from './license';
import { checkAndRecord } from './metering';
import { logger } from './logger';

let activeWindow: BrowserWindow | null = null;
export function setActiveWindow(win: BrowserWindow): void {
  activeWindow = win;
}

function send(channel: string, payload: unknown): void {
  activeWindow?.webContents.send(channel, payload);
}

function progress(p: ResearchProgress): void {
  send('paia:research-progress', p);
}

// ─── planning prompt ──────────────────────────────────────────────

async function plan(model: string, question: string, existingSources: ResearchSource[]): Promise<string[]> {
  const already = existingSources.length > 0
    ? `\nAlready collected:\n${existingSources.slice(0, 8).map((s, i) => `[${i + 1}] ${s.title} — ${s.url}`).join('\n')}\n`
    : '';
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'You are a research planner. Given a question, produce 3–5 focused sub-questions that, taken together, will let another agent answer it thoroughly.',
        already,
        'Return ONLY a JSON array of strings, e.g. ["sub-question one", "sub-question two"]. No prose, no markdown fences.',
      ].join('\n'),
    },
    { role: 'user', content: question },
  ];

  let raw = '';
  try {
    raw = await providers.chat(model, messages, () => {});
  } catch (err) {
    logger.warn('research.plan chat failed, falling back to a single query', err);
    return [question];
  }

  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [question];
  try {
    const arr = JSON.parse(match[0]) as unknown;
    if (!Array.isArray(arr)) return [question];
    const filtered = arr.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
    return filtered.length > 0 ? filtered.slice(0, 5) : [question];
  } catch {
    return [question];
  }
}

// ─── search + fetch ───────────────────────────────────────────────

async function searchAll(
  subs: string[],
  cap: number,
): Promise<ResearchSource[]> {
  const collected: Map<string, ResearchSource> = new Map();
  for (let i = 0; i < subs.length; i++) {
    const q = subs[i];
    progress({
      runId: '',
      stage: 'searching',
      current: i,
      total: subs.length,
      message: `Searching: ${q}`,
    });
    try {
      const res = await webSearch.search(q, Math.ceil(cap / subs.length));
      for (const r of res.results) {
        if (!collected.has(r.url)) {
          collected.set(r.url, {
            n: collected.size + 1,
            title: r.title,
            url: r.url,
            snippet: r.snippet,
          });
        }
      }
    } catch (err) {
      logger.warn('research.searchAll sub-query failed', q, err);
    }
  }
  return Array.from(collected.values()).slice(0, cap);
}

async function fetchAll(sources: ResearchSource[]): Promise<ResearchSource[]> {
  const out: ResearchSource[] = [];
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    progress({
      runId: '',
      stage: 'fetching',
      current: i,
      total: sources.length,
      message: `Reading: ${s.title}`,
    });
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12_000);
      const res = await fetch(s.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 PAiA/0.3 (research)',
          Accept: 'text/html,text/plain,*/*;q=0.1',
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        out.push(s);
        continue;
      }
      const html = await res.text();
      const text = extractReadableText(html).slice(0, 6000);
      out.push({ ...s, snippet: text || s.snippet, fetchedChars: text.length });
    } catch (err) {
      logger.warn('research.fetchAll failed', s.url, err);
      out.push(s);
    }
  }
  return out;
}

// ─── synthesis prompt ─────────────────────────────────────────────

async function synthesize(
  model: string,
  question: string,
  sources: ResearchSource[],
  onToken: (t: string) => void,
): Promise<string> {
  const blocks = sources
    .slice(0, 12)
    .map((s) => `[${s.n}] ${s.title}\n${s.url}\n${(s.snippet ?? '').slice(0, 2000)}`)
    .join('\n\n');

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'You are a senior research analyst. Produce a thorough, well-structured report that answers the user\'s question using ONLY the supplied sources.',
        '',
        'Requirements:',
        '  - Use markdown. Start with a one-paragraph executive summary, then sections with `##` headings.',
        '  - Cite every non-trivial claim with [n] markers pointing at the numbered sources.',
        '  - If the sources conflict, say so explicitly and explain which you trust more.',
        '  - If the sources do not cover part of the question, say so — do NOT fabricate.',
        '  - End with a `## Sources` section listing `[n] Title — URL` for every citation you used.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Research question: ${question}\n\nSources:\n\n${blocks}`,
    },
  ];

  return providers.chat(model, messages, onToken);
}

// ─── run driver ───────────────────────────────────────────────────

export interface StartResearchOptions {
  threadId: string;
  question: string;
  model: string;
  depth?: number;
  maxSources?: number;
}

export async function startRun(opts: StartResearchOptions): Promise<ResearchRun> {
  requireFeature('deep-research');
  checkAndRecord('research-run');
  const settings = settingsStore.load();
  const depth = Math.min(Math.max(opts.depth ?? settings.researchDepth, 1), 3);
  const maxSources = Math.min(Math.max(opts.maxSources ?? settings.researchMaxSources, 3), 20);

  const run: ResearchRun = {
    id: randomUUID(),
    threadId: opts.threadId,
    question: opts.question,
    model: opts.model,
    status: 'planning',
    subQuestions: [],
    sources: [],
    startedAt: Date.now(),
  };
  db.createResearchRun(run);
  send('paia:research-run', run);

  // Run async; do not block the IPC handler.
  void runLoop(run, depth, maxSources).catch((err) => {
    logger.error('research loop crashed', err);
    run.status = 'error';
    run.error = err instanceof Error ? err.message : String(err);
    run.endedAt = Date.now();
    db.updateResearchRun(run.id, { status: 'error', error: run.error, endedAt: run.endedAt });
    send('paia:research-run', run);
  });

  return run;
}

async function runLoop(run: ResearchRun, depth: number, maxSources: number): Promise<void> {
  const aggregated: ResearchSource[] = [];
  let allSubs: string[] = [];

  for (let pass = 0; pass < depth; pass++) {
    run.status = 'planning';
    db.updateResearchRun(run.id, { status: 'planning' });
    send('paia:research-run', run);
    progress({
      runId: run.id,
      stage: 'planning',
      current: pass,
      total: depth,
      message: `Planning pass ${pass + 1}/${depth}`,
    });

    const subs = await plan(run.model, run.question, aggregated);
    allSubs = Array.from(new Set([...allSubs, ...subs]));
    run.subQuestions = allSubs;
    db.updateResearchRun(run.id, { subQuestions: allSubs });

    run.status = 'searching';
    db.updateResearchRun(run.id, { status: 'searching' });
    send('paia:research-run', run);
    const found = await searchAll(subs, Math.ceil(maxSources / Math.max(1, depth - pass)));

    for (const s of found) {
      if (!aggregated.some((a) => a.url === s.url)) {
        aggregated.push({ ...s, n: aggregated.length + 1 });
      }
    }
    run.sources = aggregated;
    db.updateResearchRun(run.id, { sources: aggregated });

    if (aggregated.length >= maxSources) break;
  }

  run.status = 'fetching';
  db.updateResearchRun(run.id, { status: 'fetching' });
  send('paia:research-run', run);
  const enriched = await fetchAll(aggregated.slice(0, maxSources));
  run.sources = enriched;
  db.updateResearchRun(run.id, { sources: enriched });

  run.status = 'synthesizing';
  db.updateResearchRun(run.id, { status: 'synthesizing' });
  send('paia:research-run', run);
  progress({
    runId: run.id,
    stage: 'synthesizing',
    current: 0,
    total: 1,
    message: 'Writing report…',
  });

  let report = '';
  try {
    report = await synthesize(run.model, run.question, enriched, (token) => {
      send('paia:research-token', { runId: run.id, token });
    });
  } catch (err) {
    run.status = 'error';
    run.error = err instanceof Error ? err.message : String(err);
    run.endedAt = Date.now();
    db.updateResearchRun(run.id, { status: 'error', error: run.error, endedAt: run.endedAt });
    send('paia:research-run', run);
    return;
  }

  run.status = 'done';
  run.report = report;
  run.endedAt = Date.now();
  db.updateResearchRun(run.id, { status: 'done', report, endedAt: run.endedAt });
  send('paia:research-run', run);
}

// ─── IPC ──────────────────────────────────────────────────────────

ipcMain.handle('paia:research-start', (_e, opts: StartResearchOptions) => startRun(opts));
ipcMain.handle('paia:research-list', (_e, threadId?: string) => db.listResearchRuns(threadId));

void app; // silence unused import
