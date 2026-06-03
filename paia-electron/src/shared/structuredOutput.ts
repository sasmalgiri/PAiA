// Pure JSON extraction + validation primitives for the structured-output
// shim. Lives in /shared so it can be unit-tested without booting
// Electron and reused by both main and renderer.
//
// Small models (Llama 3.2:3b, Qwen 2.5 3B, Phi 3.5) often wrap the JSON
// they're asked for in:
//   - markdown fences (```json {...} ``` or just ``` {...} ```)
//   - prose preamble ("Here's the JSON: {...}")
//   - prose postamble ("{...} Let me know if you'd like anything else.")
//   - both prose and fences
// `extractJson()` tolerates all of these. `validateAgainst()` does a
// shape check against a minimal schema spec — enough to catch the
// most common failure modes without pulling in a real validator.

/**
 * Best-effort JSON extraction. Strips markdown fences, finds the largest
 * balanced object or array (by greedy bracket matching), parses it,
 * and returns the parsed value or null.
 *
 * We deliberately don't reach into nested cases the way a proper grammar
 * would — for the contracts the router/agent/team modules use, a single
 * top-level object is enough.
 */
export function extractJson(raw: string): unknown | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;

  // 1. Strip common markdown fences like ```json … ``` or ``` … ```.
  let s = raw.trim();
  const fence = s.match(/^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/);
  if (fence) s = fence[1].trim();

  // 2. Find the first { or [ and balance to its matching close.
  const candidates: string[] = [];
  for (const open of ['{', '['] as const) {
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let start = -1;
    let inString = false;
    let escape = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (escape) { escape = false; continue; }
      if (inString) {
        if (ch === '\\') escape = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === open) {
        if (depth === 0) start = i;
        depth++;
      } else if (ch === close) {
        depth--;
        if (depth === 0 && start >= 0) {
          candidates.push(s.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }

  // 3. Try each candidate, prefer the longest (covers nested cases).
  candidates.sort((a, b) => b.length - a.length);
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      /* try next */
    }
  }
  // 4. Last resort: try the whole string. Catches the "already-pure-JSON"
  // happy case the loop above also covers, but with no overhead.
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export type SchemaShape =
  | { kind: 'string' }
  | { kind: 'number' }
  | { kind: 'boolean' }
  | { kind: 'enum'; values: readonly string[] }
  | { kind: 'array'; items: SchemaShape }
  | { kind: 'object'; fields: Record<string, { schema: SchemaShape; required?: boolean }> }
  | { kind: 'optional'; inner: SchemaShape };

export interface ValidationFailure {
  ok: false;
  path: string;       // e.g. "personaIds[2]" or "difficulty"
  reason: string;
}

export interface ValidationSuccess<T> {
  ok: true;
  value: T;
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

/**
 * Minimal shape validator. Returns the value on success or a failure
 * with a human-readable path + reason. The path is fed back to the LLM
 * in the retry prompt so it knows exactly which field to fix.
 */
export function validateAgainst<T = unknown>(value: unknown, schema: SchemaShape, path = ''): ValidationResult<T> {
  switch (schema.kind) {
    case 'string':
      return typeof value === 'string'
        ? { ok: true, value: value as T }
        : { ok: false, path, reason: `expected string, got ${typeof value}` };
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? { ok: true, value: value as T }
        : { ok: false, path, reason: `expected number, got ${typeof value}` };
    case 'boolean':
      return typeof value === 'boolean'
        ? { ok: true, value: value as T }
        : { ok: false, path, reason: `expected boolean, got ${typeof value}` };
    case 'enum':
      return typeof value === 'string' && schema.values.includes(value)
        ? { ok: true, value: value as T }
        : { ok: false, path, reason: `expected one of ${JSON.stringify(schema.values)}, got ${JSON.stringify(value)}` };
    case 'array': {
      if (!Array.isArray(value)) {
        return { ok: false, path, reason: `expected array, got ${typeof value}` };
      }
      for (let i = 0; i < value.length; i++) {
        const r = validateAgainst(value[i], schema.items, `${path}[${i}]`);
        if (!r.ok) return r;
      }
      return { ok: true, value: value as T };
    }
    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return { ok: false, path, reason: `expected object, got ${Array.isArray(value) ? 'array' : typeof value}` };
      }
      const obj = value as Record<string, unknown>;
      for (const [key, { schema: subSchema, required }] of Object.entries(schema.fields)) {
        const fieldPath = path ? `${path}.${key}` : key;
        if (!(key in obj) || obj[key] === undefined) {
          if (required === false) continue;
          return { ok: false, path: fieldPath, reason: 'missing required field' };
        }
        const r = validateAgainst(obj[key], subSchema, fieldPath);
        if (!r.ok) return r;
      }
      return { ok: true, value: value as T };
    }
    case 'optional':
      if (value === undefined || value === null) return { ok: true, value: undefined as T };
      return validateAgainst(value, schema.inner, path);
  }
}

/**
 * Builds a human-readable schema description for the retry prompt.
 * The shape isn't JSON-schema-spec — it's whatever helps a 3B model
 * understand what's wanted.
 */
export function describeSchema(schema: SchemaShape, indent = 0): string {
  const pad = '  '.repeat(indent);
  switch (schema.kind) {
    case 'string': return 'string';
    case 'number': return 'number';
    case 'boolean': return 'boolean';
    case 'enum': return schema.values.map((v) => `"${v}"`).join(' | ');
    case 'array': return `${describeSchema(schema.items, indent)}[]`;
    case 'optional': return `${describeSchema(schema.inner, indent)} (optional)`;
    case 'object': {
      const lines = Object.entries(schema.fields).map(([k, { schema: s, required }]) => {
        const opt = required === false ? '?' : '';
        return `${pad}  "${k}"${opt}: ${describeSchema(s, indent + 1)}`;
      });
      return `{\n${lines.join(',\n')}\n${pad}}`;
    }
  }
}
