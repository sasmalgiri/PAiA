// Agent orchestrator.
//
// Wraps the provider-streamed LLM with a multi-step "plan → act → observe"
// loop. Each iteration:
//
//   1. Ask the LLM for its next action given the current transcript. The
//      model must respond with either:
//        {"tool": "tool.name", "args": {...}}       — to invoke a tool
//        {"final": "answer text"}                   — to stop
//        {"thought": "…"}                           — a free-form thinking
//                                                      step with no tool call
//   2. If a tool call: request approval (unless auto-approve fits), run
//      the tool, append the observation to the transcript.
//   3. Repeat until budget exhausted, final answer reached, or the user
//      aborts.
//
// Every step — plan, tool call, observation — is streamed to the renderer
// via `paia:agent-step` and persisted in `agent_steps` so the UI can
// reconstruct the trace on reload.
//
// Autonomy modes (from Settings):
//   manual      — every tool call requires explicit approval in the UI
//   assisted    — safe + low-risk tools auto-approve; medium/high prompt
//   autonomous  — everything auto-approves except 'high' risk
//
// The approval mechanism shares its IPC surface with MCP approvals so the
// existing modal handles both.

import { app, ipcMain, BrowserWindow } from 'electron';
import { randomUUID } from 'crypto';
import type {
  AgentAutonomy,
  AgentRun,
  AgentStep,
  AgentApprovalRequest,
  ChatMessage,
  ToolDefinition,
} from '../shared/types';
import * as db from './db';
import * as tools from './tools';
import * as mcp from './mcp';
import * as providers from './providers';
import * as settingsStore from './settings';
import * as memory from './memory';
import * as connectors from './connectors';
import * as classroom from './classroom';
import * as plugins from './plugins';
import { browserTools } from './browserAgent';
import { remoteBrowserTools } from './remoteBrowser';
import { mediaTools } from './media';
import { notify } from './notifications';
import { requireFeature } from './license';
import { checkAndRecord } from './metering';
import { logger } from './logger';

// ─── runtime state ────────────────────────────────────────────────

interface RunContext {
  run: AgentRun;
  stepOrdinal: number;
  aborted: boolean;
  transcript: ChatMessage[];
  /** Headless mode — skip interactive approvals. Set by scheduled runs
   *  and other non-interactive entry points. */
  bypassApproval: boolean;
}

const runs = new Map<string, RunContext>();
let activeWindow: BrowserWindow | null = null;

const pendingApprovals = new Map<
  string,
  { resolve: (allowed: boolean) => void; runId: string; tool: string }
>();

export function setActiveWindow(win: BrowserWindow): void {
  activeWindow = win;
}

function send(channel: string, payload: unknown): void {
  activeWindow?.webContents.send(channel, payload);
}

// ─── approval ──────────────────────────────────────────────────────

function shouldAutoApprove(
  autonomy: AgentAutonomy,
  risk: ToolDefinition['risk'],
): boolean {
  if (autonomy === 'manual') return false;
  if (autonomy === 'assisted') return risk === 'safe' || risk === 'low';
  // autonomous
  return risk !== 'high';
}

function requestApproval(
  runId: string,
  tool: string,
  description: string,
  args: Record<string, unknown>,
  risk: ToolDefinition['risk'],
): Promise<boolean> {
  return new Promise((resolve) => {
    const requestId = randomUUID();
    pendingApprovals.set(requestId, { resolve, runId, tool });
    const req: AgentApprovalRequest = { requestId, runId, tool, description, args, risk };
    send('paia:agent-approval', req);
  });
}

ipcMain.handle('paia:agent-approve', (_e, p: { requestId: string; allow: boolean }) => {
  const pending = pendingApprovals.get(p.requestId);
  if (!pending) return;
  pendingApprovals.delete(p.requestId);
  pending.resolve(p.allow);
});

// ─── tool registry (built-ins + MCP) ───────────────────────────────

interface UnifiedTool {
  definition: ToolDefinition;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

function collectTools(): UnifiedTool[] {
  const all: UnifiedTool[] = [];
  for (const t of tools.builtInTools) {
    all.push({ definition: t.definition, execute: (a) => t.execute(a) });
  }
  for (const t of browserTools) {
    all.push({ definition: t.definition, execute: (a) => t.execute(a) });
  }
  for (const t of remoteBrowserTools) {
    all.push({ definition: t.definition, execute: (a) => t.execute(a) });
  }
  for (const t of mediaTools) {
    all.push({ definition: t.definition, execute: (a) => t.execute(a) });
  }
  for (const t of connectors.connectorTools()) {
    all.push({ definition: t.definition, execute: (a) => t.execute(a) });
  }
  for (const t of plugins.contributedTools()) {
    all.push({ definition: t.definition, execute: (a) => t.execute(a) });
  }
  for (const t of mcp.listAllTools()) {
    const def: ToolDefinition = {
      name: `mcp.${t.serverName.replace(/[^\w]/g, '_')}.${t.name}`,
      description: t.description || `MCP tool from ${t.serverName}`,
      category: 'mcp',
      risk: 'medium',
      inputSchema: t.inputSchema,
    };
    all.push({
      definition: def,
      execute: async (args) => {
        const res = await mcp.callTool(t.serverId, t.name, args);
        if (!res.ok) throw new Error(res.error ?? 'MCP tool failed');
        return res.content ?? '';
      },
    });
  }
  return all;
}

// ─── planner prompt ────────────────────────────────────────────────

function planningSystemPrompt(toolDefs: ToolDefinition[], goal: string, autonomy: AgentAutonomy): string {
  const toolList = toolDefs
    .map((t) => {
      const schema = JSON.stringify(t.inputSchema);
      return `- ${t.name} [${t.risk}] — ${t.description}\n  args: ${schema}`;
    })
    .join('\n');

  return [
    'You are PAiA in Agent mode — a careful, systematic assistant that uses tools to accomplish the user\'s goal.',
    '',
    `User goal: ${goal}`,
    `Autonomy: ${autonomy}`,
    '',
    'You operate in a "plan → act → observe" loop. At every turn you reply with EXACTLY ONE JSON object and nothing else. Valid shapes:',
    '',
    '  {"thought": "short plan or reasoning", "tool": "<tool.name>", "args": { ... }}',
    '  {"thought": "brief reflection", "final": "the finished answer for the user"}',
    '',
    'Rules:',
    '  1. Always emit a single JSON object. No markdown fences, no prose before or after.',
    '  2. If you have enough information to answer, use "final".',
    '  3. Otherwise, call one tool whose output will bring you closer to the goal.',
    '  4. Never fabricate tool output — wait for the observation.',
    '  5. Keep "thought" short (≤ 40 words).',
    '  6. If a tool returns an error, try a different approach; don\'t retry the same call.',
    '  7. If your goal requires asking the user a clarifying question, emit "final" with the question.',
    '',
    'Available tools:',
    toolList,
  ].join('\n');
}

function parseAgentReply(raw: string): { thought?: string; tool?: string; args?: Record<string, unknown>; final?: string } | null {
  // Strip common noise (```json fences, leading/trailing whitespace).
  let cleaned = raw.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) cleaned = fenceMatch[1].trim();

  // Find the outermost { … } block if the model added prose.
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  try {
    const obj = JSON.parse(cleaned) as Record<string, unknown>;
    const out: { thought?: string; tool?: string; args?: Record<string, unknown>; final?: string } = {};
    if (typeof obj.thought === 'string') out.thought = obj.thought;
    if (typeof obj.final === 'string') out.final = obj.final;
    if (typeof obj.tool === 'string') out.tool = obj.tool;
    if (obj.args && typeof obj.args === 'object') out.args = obj.args as Record<string, unknown>;
    if (!out.tool && !out.final && !out.thought) return null;
    return out;
  } catch {
    return null;
  }
}

// ─── main loop ─────────────────────────────────────────────────────

export interface StartAgentOptions {
  threadId: string;
  goal: string;
  model: string;
  autonomy?: AgentAutonomy;
  stepBudget?: number;
  /** Extra context the caller wants inlined ahead of the goal (screen OCR, user text). */
  extraContext?: string;
  /**
   * Skip the interactive approval UI for every tool call. Intended for
   * scheduled / headless runs — the user is not at the keyboard and the
   * default behaviour of blocking on approval would deadlock the run.
   * Does NOT override classroom policy or autonomy tier: high-risk tools
   * still require autonomy ≥ 'autonomous' to be chosen at all.
   */
  bypassApproval?: boolean;
}

export async function startRun(opts: StartAgentOptions): Promise<AgentRun> {
  // Tier gate — agent mode is Pro+. Metering is a no-op for Pro/Team/trial.
  requireFeature('agent');
  checkAndRecord('agent-run');

  const classroomPolicy = classroom.currentPolicy();
  if (classroomPolicy && !classroomPolicy.allowAgent) {
    throw new Error('Agent mode is disabled by your classroom policy.');
  }

  const settings = settingsStore.load();
  const autonomy = opts.autonomy ?? settings.agentAutonomy;
  const stepBudget = Math.min(Math.max(opts.stepBudget ?? settings.agentStepBudget, 1), 50);

  const run: AgentRun = db.createAgentRun({
    id: randomUUID(),
    threadId: opts.threadId,
    goal: opts.goal,
    model: opts.model,
    autonomy,
    stepBudget,
  });

  const toolDefs = collectTools().map((t) => t.definition);
  const memoryContext = await memory.buildContextBlock(opts.goal).catch(() => '');
  const systemPrompt = [
    planningSystemPrompt(toolDefs, opts.goal, autonomy),
    memoryContext,
    opts.extraContext ? `\nUser-supplied context:\n${opts.extraContext}` : '',
  ].filter(Boolean).join('\n\n');

  const transcript: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: opts.goal },
  ];

  const ctx: RunContext = {
    run,
    stepOrdinal: 0,
    aborted: false,
    transcript,
    bypassApproval: !!opts.bypassApproval,
  };
  runs.set(run.id, ctx);
  send('paia:agent-run', run);

  // Run async so IPC can return immediately.
  void loop(ctx).catch((err) => {
    logger.error('agent loop crashed', err);
    finalize(ctx, 'error', err instanceof Error ? err.message : String(err));
  });

  return run;
}

async function loop(ctx: RunContext): Promise<void> {
  const allTools = collectTools();
  const handlerMap = new Map(allTools.map((t) => [t.definition.name, t]));

  while (!ctx.aborted && ctx.stepOrdinal < ctx.run.stepBudget) {
    // 1. Ask the LLM for the next step.
    let raw = '';
    try {
      raw = await providers.chat(ctx.run.model, ctx.transcript, (token) => {
        // Forward tokens for the "thinking" UI.
        send('paia:agent-token', { runId: ctx.run.id, token });
      });
    } catch (err) {
      finalize(ctx, 'error', `Model call failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    const parsed = parseAgentReply(raw);
    if (!parsed) {
      appendStep(ctx, 'error', `Could not parse model reply as JSON:\n${raw}`);
      // Nudge the model and try once more on the next iteration.
      ctx.transcript.push({ role: 'assistant', content: raw });
      ctx.transcript.push({
        role: 'user',
        content:
          'Your previous reply was not valid JSON. Reply again with EXACTLY ONE JSON object matching the format above.',
      });
      continue;
    }

    // Record the assistant's reply verbatim so the LLM sees its own prior output.
    ctx.transcript.push({ role: 'assistant', content: raw });

    // 2. Final answer?
    if (parsed.final) {
      if (parsed.thought) appendStep(ctx, 'thought', parsed.thought);
      appendStep(ctx, 'final', parsed.final);
      finalize(ctx, 'done', parsed.final);
      return;
    }

    // 3. Tool call.
    if (parsed.tool) {
      if (parsed.thought) appendStep(ctx, 'thought', parsed.thought);
      const handler = handlerMap.get(parsed.tool);
      if (!handler) {
        appendStep(ctx, 'error', `Unknown tool: ${parsed.tool}`);
        ctx.transcript.push({
          role: 'user',
          content: `Observation: No such tool "${parsed.tool}". Available tools are listed above.`,
        });
        continue;
      }

      const args = parsed.args ?? {};

      // Classroom policy check — if we're a student and this tool is
      // disabled by the active session, short-circuit before approval.
      const blockReason = classroom.checkToolAllowed(parsed.tool, handler.definition.category);
      if (blockReason) {
        appendStep(ctx, 'tool', `Blocked by classroom policy: ${blockReason}`, {
          name: parsed.tool,
          args,
          error: blockReason,
          approved: false,
          durationMs: 0,
        });
        ctx.transcript.push({
          role: 'user',
          content: `Observation for ${parsed.tool}: ${blockReason} Pick a different approach.`,
        });
        continue;
      }

      const autoApprove =
        ctx.bypassApproval ||
        shouldAutoApprove(ctx.run.autonomy, handler.definition.risk);
      let approved = autoApprove;
      if (!autoApprove) {
        db.updateAgentRun(ctx.run.id, { status: 'awaiting-approval' });
        send('paia:agent-run', { ...ctx.run, status: 'awaiting-approval' });
        approved = await requestApproval(
          ctx.run.id,
          parsed.tool,
          handler.definition.description,
          args,
          handler.definition.risk,
        );
        db.updateAgentRun(ctx.run.id, { status: ctx.aborted ? 'aborted' : 'running' });
      }
      if (ctx.aborted) return;

      if (!approved) {
        const step = appendStep(ctx, 'tool', `Denied: ${parsed.tool}`, {
          name: parsed.tool,
          args,
          error: 'user denied',
          approved: false,
          durationMs: 0,
        });
        ctx.transcript.push({
          role: 'user',
          content: `Observation for ${parsed.tool}: the user denied the call. Try a different approach or ask them what to do.`,
        });
        void step;
        continue;
      }

      const t0 = Date.now();
      let result = '';
      let error: string | undefined;
      try {
        result = await handler.execute(args);
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
      const durationMs = Date.now() - t0;

      appendStep(ctx, 'tool', result || error || '', {
        name: parsed.tool,
        args,
        result,
        error,
        approved: true,
        durationMs,
      });

      ctx.transcript.push({
        role: 'user',
        content: error
          ? `Observation (error) for ${parsed.tool}: ${error}`
          : `Observation for ${parsed.tool}:\n${truncate(result, 6000)}`,
      });
      continue;
    }

    // 4. Bare thought, no tool, no final — nudge forward.
    if (parsed.thought) {
      appendStep(ctx, 'thought', parsed.thought);
      ctx.transcript.push({
        role: 'user',
        content:
          'Continue. Emit either {"tool": ..., "args": ...} for the next action, or {"final": ...} if you are done.',
      });
    }
  }

  if (!ctx.aborted) {
    finalize(ctx, 'done', 'Step budget exhausted before the agent produced a final answer.');
  }
}

// ─── step / finalize helpers ───────────────────────────────────────

function appendStep(
  ctx: RunContext,
  kind: AgentStep['kind'],
  content: string,
  tool?: AgentStep['tool'],
): AgentStep {
  const step: AgentStep = {
    id: randomUUID(),
    runId: ctx.run.id,
    ordinal: ctx.stepOrdinal++,
    kind,
    content,
    tool,
    createdAt: Date.now(),
  };
  db.addAgentStep(step);
  send('paia:agent-step', step);
  return step;
}

function finalize(ctx: RunContext, status: AgentRun['status'], summary: string): void {
  ctx.run.status = status;
  ctx.run.endedAt = Date.now();
  ctx.run.summary = summary;
  db.updateAgentRun(ctx.run.id, {
    status,
    endedAt: ctx.run.endedAt,
    summary,
  });
  send('paia:agent-run', ctx.run);
  runs.delete(ctx.run.id);

  // Terminal events → native notification so the user knows a long-running
  // autonomous run finished even if they've tabbed away.
  if (status === 'done') {
    notify({
      title: 'PAiA agent finished',
      body: summary.slice(0, 160),
      silent: true,
    });
  } else if (status === 'error') {
    notify({
      title: 'PAiA agent failed',
      body: summary.slice(0, 160),
    });
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n…[truncated, ${text.length - max} more chars]`;
}

// ─── public controls ───────────────────────────────────────────────

export function abort(runId: string): boolean {
  const ctx = runs.get(runId);
  if (!ctx) return false;
  ctx.aborted = true;
  // Resolve any outstanding approval so the loop unblocks.
  for (const [requestId, pending] of pendingApprovals.entries()) {
    if (pending.runId === runId) {
      pendingApprovals.delete(requestId);
      pending.resolve(false);
    }
  }
  finalize(ctx, 'aborted', 'User aborted the run.');
  return true;
}

export function listTools(): ToolDefinition[] {
  return collectTools().map((t) => t.definition);
}

export function getRun(runId: string): AgentRun | undefined {
  return runs.get(runId)?.run ?? db.listAgentRuns().find((r) => r.id === runId);
}

// ─── IPC ───────────────────────────────────────────────────────────

ipcMain.handle('paia:agent-start', (_e, opts: StartAgentOptions) => startRun(opts));
ipcMain.handle('paia:agent-abort', (_e, runId: string) => abort(runId));
ipcMain.handle('paia:agent-list-tools', () => listTools());
ipcMain.handle('paia:agent-list-runs', (_e, threadId?: string) => db.listAgentRuns(threadId));
ipcMain.handle('paia:agent-list-steps', (_e, runId: string) => db.listAgentSteps(runId));

void app; // silence unused import when app is not needed directly
