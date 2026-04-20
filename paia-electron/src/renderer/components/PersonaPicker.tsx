// Modal persona picker. Replaces the flat <select> in the panel header
// so the 50+ built-in pro personas are actually discoverable: category
// tabs, free-text search, and each entry shows a preview of the system
// prompt so the user can tell personas apart before selecting.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Persona } from '../../shared/types';

interface Props {
  personas: Persona[];
  currentId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}

// Id → category mapping. Keeps the Persona interface unchanged; any
// custom (non-built-in) persona falls into "Custom".
const CATEGORY_MAP: Record<string, string> = {
  default: 'General',
  coder: 'General',
  writer: 'General',
  translator: 'General',
  researcher: 'General',
  brainstormer: 'General',
  'privacy-auditor': 'General',

  'motor-design-engineer': 'Engineering',
  'electrical-engineer': 'Engineering',
  'mechanical-engineer': 'Engineering',
  'chemical-engineer': 'Engineering',
  'civil-engineer': 'Engineering',
  'aerospace-engineer': 'Engineering',
  'robotics-engineer': 'Engineering',
  'hardware-engineer': 'Engineering',
  'devops-engineer': 'Engineering',
  'security-engineer': 'Engineering',
  sre: 'Engineering',
  'data-engineer': 'Engineering',

  'data-scientist': 'Science',
  'ml-researcher': 'Science',
  biologist: 'Science',
  chemist: 'Science',
  physicist: 'Science',
  mathematician: 'Science',
  statistician: 'Science',

  cardiologist: 'Medical',
  radiologist: 'Medical',
  pharmacist: 'Medical',
  'medical-researcher': 'Medical',

  'patent-attorney': 'Legal',
  'corporate-lawyer': 'Legal',
  'compliance-officer': 'Legal',
  'privacy-lawyer': 'Legal',

  'product-manager': 'Business',
  'startup-founder': 'Business',
  'cfo-accountant': 'Business',
  'financial-analyst': 'Business',
  'quant-analyst': 'Business',
  'ma-analyst': 'Business',
  'marketing-strategist': 'Business',
  'sales-coach': 'Business',
  'hr-specialist': 'Business',

  'ux-designer': 'Creative',
  'graphic-designer': 'Creative',
  architect: 'Creative',
  'music-composer': 'Creative',
  screenwriter: 'Creative',
  'game-designer': 'Creative',

  teacher: 'Education',
  'academic-writer': 'Education',
  'tutor-math': 'Education',
  'tutor-language': 'Education',

  'technical-writer': 'Ops',
  'project-manager': 'Ops',
  consultant: 'Ops',
};

const CATEGORY_ORDER = ['All', 'General', 'Engineering', 'Science', 'Medical', 'Legal', 'Business', 'Creative', 'Education', 'Ops', 'Custom'];

function categoryOf(p: Persona): string {
  if (!p.isBuiltin) return 'Custom';
  return CATEGORY_MAP[p.id] ?? 'General';
}

function preview(systemPrompt: string): string {
  // Trim "You are PAiA as a …" boilerplate so the preview surfaces the
  // actually-differentiating guidance for this persona.
  const cleaned = systemPrompt.replace(/^You are PAiA(\s+(in|as)\s+[^.]+\.)?\s*/i, '');
  const first = cleaned.split(/(?<=[.!?])\s+/)[0] ?? cleaned;
  return first.length > 160 ? first.slice(0, 157) + '…' : first;
}

export function PersonaPicker({ personas, currentId, onSelect, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('All');
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const categoriesPresent = useMemo(() => {
    const found = new Set<string>();
    for (const p of personas) found.add(categoryOf(p));
    return ['All', ...CATEGORY_ORDER.filter((c) => c !== 'All' && found.has(c))];
  }, [personas]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return personas.filter((p) => {
      if (category !== 'All' && categoryOf(p) !== category) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        p.systemPrompt.toLowerCase().includes(q)
      );
    });
  }, [personas, category, query]);

  return (
    <div className="persona-picker-backdrop" onClick={onClose}>
      <div className="persona-picker" role="dialog" aria-label="Select persona" onClick={(e) => e.stopPropagation()}>
        <div className="persona-picker-header">
          <input
            ref={searchRef}
            type="text"
            placeholder="Search personas by name, role, or instruction…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="persona-picker-search"
          />
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="persona-picker-categories">
          {categoriesPresent.map((c) => (
            <button
              key={c}
              type="button"
              className={`persona-category ${category === c ? 'active' : ''}`}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="persona-picker-grid">
          {filtered.length === 0 && (
            <div className="persona-picker-empty">
              No personas match <strong>“{query}”</strong> in <em>{category}</em>.
            </div>
          )}
          {filtered.map((p) => {
            const active = p.id === currentId;
            return (
              <button
                key={p.id}
                type="button"
                className={`persona-card ${active ? 'active' : ''}`}
                onClick={() => { onSelect(p.id); onClose(); }}
              >
                <div className="persona-card-head">
                  <span className="persona-card-emoji">{p.emoji}</span>
                  <span className="persona-card-name">{p.name}</span>
                  {p.isBuiltin && <span className="persona-card-badge">built-in</span>}
                  {active && <span className="persona-card-check">✓</span>}
                </div>
                <div className="persona-card-preview">{preview(p.systemPrompt)}</div>
              </button>
            );
          })}
        </div>
        <div className="persona-picker-footer">
          {filtered.length} persona{filtered.length === 1 ? '' : 's'} · Esc to close · Tap a card to switch
        </div>
      </div>
    </div>
  );
}
