// Persistent FIFO queue of agent goals.
//
// Lets the user batch multiple instructions ("do X, then Y, then Z") and
// have them executed one at a time, across restarts. Each queued task
// becomes its own agent run (so the existing transcript UI, step budget,
// approval flow, and abort plumbing all work unchanged).
//
// Flow:
//   enqueue(goal)   → row with status='pending'
//   runner loop     → picks next pending, creates a thread, starts an
//                     agent run, waits for finalize, records result,
//                     advances to the next pending row.
//   cancel(id)      → if running: agent.abort(). if pending: mark cancelled.
//
// Reconciliation: if the app crashes mid-run, a row may be left as
// 'running' forever. On startup we flip those to 'failed' so the runner
// doesn't wait on a ghost.

import { BrowserWindow, ipcMain } from 'electron';
import type { QueuedTask } from '../shared/types';
import * as db from './db';
import * as agent from './agent';
import * as settingsStore from './settings';
import { logger } from './logger';

let activeWindow: BrowserWindow | null = null;
let running = false;
/** Set when the current task's agent run finalizes. */
let finalizeResolver: (() => void) | null = null;
/** Resolves the idle-wait when a new task is enqueued. */
let enqueueWaker: (() => void) | null = null;
let stopped = false;
/** ID of the task we're currently processing, if any. */
let currentTaskId: string | null = null;
/** Agent run id for the current task (so we can abort it). */
let currentRunId: string | null = null;

export function setActiveWindow(win: BrowserWindow): void {
  activeWindow = win;
}

function broadcast(): void {
  activeWindow?.webContents.send('paia:queue-update', db.listQueuedTasks());
}

function wake(): void {
  if (enqueueWaker) {
    const r = enqueueWaker;
    enqueueWaker = null;
    r();
  }
}

// ─── public API ─────────────────────────────────────────────────────

export function init(): void {
  if (running) return;
  running = true;
  stopped = false;

  const stale = db.reconcileStaleRunningTasks();
  if (stale > 0) logger.info(`taskQueue: reconciled ${stale} stale running task(s) from prior crash`);

  // Forward agent finalization events so our runner can advance.
  agent.onRunFinalized((run) => {
    if (!currentRunId || run.id !== currentRunId) return;
    if (!currentTaskId) return;

    const status = run.status === 'done'
      ? 'done'
      : run.status === 'aborted' ? 'cancelled' : 'failed';

    db.updateQueuedTask(currentTaskId, {
      status,
      result: run.summary ?? null,
      finishedAt: Date.now(),
    });
    currentTaskId = null;
    currentRunId = null;
    broadcast();
    if (finalizeResolver) {
      const r = finalizeResolver;
      finalizeResolver = null;
      r();
    }
  });

  void loop();
  logger.info('taskQueue: runner started');
}

export function stop(): void {
  stopped = true;
  running = false;
  wake();
}

export function enqueue(p: {
  goal: string;
  model?: string;
  autonomy?: QueuedTask['autonomy'];
  source?: QueuedTask['source'];
}): QueuedTask {
  if (!p.goal || p.goal.trim() === '') throw new Error('Task goal must not be empty');
  const task = db.enqueueTask({
    goal: p.goal.trim(),
    model: p.model,
    autonomy: p.autonomy,
    source: p.source ?? 'user',
  });
  broadcast();
  wake();
  return task;
}

export function list(): QueuedTask[] {
  return db.listQueuedTasks();
}

export function cancel(taskId: string): boolean {
  const task = db.getQueuedTask(taskId);
  if (!task) return false;

  if (task.status === 'running' && currentRunId && currentTaskId === taskId) {
    // Abort the in-flight agent run; the finalize listener will flip the
    // task row to 'cancelled' and advance the loop.
    agent.abort(currentRunId);
    return true;
  }

  if (task.status === 'pending') {
    db.updateQueuedTask(taskId, { status: 'cancelled', finishedAt: Date.now() });
    broadcast();
    return true;
  }

  return false; // already terminal
}

export function clearFinished(): number {
  const n = db.clearFinishedTasks();
  broadcast();
  return n;
}

// ─── runner loop ───────────────────────────────────────────────────

async function loop(): Promise<void> {
  while (!stopped) {
    const next = db.nextPendingTask();
    if (!next) {
      await new Promise<void>((resolve) => { enqueueWaker = resolve; });
      continue;
    }

    const settings = settingsStore.load();
    const model = next.model || settings.model;
    const autonomy = next.autonomy ?? settings.agentAutonomy;

    const title = next.goal.length > 80 ? next.goal.slice(0, 77) + '...' : next.goal;
    const thread = db.createThread(`[queue] ${title}`, null, model);

    db.updateQueuedTask(next.id, {
      status: 'running',
      threadId: thread.id,
      startedAt: Date.now(),
    });
    currentTaskId = next.id;
    broadcast();

    try {
      const run = await agent.startRun({
        threadId: thread.id,
        goal: next.goal,
        model,
        autonomy,
        bypassApproval: autonomy === 'autonomous',
      });
      currentRunId = run.id;
      db.updateQueuedTask(next.id, { agentRunId: run.id });
      broadcast();

      await new Promise<void>((resolve) => { finalizeResolver = resolve; });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('taskQueue: failed to start run', msg);
      db.updateQueuedTask(next.id, {
        status: 'failed',
        result: `Failed to start: ${msg}`,
        finishedAt: Date.now(),
      });
      currentTaskId = null;
      currentRunId = null;
      broadcast();
    }
  }
  logger.info('taskQueue: runner stopped');
}

// ─── IPC ───────────────────────────────────────────────────────────

ipcMain.handle('paia:queue-enqueue', (_e, p: {
  goal: string;
  model?: string;
  autonomy?: QueuedTask['autonomy'];
}) => enqueue({ ...p, source: 'user' }));

ipcMain.handle('paia:queue-list', () => list());
ipcMain.handle('paia:queue-cancel', (_e, taskId: string) => cancel(taskId));
ipcMain.handle('paia:queue-clear-finished', () => clearFinished());
