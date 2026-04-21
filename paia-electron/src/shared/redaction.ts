// Ported from PAiA.WinUI/Services/Redaction/RedactionService.cs
// All patterns run locally — nothing leaves the machine.

import type { RedactionResult } from './types';

interface Rule {
  category: string;
  pattern: RegExp;
  replacement: string;
  /** Optional post-match validator. Return false to reject a candidate
   *  match (prevents false-positives from loose regexes). Called with the
   *  matched substring. */
  validate?: (m: string) => boolean;
}

// ── Validators for high-false-positive patterns ────────────────────

// Luhn check. Strips spaces/dashes first so it works on the raw match.
function luhn(raw: string): boolean {
  const digits = raw.replace(/[^\d]/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

// Card validator = Luhn + a known-issuer BIN prefix. This kills the big
// ISBN / tracking-number false-positive bucket (library catalog refs,
// UPS/FedEx numbers) without needing every BIN on earth.
function isProbableCard(raw: string): boolean {
  const d = raw.replace(/[^\d]/g, '');
  if (!luhn(d)) return false;
  // Visa / MC / Amex / Discover / Diners / JCB / UnionPay prefixes.
  if (/^4/.test(d)) return d.length === 13 || d.length === 16 || d.length === 19;
  if (/^5[1-5]/.test(d) || /^2(2[2-9]|[3-6]|7[01]|720)/.test(d)) return d.length === 16;
  if (/^3[47]/.test(d)) return d.length === 15;
  if (/^6(011|5|4[4-9]|22)/.test(d)) return d.length >= 16 && d.length <= 19;
  if (/^3(0[0-5]|6|8|9)/.test(d)) return d.length === 14;
  if (/^35(2[89]|[3-8])/.test(d)) return d.length === 16;
  if (/^62/.test(d)) return d.length >= 16 && d.length <= 19;
  return false;
}

// Valid JWT: header must base64-decode to a JSON object with an "alg"
// field. This rejects random `eyJ...eyJ...xxx` base64 blobs that happen
// to share the shape.
function isProbableJwt(raw: string): boolean {
  const parts = raw.split('.');
  if (parts.length !== 3) return false;
  try {
    // base64url → base64
    const b64 = parts[0].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    // atob exists in renderer + main (Node 18+). Use Buffer fallback
    // if atob is unavailable.
    const decode = typeof atob === 'function'
      ? atob
      : (s: string) => Buffer.from(s, 'base64').toString('binary');
    const headerJson = decode(padded);
    const header = JSON.parse(headerJson);
    return typeof header === 'object' && header !== null && typeof header.alg === 'string';
  } catch {
    return false;
  }
}

const RULES: Rule[] = [
  { category: 'card',        pattern: /\b(?:\d[ -]*?){13,19}\b/g,                                      replacement: '[CARD-REDACTED]', validate: isProbableCard },
  { category: 'ssn',         pattern: /\b\d{3}-\d{2}-\d{4}\b/g,                                         replacement: '[SSN-REDACTED]' },
  { category: 'email',       pattern: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,          replacement: '[EMAIL-REDACTED]' },
  // Phone: E.164 (+<country><number>, 7–15 digits total) OR classic
  // North-American (NANP) 10-digit. International first so it wins.
  { category: 'phone',       pattern: /\+(?:[0-9][\s\-.]?){6,14}[0-9]/g,                                replacement: '[PHONE-REDACTED]' },
  { category: 'phone',       pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,       replacement: '[PHONE-REDACTED]' },
  { category: 'ip',          pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,                                   replacement: '[IP-REDACTED]' },
  { category: 'aws',         pattern: /\bAKIA[0-9A-Z]{16}\b/g,                                          replacement: '[AWS-KEY-REDACTED]' },
  { category: 'github',      pattern: /\bgh[ps]_[A-Za-z0-9_]{36,255}\b/g,                               replacement: '[GITHUB-TOKEN-REDACTED]' },
  { category: 'apiKey',      pattern: /(?:api[_-]?key|apikey|secret[_-]?key|access[_-]?token)\s*[:=]\s*["']?[\w\-]{20,}["']?/gi, replacement: '[API-KEY-REDACTED]' },
  { category: 'jwt',         pattern: /\beyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_.+/=]+\b/g, replacement: '[JWT-REDACTED]', validate: isProbableJwt },
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
    if (rule.validate) {
      // Replace with validator filter — rebuild result by walking matches.
      let replaced = '';
      let lastIdx = 0;
      rule.pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = rule.pattern.exec(result)) !== null) {
        const matched = m[0];
        if (rule.validate(matched)) {
          replaced += result.slice(lastIdx, m.index) + rule.replacement;
          lastIdx = m.index + matched.length;
          categories[rule.category] = (categories[rule.category] ?? 0) + 1;
          total += 1;
        }
        // Avoid zero-width infinite loop
        if (m.index === rule.pattern.lastIndex) rule.pattern.lastIndex++;
      }
      replaced += result.slice(lastIdx);
      result = replaced;
    } else {
      const matches = result.match(rule.pattern);
      const count = matches?.length ?? 0;
      if (count > 0) {
        categories[rule.category] = (categories[rule.category] ?? 0) + count;
        total += count;
        result = result.replace(rule.pattern, rule.replacement);
      }
    }
  }

  return { redacted: result, matchCount: total, categories };
}

export function countMatches(text: string): number {
  return redact(text).matchCount;
}
