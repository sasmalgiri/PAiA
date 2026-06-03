// Structured-output retry wrapper.
//
// Wraps providers.chat() with a JSON-schema-enforcing retry loop so the
// caller can rely on getting a typed object back regardless of which
// underlying model the user has configured.
//
// Strategy:
//   1. First call uses format: 'json' if provider supports it (Ollama
//      does — it constrains sampling to valid JSON). The system prompt
//      also embeds the schema in plain-English form (describeSchema).
//   2. If the result fails to parse OR fails schema validation, we retry
//      up to maxAttempts times. Each retry adds the previous bad output
//      and the specific failure path to the user prompt:
//        "Your previous response wasn't valid. Specifically: <reason>
//         at <path>. The schema is: <description>. Try again."
//   3. If all attempts fail, throw with the last failure reason.
//
// Tested via the pure src/shared/structuredOutput primitives — the
// retry loop itself is exercised by integration paths (personaRouter,
// agent tool calls).

import * as providers from './providers';
import { logger } from './logger';
import {
  extractJson,
  validateAgainst,
  describeSchema,
  type SchemaShape,
} from '../shared/structuredOutput';
import type { ChatMessage } from '../shared/types';

export interface RequestJsonOptions {
  model: string;
  system: string;
  user: string;
  schema: SchemaShape;
  maxAttempts?: number;
  /** When true, providers that support format-constrained output use it. */
  useJsonFormat?: boolean;
}

export interface RequestJsonResult<T> {
  value: T;
  attempts: number;
  rawResponses: string[];
}

const DEFAULT_MAX_ATTEMPTS = 3;

function isOllamaModel(model: string): boolean {
  // Same heuristic as providers.parseQualified: anything without a known
  // cloud prefix is Ollama.
  return !/^(openai|anthropic|openai-compatible):/.test(model);
}

export async function requestJson<T>(opts: RequestJsonOptions): Promise<RequestJsonResult<T>> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const schemaHint = describeSchema(opts.schema);
  const useJsonFormat = opts.useJsonFormat !== false && isOllamaModel(opts.model);

  const baseSystem = `${opts.system}\n\nReturn ONLY a single JSON object matching this schema:\n${schemaHint}\nNo markdown fences, no prose.`;

  const rawResponses: string[] = [];
  let lastFailure = '';
  let lastPath = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const messages: ChatMessage[] = [{ role: 'system', content: baseSystem }];

    if (attempt === 1) {
      messages.push({ role: 'user', content: opts.user });
    } else {
      // Self-correction prompt: feed back the previous bad output + path.
      const corrective = [
        opts.user,
        '',
        `Your previous response failed validation:`,
        `  path: ${lastPath || '(root)'}`,
        `  reason: ${lastFailure}`,
        '',
        `The previous response was:`,
        rawResponses[rawResponses.length - 1] ?? '(empty)',
        '',
        `Return ONLY a corrected JSON object matching the schema. No markdown, no prose.`,
      ].join('\n');
      messages.push({ role: 'user', content: corrective });
    }

    let raw = '';
    try {
      raw = await providers.chat(
        opts.model,
        messages,
        () => { /* discard tokens — we just want the final string */ },
        useJsonFormat ? { format: 'json' } : undefined,
      );
    } catch (err) {
      lastFailure = err instanceof Error ? err.message : String(err);
      lastPath = '';
      logger.warn(`structuredOutput: provider call failed on attempt ${attempt}: ${lastFailure}`);
      continue;
    }
    rawResponses.push(raw);

    const parsed = extractJson(raw);
    if (parsed === null) {
      lastFailure = 'response did not contain valid JSON';
      lastPath = '';
      continue;
    }
    const v = validateAgainst<T>(parsed, opts.schema);
    if (v.ok) {
      return { value: v.value, attempts: attempt, rawResponses };
    }
    lastFailure = v.reason;
    lastPath = v.path;
  }

  throw new Error(
    `structuredOutput: gave up after ${maxAttempts} attempts. Last failure: ${lastFailure}${lastPath ? ` at "${lastPath}"` : ''}.`,
  );
}
