import { describe, expect, it } from 'vitest';
import { cronMatches, parseCron } from './cron';

describe('cron', () => {
  it('accepts a 5-field expression', () => {
    const f = parseCron('0 8 * * *');
    expect(f.minute.values.has(0)).toBe(true);
    expect(f.hour.values.has(8)).toBe(true);
    expect(f.dayOfMonth.any).toBe(true);
    expect(f.month.any).toBe(true);
    expect(f.dayOfWeek.any).toBe(true);
  });

  it('rejects the wrong number of fields', () => {
    expect(() => parseCron('0 8 * *')).toThrow();
    expect(() => parseCron('0 8 * * * *')).toThrow();
  });

  it('matches at the scheduled minute', () => {
    const f = parseCron('0 8 * * *');
    const d = new Date(2026, 3, 19, 8, 0); // Apr 19 2026, 08:00
    expect(cronMatches(f, d)).toBe(true);

    const off = new Date(2026, 3, 19, 8, 1);
    expect(cronMatches(f, off)).toBe(false);
  });

  it('handles step syntax (*/15)', () => {
    const f = parseCron('*/15 * * * *');
    expect(cronMatches(f, new Date(2026, 0, 1, 0, 0))).toBe(true);
    expect(cronMatches(f, new Date(2026, 0, 1, 0, 15))).toBe(true);
    expect(cronMatches(f, new Date(2026, 0, 1, 0, 30))).toBe(true);
    expect(cronMatches(f, new Date(2026, 0, 1, 0, 10))).toBe(false);
  });

  it('handles range and list syntax', () => {
    const f = parseCron('0 9-17 * * 1-5'); // weekday business hours
    const monMorning = new Date(2026, 3, 20, 9, 0); // Monday 9:00
    const satMorning = new Date(2026, 3, 18, 9, 0); // Saturday 9:00
    const weekdayLate = new Date(2026, 3, 20, 18, 0); // Monday 18:00
    expect(cronMatches(f, monMorning)).toBe(true);
    expect(cronMatches(f, satMorning)).toBe(false);
    expect(cronMatches(f, weekdayLate)).toBe(false);
  });
});
