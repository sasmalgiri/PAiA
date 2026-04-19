// Ported from PAiA.WinUI/Services/Redaction/RedactionService.cs
// All patterns run locally — nothing leaves the machine.

import type { RedactionResult } from './types';

interface Rule {
  category: string;
  pattern: RegExp;
  replacement: string;
}

const RULES: Rule[] = [
  { category: 'card',        pattern: /\b(?:\d[ -]*?){13,19}\b/g,                                      replacement: '[CARD-REDACTED]' },
  { category: 'ssn',         pattern: /\b\d{3}-\d{2}-\d{4}\b/g,                                         replacement: '[SSN-REDACTED]' },
  { category: 'email',       pattern: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,          replacement: '[EMAIL-REDACTED]' },
  { category: 'phone',       pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,       replacement: '[PHONE-REDACTED]' },
  { category: 'ip',          pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,                                   replacement: '[IP-REDACTED]' },
  { category: 'aws',         pattern: /\bAKIA[0-9A-Z]{16}\b/g,                                          replacement: '[AWS-KEY-REDACTED]' },
  { category: 'github',      pattern: /\bgh[ps]_[A-Za-z0-9_]{36,255}\b/g,                               replacement: '[GITHUB-TOKEN-REDACTED]' },
  { category: 'apiKey',      pattern: /(?:api[_-]?key|apikey|secret[_-]?key|access[_-]?token)\s*[:=]\s*["']?[\w\-]{20,}["']?/gi, replacement: '[API-KEY-REDACTED]' },
  { category: 'jwt',         pattern: /\beyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_.+/=]+\b/g, replacement: '[JWT-REDACTED]' },
  { category: 'privateKey',  pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA )?PRIVATE KEY-----/g, replacement: '[PRIVATE-KEY-REDACTED]' },
  { category: 'connString',  pattern: /(?:server|data source|host)=[^;]+;[\s\S]*?(?:password|pwd)=[^;]+/gi, replacement: '[CONN-STRING-REDACTED]' },
];

export function redact(text: string): RedactionResult {
  if (!text) {
    return { redacted: text ?? '', matchCount: 0, categories: {} };
  }

  const categories: Record<string, number> = {};
  let result = text;
  let total = 0;

  for (const rule of RULES) {
    const matches = result.match(rule.pattern);
    const count = matches?.length ?? 0;
    if (count > 0) {
      categories[rule.category] = (categories[rule.category] ?? 0) + count;
      total += count;
      result = result.replace(rule.pattern, rule.replacement);
    }
  }

  return { redacted: result, matchCount: total, categories };
}

export function countMatches(text: string): number {
  return redact(text).matchCount;
}
