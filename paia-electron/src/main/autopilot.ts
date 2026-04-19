// Autopilot — turns pre-approved ambient triggers into automatic actions.
//
// The ambient watcher emits a stream of AmbientSuggestions. A user who
// trusts a specific pattern ("whenever I copy an error, research it
// and save the result as an artifact") writes a single rule and PAiA
// thereafter fires that pattern silently — still logged, still capped,
// still within an hours window, but no approval click needed.
//
// This is the "let it act" upgrade to ambient. Guardrails by design:
//   - Daily cap (0 = uncapped)
//   - Minimum seconds between fires
//   - Allowed hour-of-day window
//   - Classroom policy still gates agent/research/web tools
//   - Every fire writes an audit-log entry in userData/autopilot-fires.json
//   - Fires emit a silent OS notification so a user who tabbed away still
//     knows something happened in their name
//
// Rules are stored in userData/autopilot-rules.json so they survive
// reinstalls if the user preserves the profile.

import { app, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type {
  AmbientSuggestion,
  AutopilotFire,
  AutopilotRule,
} from '../shared/types';
import * as agent from './agent';
import * as researchSvc from './research';
import * as db from './db';
import * as settingsStore from './settings';
import * as personas from './personas';
import * as classroom from './classroom';
import * as providers from './providers';
import * as memorySvc from './memory';
import * as artifactsSvc from './artifacts';
import { redact } from '../shared/redaction';
import { notify } from './notifications';
import { requireFeature } from './license';
import { checkAndRecord } from './metering';
import { logger } from './logger';

// ─── persistence ──────────────────────────────────────────────────

function rulesPath(): string {
  return path.join(app.getPath('userData'), 'autopilot-rules.json');
}

function firesPath(): string {
  return path.join(app.getPath('userData'), 'autopilot-fires.json');
}

export function listRules(): AutopilotRule[] {
  try {
    const raw = fs.readFileSync(rulesPath(), 'utf-8');
    return JSON.parse(raw) as AutopilotRule[];
  } catch { return []; }
}

function saveRules(list: AutopilotRule[]): void {
  fs.writeFileSync(rulesPath(), JSON.stringify(list, null, 2));
}

function loadFires(): AutopilotFire[] {
  try {
    const raw = fs.readFileSync(firesPath(), 'utf-8');
    return JSON.parse(raw) as AutopilotFire[];
  } catch { return []; }
}

function pushFire(f: AutopilotFire): void {
  const all = loadFires();
  all.unshift(f);
  fs.writeFileSync(firesPath(), JSON.stringify(all.slice(0, 2000), null, 2));
}

export function listFires(): AutopilotFire[] {
  return loadFires();
}

export function saveRule(input: Partial<AutopilotRule> & { name: string }): AutopilotRule {
  requireFeature('ambient');
  const rules = listRules();
  const now = Date.now();
  const existing = input.id ? rules.find((r) => r.id === input.id) : undefined;
  const rule: AutopilotRule = {
    id: existing?.id ?? randomUUID(),
    name: input.name,
    enabled: input.enabled ?? existing?.enabled ?? true,
    match: input.match ?? existing?.match ?? { triggerKind: 'question-in-clipboard' },
    action: input.action ?? existing?.action ?? { kind: 'chat', prompt: '{{detail}}' },
    guardrails: input.guardrails ?? existing?.guardrails ?? {
      dailyCap: 20, cooldownSeconds: 60, allowedHourStart: null, allowedHourEnd: null,
    },
    createdAt: existing?.createdAt ?? now,
  };
  const next = existing ? rules.map((r) => (r.id === rule.id ? rule : r)) : [...rules, rule];
  saveRules(next);
  return rule;
}

export function deleteRule(id: string): void {
  saveRules(listRules().filter((r) => r.id !== id));
}

// ─── matching + guardrails ────────────────────────────────────────

function firesForRuleSince(ruleId: string, sinceMs: number): AutopilotFire[] {
  const cutoff = Date.now() - sinceMs;
  return loadFires().filter((f) => f.ruleId === ruleId && f.firedAt >= cutoff);
}

function withinAllowedHours(rule: AutopilotRule, now: Date = new Date()): boolean {
  const s = rule.guardrails.allowedHourStart;
  const e = rule.guardrails.allowedHourEnd;
  if (s === null || e === null) return true;
  const h = now.getHours();
  if (s <= e) return h >= s && h <= e;
  // Windows that wrap midnight, e.g. 22 → 6.
  return h >= s || h <= e;
}

function matches(rule: AutopilotRule, s: AmbientSuggestion): boolean {
  if (!rule.enabled) return false;
  if (rule.match.triggerKind !== s.kind) return false;
  const pat = rule.match.detailPattern;
  if (pat) {
    try {
      const re = new RegExp(pat);
      if (!re.test(s.detail) && !re.test(s.title)) return false;
    } catch { return false; } // invalid regex → rule never fires
  }
  return true;
}

/**
 * Returns the first rule that both matches the suggestion AND is within
 * its guardrails. Null if no rule applies (suggestion should be shown
 * to the user as a normal toast).
 */
export function find(s: AmbientSuggestion): AutopilotRule | null {
  const now = new Date();
  for (const rule of listRules()) {
    if (!matches(rule, s)) continue;
    if (!withinAllowedHours(rule, now)) continue;
    if (rule.guardrails.cooldownSeconds > 0) {
      const recent = firesForRuleSince(rule.id, rule.guardrails.cooldownSeconds * 1000);
      if (recent.length > 0) continue;
    }
    if (rule.guardrails.dailyCap > 0) {
      const dayFires = firesForRuleSince(rule.id, 24 * 60 * 60 * 1000);
      if (dayFires.length >= rule.guardrails.dailyCap) continue;
    }
    return rule;
  }
  return null;
}

// ─── execution ────────────────────────────────────────────────────

function fillTemplate(tmpl: string, s: AmbientSuggestion): string {
  return tmpl
    .replace(/\{\{\s*detail\s*\}\}/g, s.detail)
    .replace(/\{\{\s*title\s*\}\}/g, s.title)
    .replace(/\{\{\s*actionPrompt\s*\}\}/g, s.actionPrompt);
}

async function ensureScratchThread(): Promise<string> {
  const existing = db.listThreads().find((t) => t.title === 'Autopilot');
  if (existing) return existing.id;
  const s = settingsStore.load();
  const t = db.createThread('Autopilot', s.personaId, s.model || null);
  return t.id;
}

export async function fire(rule: AutopilotRule, suggestion: AmbientSuggestion): Promise<AutopilotFire> {
  const settings = settingsStore.load();
  const prompt = fillTemplate(rule.action.prompt, suggestion);
  try { checkAndRecord('autopilot-fire'); }
  catch (err) {
    // On a free user who hit the daily autopilot cap, we just log it
    // and skip — firing autopilot shouldn't spam upgrade modals.
    logger.info(`autopilot capped: ${err instanceof Error ? err.message : String(err)}`);
    return {
      id: '', ruleId: rule.id, ruleName: rule.name, suggestionId: suggestion.id,
      firedAt: Date.now(), ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  const fireEntry: AutopilotFire = {
    id: randomUUID(),
    ruleId: rule.id,
    ruleName: rule.name,
    suggestionId: suggestion.id,
    firedAt: Date.now(),
    ok: false,
  };
  try {
    if (rule.action.kind === 'agent') {
      if (classroom.currentPolicy() && !classroom.currentPolicy()!.allowAgent) {
        throw new Error('Classroom policy disallows agent runs.');
      }
      const threadId = await ensureScratchThread();
      await agent.startRun({
        threadId,
        goal: prompt,
        model: settings.model,
        autonomy: settings.agentAutonomy,
        stepBudget: settings.agentStepBudget,
      });
    } else if (rule.action.kind === 'research') {
      const threadId = await ensureScratchThread();
      await researchSvc.startRun({ threadId, question: prompt, model: settings.model });
    } else if (rule.action.kind === 'canvas') {
      artifactsSvc.create(null, `Autopilot: ${suggestion.title}`.slice(0, 80), 'markdown', 'md', prompt);
    } else {
      // chat — one-shot through the provider, persist into the Autopilot thread.
      const threadId = await ensureScratchThread();
      const persona = personas.listPersonas().find((p) => p.id === settings.personaId) ?? personas.listPersonas()[0];
      let systemPrompt = persona?.systemPrompt ?? 'You are a helpful assistant.';
      try {
        const mem = await memorySvc.buildContextBlock(prompt);
        if (mem) systemPrompt += '\n\n' + mem;
      } catch { /* ignore */ }
      const redacted = redact(prompt);
      db.addMessage(threadId, 'user', redacted.redacted, redacted.matchCount);
      const history = db.listMessages(threadId);
      const messages = [
        { role: 'system' as const, content: systemPrompt },
        ...history.map((m) => ({ role: m.role, content: m.content })),
      ];
      const text = await providers.chat(settings.model, messages, () => { /* no UI stream here */ });
      db.addMessage(threadId, 'assistant', text, 0);
    }
    fireEntry.ok = true;
  } catch (err) {
    fireEntry.ok = false;
    fireEntry.error = err instanceof Error ? err.message : String(err);
    logger.warn(`autopilot: rule "${rule.name}" failed`, fireEntry.error);
  }
  pushFire(fireEntry);
  notify({
    title: `Autopilot: ${rule.name}`,
    body: fireEntry.ok ? `Fired on: ${suggestion.title}` : `Failed: ${fireEntry.error}`,
    silent: fireEntry.ok,
  });
  return fireEntry;
}

// ─── IPC ──────────────────────────────────────────────────────────

ipcMain.handle('paia:autopilot-list', () => listRules());
ipcMain.handle('paia:autopilot-fires', () => listFires());
ipcMain.handle('paia:autopilot-save', (_e, rule: Partial<AutopilotRule> & { name: string }) => saveRule(rule));
ipcMain.handle('paia:autopilot-delete', (_e, id: string) => deleteRule(id));
