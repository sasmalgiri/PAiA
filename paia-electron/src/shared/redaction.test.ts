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
});
