// Lightweight in-process scheduler.
//
// Users can pin recurring tasks — "every morning at 8, summarize unread
// email"; "every 30 minutes, check for new issues on my repo" — that
// trigger the agent, the researcher, or a prompt.
//
// We do NOT ship a full cron parser. Two trigger kinds cover >95% of
// real usage:
//   - cron:     a subset of 5-field cron (`m h dom mon dow`) with * and /N
//   - interval: every N minutes from startup
//   - once:     at a specific unix ms timestamp
//
// Tick resolution is one minute — good enough for every practical
// scheduled task and cheap enough to leave running forever.

import { app, ipcMain } from 'electron';
import { randomUUID } from 'crypto';
import type {
  ChatMessage,
  ScheduleAction,
  ScheduleTrigger,
  ScheduledTask,
} from '../shared/types';
import * as db from './db';
import * as agent from './agent';
import * as research from './research';
import * as providers from './providers';
import { requireFeature } from './license';
import { logger } from './logger';
import { cronMatches, parseCron } from '../shared/cron';

let interval: NodeJS.Timeout | null = null;

function nextRunAt(trigger: ScheduleTrigger, from: number = Date.now()): number | undefined {
  if (trigger.kind === 'once') return trigger.at > from ? trigger.at : undefined;
  if (trigger.kind === 'interval') {
    const ms = Math.max(1, trigger.everyMinutes) * 60_000;
    return from + ms;
  }
  // cron — search forward a day
  try {
    const fields = parseCron(trigger.expression);
    for (let i = 1; i <= 60 * 24 * 31; i++) {
      const t = from + i * 60_000;
      const d = new Date(t);
      d.setSeconds(0, 0);
      if (cronMatches(fields, d)) return d.getTime();
    }
  } catch {
    return undefined;
  }
  return undefined;
}

// ─── dispatching actions ──────────────────────────────────────────

async function runAction(task: ScheduledTask): Promise<void> {
  const action: ScheduleAction = task.action;
  try {
    if (action.kind === 'agent') {
      // Scheduled agents always run in their current autonomy setting
      // unless the task specifies otherwise.
      const thread = await ensureScheduledThread(task);
      await agent.startRun({
        threadId: thread,
        goal: action.goal,
        model: task.model,
        autonomy: action.autonomy,
        // Scheduled tasks fire when the user is almost certainly not
        // looking at the app. Default to headless (bypass interactive
        // approvals) unless the user explicitly set bypassApproval=false
        // on the task config to keep the usual interactive behaviour.
        bypassApproval: action.bypassApproval !== false,
      });
    } else if (action.kind === 'research') {
      const thread = await ensureScheduledThread(task);
      await research.startRun({
        threadId: thread,
        question: action.question,
        model: task.model,
      });
    } else if (action.kind === 'prompt') {
      // One-shot chat. Persists into a dedicated scheduled-runs thread so
      // the user can see the output without the task hijacking their
      // current conversation.
      const thread = await ensureScheduledThread(task);
      const history: ChatMessage[] = [
        { role: 'system', content: `Scheduled task "${task.name}" (${new Date().toISOString()}).` },
        { role: 'user', content: action.text },
      ];
      let out = '';
      const text = await providers.chat(task.model, history, (token) => {
        out += token;
      });
      db.addMessage(thread, 'user', action.text, 0);
      db.addMessage(thread, 'assistant', text || out, 0);
    }
    task.lastStatus = 'ok';
    task.lastError = undefined;
  } catch (err) {
    task.lastStatus = 'error';
    task.lastError = err instanceof Error ? err.message : String(err);
    logger.warn(`scheduled task "${task.name}" failed`, task.lastError);
  }
  task.lastRunAt = Date.now();
  task.nextRunAt = nextRunAt(task.trigger, task.lastRunAt + 60_000);
  db.saveScheduledTask(task);
}

async function ensureScheduledThread(task: ScheduledTask): Promise<string> {
  const existing = db.listThreads().find((t) => t.title === `Scheduled: ${task.name}`);
  if (existing) return existing.id;
  const t = db.createThread(`Scheduled: ${task.name}`, null, task.model);
  return t.id;
}

// ─── tick loop ────────────────────────────────────────────────────

function tick(): void {
  const now = Date.now();
  const d = new Date(now);
  d.setSeconds(0, 0);
  for (const task of db.listScheduledTasks()) {
    if (!task.enabled) continue;
    let shouldFire = false;
    if (task.trigger.kind === 'cron') {
      try {
        const fields = parseCron(task.trigger.expression);
        shouldFire = cronMatches(fields, d);
      } catch {
        shouldFire = false;
      }
    } else if (task.trigger.kind === 'interval') {
      if (!task.lastRunAt) {
        shouldFire = true;
      } else {
        shouldFire = now - task.lastRunAt >= task.trigger.everyMinutes * 60_000;
      }
    } else if (task.trigger.kind === 'once') {
      shouldFire = !task.lastRunAt && task.trigger.at <= now;
    }
    if (shouldFire) {
      void runAction(task);
    }
  }
}

export function start(): void {
  if (interval) return;
  // Fire immediately so interval-kind tasks that haven't run yet pick up quickly.
  tick();
  interval = setInterval(tick, 60_000);
}

export function stop(): void {
  if (!interval) return;
  clearInterval(interval);
  interval = null;
}

// ─── IPC ──────────────────────────────────────────────────────────

ipcMain.handle('paia:scheduler-list', () => db.listScheduledTasks());

ipcMain.handle('paia:scheduler-save', (_e, input: Partial<ScheduledTask>) => {
  requireFeature('scheduler');
  const existing = input.id
    ? db.listScheduledTasks().find((t) => t.id === input.id)
    : undefined;
  const now = Date.now();
  const task: ScheduledTask = {
    id: existing?.id ?? randomUUID(),
    name: input.name ?? existing?.name ?? 'Untitled task',
    enabled: input.enabled ?? existing?.enabled ?? true,
    trigger: input.trigger ?? existing?.trigger ?? { kind: 'interval', everyMinutes: 60 },
    action: input.action ?? existing?.action ?? { kind: 'prompt', text: 'Say hello.' },
    model: input.model ?? existing?.model ?? '',
    createdAt: existing?.createdAt ?? now,
    lastRunAt: existing?.lastRunAt,
    lastStatus: existing?.lastStatus,
    lastError: existing?.lastError,
    nextRunAt: existing?.nextRunAt,
  };
  task.nextRunAt = nextRunAt(task.trigger);
  db.saveScheduledTask(task);
  return task;
});

ipcMain.handle('paia:scheduler-delete', (_e, id: string) => {
  db.deleteScheduledTask(id);
});

ipcMain.handle('paia:scheduler-run-now', async (_e, id: string) => {
  const task = db.listScheduledTasks().find((t) => t.id === id);
  if (!task) return { ok: false, error: 'task not found' };
  try {
    await runAction(task);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

void app;
