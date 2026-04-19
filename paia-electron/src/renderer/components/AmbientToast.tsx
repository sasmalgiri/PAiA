// Non-intrusive toast that pops up from the bottom of the panel when
// the ambient watcher surfaces a suggestion. User can Accept (which
// fires the action) or Dismiss (which logs the resolution).

import { useEffect, useState } from 'react';
import type { AmbientSuggestion } from '../../shared/types';
import { api } from '../lib/api';

interface Props {
  onAccept: (s: AmbientSuggestion) => void;
}

export function AmbientToast({ onAccept }: Props) {
  const [queue, setQueue] = useState<AmbientSuggestion[]>([]);

  useEffect(() => {
    const off = api.onAmbientSuggestion?.((s) => {
      setQueue((prev) => [...prev.filter((x) => x.kind !== s.kind), s]);
    });
    return () => { off?.(); };
  }, []);

  // Auto-dismiss after 20 seconds per suggestion.
  useEffect(() => {
    if (queue.length === 0) return;
    const t = setTimeout(() => {
      const top = queue[0];
      if (top) {
        void api.ambientResolve(top.id, 'dismissed');
        setQueue((prev) => prev.slice(1));
      }
    }, 20_000);
    return () => clearTimeout(t);
  }, [queue]);

  if (queue.length === 0) return null;
  const current = queue[0];

  function accept(): void {
    void api.ambientResolve(current.id, 'accepted');
    onAccept(current);
    setQueue((prev) => prev.slice(1));
  }
  function dismiss(): void {
    void api.ambientResolve(current.id, 'dismissed');
    setQueue((prev) => prev.slice(1));
  }

  return (
    <div className="ambient-toast">
      <div className="ambient-icon">💡</div>
      <div className="ambient-body">
        <div className="ambient-title">{current.title}</div>
        <div className="ambient-detail">{current.detail}</div>
      </div>
      <div className="ambient-actions">
        <button type="button" className="primary" onClick={accept}>Yes</button>
        <button type="button" className="secondary" onClick={dismiss}>No</button>
      </div>
    </div>
  );
}
