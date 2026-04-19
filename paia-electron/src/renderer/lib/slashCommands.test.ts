import { describe, expect, it } from 'vitest';
import { findCommand, parseSlashCommand, SLASH_COMMANDS } from './slashCommands';

describe('parseSlashCommand', () => {
  it('returns null for non-slash input', () => {
    expect(parseSlashCommand('hello world')).toBe(null);
    expect(parseSlashCommand('')).toBe(null);
  });

  it('extracts a bare command with no args', () => {
    expect(parseSlashCommand('/clear')).toEqual({ command: 'clear', rest: '' });
  });

  it('extracts a command with a single-word argument', () => {
    expect(parseSlashCommand('/translate spanish')).toEqual({
      command: 'translate',
      rest: 'spanish',
    });
  });

  it('extracts a command with a multi-word remainder', () => {
    expect(parseSlashCommand('/explain quantum mechanics please')).toEqual({
      command: 'explain',
      rest: 'quantum mechanics please',
    });
  });

  it('preserves pipes and other punctuation in the remainder', () => {
    expect(parseSlashCommand('/translate french | hello there')).toEqual({
      command: 'translate',
      rest: 'french | hello there',
    });
  });
});

describe('findCommand', () => {
  it('finds a known command by name', () => {
    expect(findCommand('summarize')?.name).toBe('summarize');
  });

  it('returns null for unknown commands', () => {
    expect(findCommand('not-a-real-command')).toBe(null);
  });

  it('every command has a non-empty description', () => {
    for (const cmd of SLASH_COMMANDS) {
      expect(cmd.description.length).toBeGreaterThan(0);
    }
  });

  it('every command has a unique name', () => {
    const names = SLASH_COMMANDS.map((c) => c.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });
});

describe('slash command rewrites', () => {
  it('summarize wraps the input in a 3-5 bullet ask', () => {
    const cmd = findCommand('summarize')!;
    const out = cmd.rewrite('long article text');
    expect(out).toContain('long article text');
    expect(out).toContain('bullet');
  });

  it('translate parses target | text form', () => {
    const cmd = findCommand('translate')!;
    const out = cmd.rewrite('spanish | hello world');
    expect(out).toContain('spanish');
    expect(out).toContain('hello world');
  });

  it('translate falls back to default when pipe is missing', () => {
    const cmd = findCommand('translate')!;
    const out = cmd.rewrite('just some text');
    expect(out).toContain('just some text');
  });

  it('meta commands return null (UI handles them)', () => {
    expect(findCommand('clear')!.rewrite('')).toBe(null);
    expect(findCommand('new')!.rewrite('')).toBe(null);
    expect(findCommand('screen')!.rewrite('')).toBe(null);
    expect(findCommand('search')!.rewrite('foo')).toBe(null);
    expect(findCommand('image')!.rewrite('')).toBe(null);
    expect(findCommand('region')!.rewrite('')).toBe(null);
  });
});
