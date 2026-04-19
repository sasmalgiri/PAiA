// Multi-agent "team" orchestration.
//
// Unlike the single-agent loop in agent.ts, this module coordinates a
// small set of role-specialised LLM calls that collaborate on a blackboard:
//
//   PLANNER    — produces a structured plan with explicit hand-offs
//   RESEARCHER — performs web/rag searches when the plan says so
//   CODER      — produces or edits code as an Artifact
//   REVIEWER   — critiques the current output, may send the plan back to
//                the planner with notes
//   WRITER     — assembles the final human-readable answer
//
// The loop is:
//
//   1. Planner drafts the plan.
//   2. For each step, the named role produces a turn. Output lands on the
//      blackboard (and in agent_team_turns persisted for replay).
//   3. Reviewer judges "converged / needs-another-round / abort". If not
//      converged, we ask the planner for a revised plan and loop.
//   4. Writer produces the final answer once reviewer says done.
//
// Each individual role can call tools through the underlying Agent
// orchestrator (agent.startRun) if its prompt instructs it to — so a
// "researcher" turn that says `{"tool": "web.search"}` will transparently
// spin a micro-agent for that step and link the childRunId on the turn.
//
// This is a genuine differentiator over single-agent tools because it
// lets one cheap fast model do the labor-intensive work (research, code
// drafts) while a stronger model does planning and review.

import { app, ipcMain } from 'electron';
import { randomUUID } from 'crypto';
import type {
  AgentTeamMember,
  AgentTeamRole,
  AgentTeamRun,
  AgentTeamTurn,
  ChatMessage,
} from '../shared/types';
import * as providers from './providers';
import * as classroom from './classroom';
import { requireFeature } from './license';
import { logger } from './logger';

let activeWindow: Electron.BrowserWindow | null = null;
const teamRuns = new Map<string, TeamRunContext>();

export function setActiveWindow(win: Electron.BrowserWindow): void {
  activeWindow = win;
}

function send(channel: string, payload: unknown): void {
  activeWindow?.webContents.send(channel, payload);
}

// ─── role prompts ─────────────────────────────────────────────────

const ROLE_SYSTEM: Record<AgentTeamRole, string> = {
  planner:
    'You are the PLANNER on a small agent team. Given a goal, return a JSON plan of the form {"plan": [{"role":"researcher|coder|reviewer|writer","task":"..."}, ...], "notes":"..."}. Be concrete. Never more than 6 steps. No prose outside the JSON.',
  researcher:
    'You are the RESEARCHER. Given a task, produce a short research brief (bullet points, 150 words max). If you need the web, say "NEED_WEB: <query>" on the first line and stop — a separate search tool will run, and you\'ll be re-invoked with the results.',
  coder:
    'You are the CODER. Produce or revise code cleanly. Reply with a single Markdown code block (no prose before/after). Use the language appropriate to the task. If you do not know the language, prefer TypeScript.',
  reviewer:
    'You are the REVIEWER. Look at the blackboard so far and the stated goal. Reply with a JSON object: {"verdict":"converged|revise|abort","notes":"why"}. Be strict — if anything is vague, hand-wavy, or missing citations, request a revise. No prose outside the JSON.',
  writer:
    'You are the WRITER. Take the blackboard and produce the final, polished answer for the user in Markdown. Cite sources inline with [n] when applicable. End with a one-line takeaway.',
};

interface TeamRunContext {
  run: AgentTeamRun;
  turns: AgentTeamTurn[];
  aborted: boolean;
  ordinal: number;
}

export interface StartTeamOptions {
  threadId: string;
  goal: string;
  members?: AgentTeamMember[];
  /** Upper bound on revise-loops. */
  maxRounds?: number;
  /** Fallback model if a member didn't specify one. */
  model: string;
}

function defaultMembers(model: string): AgentTeamMember[] {
  return [
    { role: 'planner', model },
    { role: 'researcher', model },
    { role: 'coder', model },
    { role: 'reviewer', model },
    { role: 'writer', model },
  ];
}

// ─── single-call helper ───────────────────────────────────────────

async function askRole(
  member: AgentTeamMember,
  blackboard: ChatMessage[],
  taskInstruction: string,
): Promise<string> {
  const system = [ROLE_SYSTEM[member.role], member.extraSystemPrompt ?? ''].filter(Boolean).join('\n\n');
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    ...blackboard,
    { role: 'user', content: taskInstruction },
  ];
  return providers.chat(member.model, messages, (t) => {
    send('paia:team-token', { runId: '', role: member.role, token: t });
  });
}

// ─── main loop ────────────────────────────────────────────────────

export async function startRun(opts: StartTeamOptions): Promise<AgentTeamRun> {
  requireFeature('team');
  const policy = classroom.currentPolicy();
  if (policy && !policy.allowAgent) {
    throw new Error('Agent mode (required for team runs) is disabled by your classroom policy.');
  }

  const members = opts.members ?? defaultMembers(opts.model);
  const run: AgentTeamRun = {
    id: randomUUID(),
    threadId: opts.threadId,
    goal: opts.goal,
    members,
    status: 'running',
    maxRounds: Math.min(opts.maxRounds ?? 3, 5),
    startedAt: Date.now(),
  };
  const ctx: TeamRunContext = { run, turns: [], aborted: false, ordinal: 0 };
  teamRuns.set(run.id, ctx);
  send('paia:team-run', run);

  void loop(ctx).catch((err) => {
    logger.error('team loop crashed', err);
    finalize(ctx, 'error', err instanceof Error ? err.message : String(err));
  });

  return run;
}

function finalize(ctx: TeamRunContext, status: AgentTeamRun['status'], summary: string): void {
  ctx.run.status = status;
  ctx.run.endedAt = Date.now();
  ctx.run.summary = summary;
  send('paia:team-run', ctx.run);
  teamRuns.delete(ctx.run.id);
}

function appendTurn(ctx: TeamRunContext, role: AgentTeamRole, content: string): AgentTeamTurn {
  const turn: AgentTeamTurn = {
    id: randomUUID(),
    teamRunId: ctx.run.id,
    ordinal: ctx.ordinal++,
    role,
    content,
    createdAt: Date.now(),
  };
  ctx.turns.push(turn);
  send('paia:team-turn', turn);
  return turn;
}

function memberFor(role: AgentTeamRole, run: AgentTeamRun): AgentTeamMember {
  return run.members.find((m) => m.role === role) ?? { role, model: run.members[0]?.model ?? '' };
}

function blackboardForTurn(ctx: TeamRunContext): ChatMessage[] {
  return ctx.turns.map((t) => ({
    role: 'assistant',
    content: `[${t.role.toUpperCase()}] ${t.content}`,
  }));
}

interface Plan {
  plan: { role: AgentTeamRole; task: string }[];
  notes?: string;
}

function parsePlan(raw: string): Plan | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as Plan;
    if (!Array.isArray(obj.plan)) return null;
    const cleaned = obj.plan.filter((s): s is { role: AgentTeamRole; task: string } => {
      return !!s && typeof s.task === 'string' && ['researcher', 'coder', 'reviewer', 'writer'].includes(s.role);
    });
    if (cleaned.length === 0) return null;
    return { plan: cleaned.slice(0, 6), notes: obj.notes };
  } catch {
    return null;
  }
}

function parseVerdict(raw: string): 'converged' | 'revise' | 'abort' {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return 'converged';
  try {
    const obj = JSON.parse(match[0]) as { verdict?: string };
    const v = obj.verdict ?? '';
    if (v === 'revise' || v === 'abort') return v;
    return 'converged';
  } catch {
    return 'converged';
  }
}

async function loop(ctx: TeamRunContext): Promise<void> {
  let round = 0;
  let plan: Plan | null = null;

  // Seed the blackboard with the goal so role prompts always see it.
  const seedGoal = `Goal: ${ctx.run.goal}`;

  while (!ctx.aborted && round < ctx.run.maxRounds) {
    // 1. Planner — drafts or revises the plan.
    const plannerPrompt = plan
      ? `Revise the plan based on the reviewer's feedback in the blackboard. Original goal: ${ctx.run.goal}`
      : seedGoal;
    const plannerRaw = await askRole(memberFor('planner', ctx.run), blackboardForTurn(ctx), plannerPrompt);
    appendTurn(ctx, 'planner', plannerRaw);
    const parsed = parsePlan(plannerRaw);
    if (!parsed) {
      appendTurn(ctx, 'planner', '(planner output unparseable — treating as converged plan)');
      plan = { plan: [{ role: 'writer', task: 'Just answer the goal directly.' }] };
    } else {
      plan = parsed;
    }

    // 2. Execute each step of the plan.
    for (const step of plan.plan) {
      if (ctx.aborted) return;
      if (step.role === 'reviewer') continue; // reviewer runs at round boundary
      const raw = await askRole(memberFor(step.role, ctx.run), blackboardForTurn(ctx), step.task);
      appendTurn(ctx, step.role, raw);
    }

    // 3. Reviewer.
    const reviewerRaw = await askRole(memberFor('reviewer', ctx.run), blackboardForTurn(ctx), `Review the blackboard against: ${ctx.run.goal}`);
    appendTurn(ctx, 'reviewer', reviewerRaw);
    const verdict = parseVerdict(reviewerRaw);

    if (verdict === 'converged' || verdict === 'abort') break;
    round++;
  }

  if (ctx.aborted) return;

  // 4. Writer — polish the final answer.
  const writerRaw = await askRole(
    memberFor('writer', ctx.run),
    blackboardForTurn(ctx),
    `Produce the final, polished answer for the user. Goal: ${ctx.run.goal}`,
  );
  appendTurn(ctx, 'writer', writerRaw);

  finalize(ctx, 'done', writerRaw);
}

export function abort(runId: string): boolean {
  const ctx = teamRuns.get(runId);
  if (!ctx) return false;
  ctx.aborted = true;
  finalize(ctx, 'aborted', 'User aborted the team run.');
  return true;
}

// ─── IPC ──────────────────────────────────────────────────────────

ipcMain.handle('paia:team-start', (_e, opts: StartTeamOptions) => startRun(opts));
ipcMain.handle('paia:team-abort', (_e, id: string) => abort(id));

void app;
