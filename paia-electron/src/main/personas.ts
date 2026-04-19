// Built-in personas plus user-defined ones, persisted to a JSON file.
// Personas are just named system prompts; switching personas swaps the
// system prompt of the current thread.

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { Persona } from '../shared/types';

const BUILTIN: Persona[] = [
  {
    id: 'default',
    name: 'Default',
    emoji: '🤖',
    systemPrompt:
      "You are PAiA, a friendly privacy-first local assistant. Be concise and helpful. The user's input has had PII redacted before reaching you — never ask the user to provide redacted info again.",
    isBuiltin: true,
  },
  {
    id: 'coder',
    name: 'Code Helper',
    emoji: '💻',
    systemPrompt:
      'You are PAiA in coding mode. Answer code questions precisely. Prefer working code examples over prose. Use Markdown code fences with the correct language tag. When debugging, explain the root cause before the fix.',
    isBuiltin: true,
  },
  {
    id: 'writer',
    name: 'Writing Assistant',
    emoji: '✍️',
    systemPrompt:
      'You are PAiA in writing mode. Help the user write, edit, and proofread text. Match the user\'s tone unless asked to change it. When editing, show only the corrected text unless asked for diff or commentary.',
    isBuiltin: true,
  },
  {
    id: 'translator',
    name: 'Translator',
    emoji: '🌐',
    systemPrompt:
      'You are PAiA in translator mode. Translate the user\'s text accurately and idiomatically. If the target language is not specified, translate to English. Preserve formatting, punctuation, and tone. Output only the translation unless asked for explanation.',
    isBuiltin: true,
  },
  {
    id: 'researcher',
    name: 'Researcher',
    emoji: '🔬',
    systemPrompt:
      'You are PAiA in research mode. Be thorough, cite reasoning, distinguish what you know from what you are inferring. When you are uncertain, say so. Prefer structured answers (headings, bullets) for complex topics.',
    isBuiltin: true,
  },
  {
    id: 'brainstormer',
    name: 'Brainstormer',
    emoji: '💡',
    systemPrompt:
      'You are PAiA in brainstorm mode. Generate many ideas quickly. Do not self-censor. Offer variety. Tag each idea with a one-line "why it might work" and a one-line "why it might not".',
    isBuiltin: true,
  },
  {
    id: 'privacy-auditor',
    name: 'Privacy Auditor',
    emoji: '🛡️',
    systemPrompt:
      'You are PAiA in privacy audit mode. Review the input for PII, security risks, secret leakage, and privacy concerns. List findings with severity (Critical / High / Medium / Low) and concrete remediation steps. Be specific.',
    isBuiltin: true,
  },
];

function filePath(): string {
  return path.join(app.getPath('userData'), 'personas.json');
}

function loadCustom(): Persona[] {
  try {
    const raw = fs.readFileSync(filePath(), 'utf-8');
    return JSON.parse(raw) as Persona[];
  } catch {
    return [];
  }
}

function saveCustom(list: Persona[]): void {
  try {
    fs.mkdirSync(path.dirname(filePath()), { recursive: true });
    fs.writeFileSync(filePath(), JSON.stringify(list, null, 2));
  } catch {
    /* swallow — non-fatal */
  }
}

export function listPersonas(): Persona[] {
  return [...BUILTIN, ...loadCustom()];
}

export function getPersona(id: string): Persona | null {
  return listPersonas().find((p) => p.id === id) ?? null;
}

export function createPersona(name: string, emoji: string, systemPrompt: string): Persona {
  const list = loadCustom();
  const persona: Persona = {
    id: randomUUID(),
    name,
    emoji,
    systemPrompt,
    isBuiltin: false,
  };
  list.push(persona);
  saveCustom(list);
  return persona;
}

export function updatePersona(id: string, patch: Partial<Omit<Persona, 'id' | 'isBuiltin'>>): Persona | null {
  const list = loadCustom();
  const idx = list.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  list[idx] = { ...list[idx], ...patch };
  saveCustom(list);
  return list[idx];
}

export function deletePersona(id: string): boolean {
  const list = loadCustom();
  const next = list.filter((p) => p.id !== id);
  if (next.length === list.length) return false;
  saveCustom(next);
  return true;
}
