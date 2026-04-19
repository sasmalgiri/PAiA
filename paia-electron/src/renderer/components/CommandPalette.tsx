// Global command palette. Cmd/Ctrl+K from anywhere.
//
// Aggregates jumpable entries from multiple sources:
//   - threads             → open the thread
//   - artifacts           → open the Canvas to that artifact
//   - memory entries      → recall into a new /recall prompt
//   - slash commands      → pre-fill the composer with "/name "
//   - actions             → "new thread", "start agent", "open canvas", etc.
//   - settings            → jump to a specific Settings tab
//
// The palette is keyboard-first: ↑ / ↓ to move, Enter to pick, Esc to close.
// Fuzzy matching is naive but fast enough for the small entry count we
// ever show (typically < 200).

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CommandPaletteEntry, DbThread } from '../../shared/types';
import { api } from '../lib/api';
import { SLASH_COMMANDS } from '../lib/slashCommands';
import { useFocusTrap } from '../lib/focusTrap';

export interface PaletteAction {
  kind: CommandPaletteEntry['kind'];
  payload: string;
}

interface Props {
  threads: DbThread[];
  onClose: () => void;
  onPick: (action: PaletteAction) => void;
}

export function CommandPalette({ threads, onClose, onPick }: Props) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const [dynamic, setDynamic] = useState<CommandPaletteEntry[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(containerRef, { onClose });

  // Load artifacts + memory on open so they appear in the palette.
  useEffect(() => {
    void (async () => {
      const [artifacts, memory] = await Promise.all([
        api.artifactsList(),
        api.memoryList(),
      ]);
      const entries: CommandPaletteEntry[] = [];
      for (const a of artifacts.slice(0, 50)) {
        entries.push({
          id: `art:${a.id}`,
          kind: 'artifact',
          title: a.title,
          subtitle: `${a.kind}/${a.language} · v${a.version}`,
          payload: a.id,
        });
      }
      for (const m of memory.slice(0, 50)) {
        entries.push({
          id: `mem:${m.id}`,
          kind: 'memory',
          title: m.text.slice(0, 60),
          subtitle: `memory · ${m.scope}`,
          payload: m.text,
        });
      }
      setDynamic(entries);
    })();
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const entries: CommandPaletteEntry[] = useMemo(() => {
    const all: CommandPaletteEntry[] = [
      // Top-level actions first — always visible when the palette opens empty.
      { id: 'act:new-thread', kind: 'action', title: 'New thread', subtitle: 'Start a fresh conversation', payload: 'new-thread' },
      { id: 'act:open-canvas', kind: 'action', title: 'Open Canvas', subtitle: 'Side-panel artifacts', payload: 'open-canvas' },
      { id: 'act:start-agent', kind: 'action', title: 'Start agent run…', subtitle: 'Plan → act → observe loop', payload: 'start-agent' },
      { id: 'act:start-research', kind: 'action', title: 'Deep research…', subtitle: 'Cited multi-source report', payload: 'start-research' },
      { id: 'act:start-team', kind: 'action', title: 'Team run…', subtitle: 'Planner + researcher + coder + reviewer', payload: 'start-team' },
      { id: 'act:settings', kind: 'setting', title: 'Settings', subtitle: 'Open the settings view', payload: 'open-settings' },
      // Slash commands.
      ...SLASH_COMMANDS.map((c) => ({
        id: `slash:${c.name}`,
        kind: 'slash' as const,
        title: `/${c.name}`,
        subtitle: c.description,
        payload: c.name,
      })),
      // Threads.
      ...threads.slice(0, 80).map((t) => ({
        id: `thr:${t.id}`,
        kind: 'thread' as const,
        title: t.title,
        subtitle: `${t.messageCount} messages`,
        payload: t.id,
      })),
      ...dynamic,
    ];
    if (!q.trim()) return all;
    const needle = q.toLowerCase();
    return all
      .map((e) => ({ e, score: scoreMatch(needle, `${e.title} ${e.subtitle ?? ''}`.toLowerCase()) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50)
      .map((x) => x.e);
  }, [q, threads, dynamic]);

  useEffect(() => { setIdx(0); }, [q]);

  function handleKey(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(entries.length - 1, i + 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); return; }
    if (e.key === 'Enter') { e.preventDefault(); pick(entries[idx]); return; }
  }

  function pick(e: CommandPaletteEntry | undefined): void {
    if (!e) return;
    onPick({ kind: e.kind, payload: e.payload });
    onClose();
  }

  return (
    <div className="palette-backdrop" onMouseDown={onClose} role="presentation">
      <div
        className="palette"
        ref={containerRef}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <input
          ref={inputRef}
          type="text"
          className="palette-input"
          placeholder="Type to search… (↑/↓ to move, Enter to pick, Esc to close)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={handleKey}
          aria-label="Search commands"
          aria-autocomplete="list"
          aria-controls="palette-list"
          aria-activedescendant={entries[idx] ? `palette-row-${idx}` : undefined}
        />
        <div className="palette-list" id="palette-list" role="listbox">
          {entries.length === 0 && <div className="palette-empty">No matches.</div>}
          {entries.map((e, i) => (
            <button
              key={e.id}
              id={`palette-row-${i}`}
              type="button"
              role="option"
              aria-selected={i === idx}
              className={`palette-row ${i === idx ? 'active' : ''}`}
              onMouseEnter={() => setIdx(i)}
              onClick={() => pick(e)}
            >
              <span className={`palette-kind palette-kind-${e.kind}`}>{e.kind}</span>
              <span className="palette-title">{e.title}</span>
              {e.subtitle && <span className="palette-subtitle">{e.subtitle}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function scoreMatch(needle: string, hay: string): number {
  if (hay.includes(needle)) return 100 + needle.length;
  // Subsequence match — each hit worth 10, bonus for consecutive chars.
  let hi = 0;
  let score = 0;
  let streak = 0;
  for (let ni = 0; ni < needle.length; ni++) {
    const ch = needle[ni];
    let found = false;
    while (hi < hay.length) {
      if (hay[hi] === ch) { found = true; hi++; score += 10 + streak * 5; streak++; break; }
      hi++;
      streak = 0;
    }
    if (!found) return 0;
  }
  return score;
}
