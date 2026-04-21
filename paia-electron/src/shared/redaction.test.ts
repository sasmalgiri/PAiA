import { describe, expect, it } from 'vitest';
import { redact } from './redaction';

describe('redact', () => {
  it('returns input unchanged when there is no PII', () => {
    const r = redact('hello world');
    expect(r.redacted).toBe('hello world');
    expect(r.matchCount).toBe(0);
  });

  it('redacts emails', () => {
    const r = redact('contact me at jane.doe@example.com please');
    expect(r.redacted).toContain('[EMAIL-REDACTED]');
    expect(r.categories.email).toBe(1);
  });

  it('redacts phone numbers', () => {
    const r = redact('call (415) 555-0199 today');
    expect(r.redacted).toContain('[PHONE-REDACTED]');
  });

  it('redacts SSNs', () => {
    const r = redact('SSN: 123-45-6789');
    expect(r.redacted).toContain('[SSN-REDACTED]');
  });

  it('redacts AWS access keys', () => {
    const r = redact('key: AKIAIOSFODNN7EXAMPLE');
    expect(r.redacted).toContain('[AWS-KEY-REDACTED]');
  });

  it('redacts JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const r = redact(`token=${jwt}`);
    expect(r.redacted).toContain('[JWT-REDACTED]');
  });

  it('handles empty input', () => {
    expect(redact('').redacted).toBe('');
    expect(redact('').matchCount).toBe(0);
  });

  it('counts multiple matches across categories', () => {
    const r = redact('a@b.com and c@d.com plus 192.168.1.1');
    expect(r.matchCount).toBeGreaterThanOrEqual(3);
    expect(r.categories.email).toBe(2);
    expect(r.categories.ip).toBe(1);
  });

  // ── False-positive guards ────────────────────────────────────────

  it('does NOT redact ISBN-shaped strings as credit cards', () => {
    // ISBN-13 is 13 digits with hyphens; fails Luhn + no valid BIN.
    const r = redact('See ISBN 978-0-13-110362-7 for details');
    expect(r.redacted).toContain('978-0-13-110362-7');
    expect(r.categories.card ?? 0).toBe(0);
  });

  it('does NOT redact arbitrary long digit sequences as credit cards', () => {
    const r = redact('Tracking: 1Z999AA10123456784 order 1234567890123456');
    // Neither string satisfies Luhn + valid-BIN.
    expect(r.categories.card ?? 0).toBe(0);
  });

  it('DOES redact a real Visa card', () => {
    // 4111 1111 1111 1111 is a standard test Visa (passes Luhn, BIN 4).
    const r = redact('card: 4111 1111 1111 1111');
    expect(r.categories.card).toBe(1);
    expect(r.redacted).toContain('[CARD-REDACTED]');
  });

  it('does NOT redact random base64 payloads as JWTs', () => {
    // Has the eyJ...eyJ...xxx shape but header does not decode to JSON.
    const fake = 'eyJzb21lYmFzZTY0ZGF0YQ.eyJtb3JlYmFzZTY0.xxxxxxxxxxxxxxxxxxxx';
    const r = redact(`payload=${fake}`);
    expect(r.categories.jwt ?? 0).toBe(0);
  });

  it('redacts international (E.164) phone numbers', () => {
    const r = redact('call +44 20 7946 0958 or +91 98765 43210');
    expect(r.categories.phone).toBeGreaterThanOrEqual(2);
  });
});
