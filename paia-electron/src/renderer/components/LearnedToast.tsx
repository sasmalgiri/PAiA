// Ambient chip that appears briefly whenever PAiA's self-learning
// writes a new lesson to memory. Makes the otherwise-silent reflection
// pipeline visible, and links to Settings → Memory for inspection.

import { useEffect, useState } from 'react';
import { api } from '../lib/api';

interface Learned {
  threadId: string;
  summary: string;
  count: number;
  expiresAt: number;
}

interface Props {
  onOpenMemory?: () => void;
}

export function LearnedToast({ onOpenMemory }: Props) {
  const [current, setCurrent] = useState<Learned | null>(null);

  useEffect(() => {
    const off = api.onReflectionSaved?.((p) => {
      setCurrent({ ...p, expiresAt: Date.now() + 6000 });
    });
    return () => { off?.(); };
  }, []);

  useEffect(() => {
    if (!current) return;
    const ms = Math.max(0, current.expiresAt - Date.now());
    const t = setTimeout(() => setCurrent(null), ms);
    return () => clearTimeout(t);
  }, [current]);

  if (!current) return null;

  const one = current.summary.split('\n')[0] ?? '';
  const more = current.count > 1 ? ` (+${current.count - 1} more)` : '';

  return (
    <div
      className="learned-toast"
      role="status"
      aria-live="polite"
      onClick={() => { onOpenMemory?.(); setCurrent(null); }}
      style={{ cursor: onOpenMemory ? 'pointer' : 'default' }}
    >
      <div className="learned-toast-head">🧠 PAiA learned something</div>
      <div className="learned-toast-body">{one}{more}</div>
    </div>
  );
}
