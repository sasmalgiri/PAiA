// Tiny 5-field cron subset: minute hour day-of-month month day-of-week.
// Supports *, */N, a,b,c, and a-b in each field.
//
// Extracted from scheduler.ts so it can be unit-tested without pulling
// in Electron / the main-process module graph.

export interface CronFields {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

export interface CronField {
  any: boolean;
  values: Set<number>;
  step?: number;
}

export function parseCron(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('Cron expression must have 5 fields');
  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dayOfMonth: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dayOfWeek: parseField(parts[4], 0, 6),
  };
}

function parseField(s: string, min: number, max: number): CronField {
  if (s === '*') return { any: true, values: new Set() };
  const stepMatch = s.match(/^\*\/(\d+)$/);
  if (stepMatch) {
    const step = Number(stepMatch[1]);
    const values = new Set<number>();
    for (let v = min; v <= max; v += step) values.add(v);
    return { any: false, values, step };
  }
  const values = new Set<number>();
  for (const piece of s.split(',')) {
    const range = piece.match(/^(\d+)-(\d+)$/);
    if (range) {
      const lo = Number(range[1]);
      const hi = Number(range[2]);
      for (let v = lo; v <= hi; v++) values.add(v);
    } else if (/^\d+$/.test(piece)) {
      values.add(Number(piece));
    }
  }
  return { any: false, values };
}

export function cronMatches(fields: CronFields, d: Date): boolean {
  const match = (f: CronField, v: number) => f.any || f.values.has(v);
  return (
    match(fields.minute, d.getMinutes()) &&
    match(fields.hour, d.getHours()) &&
    match(fields.dayOfMonth, d.getDate()) &&
    match(fields.month, d.getMonth() + 1) &&
    match(fields.dayOfWeek, d.getDay())
  );
}
