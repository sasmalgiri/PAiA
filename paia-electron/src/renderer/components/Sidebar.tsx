// Thread sidebar shown inside the panel. Lists conversations,
// supports new / open / delete.

import type { DbThread } from '../../shared/types';
import { api } from '../lib/api';

interface SidebarProps {
  threads: DbThread[];
  currentId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  return new Date(ts).toLocaleDateString();
}

export function Sidebar({ threads, currentId, onOpen, onNew, onDelete, onClose }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <button type="button" className="primary new-chat" onClick={onNew}>＋ New chat</button>
        <button type="button" className="icon-btn" title="Hide sidebar" onClick={onClose}>«</button>
      </div>
      <div className="sidebar-list">
        {threads.length === 0 && (
          <div className="sidebar-empty">
            <div style={{ fontSize: 32, marginBottom: 6 }}>💬</div>
            <strong>No conversations yet</strong>
            <div style={{ marginTop: 6, color: 'var(--muted)', fontSize: 11 }}>
              Type your first question in the box below, or press <kbd>Ctrl/⌘+K</kbd> for the command palette.
            </div>
            <button type="button" className="primary" style={{ marginTop: 10 }} onClick={onNew}>
              Start a new chat
            </button>
          </div>
        )}
        {threads.map((t) => (
          <div
            key={t.id}
            className={`sidebar-item ${t.id === currentId ? 'active' : ''}`}
            onClick={() => onOpen(t.id)}
          >
            <div className="sidebar-item-title">{t.title}</div>
            <div className="sidebar-item-meta">
              <span>{formatRelative(t.updatedAt)}</span>
              <span>·</span>
              <span>{t.messageCount} msg</span>
            </div>
            <button
              type="button"
              className="sidebar-item-detach"
              title="Detach into its own window"
              aria-label="Detach into its own window"
              onClick={(e) => {
                e.stopPropagation();
                void api.detachThread?.(t.id);
              }}
            >⇱</button>
            <button
              type="button"
              className="sidebar-item-x"
              title="Delete (you can undo for 7 seconds)"
              aria-label="Delete thread"
              onClick={(e) => {
                e.stopPropagation();
                // No blocking confirm() — the soft-delete + undo toast
                // is the safety net, and the extra click was friction.
                onDelete(t.id);
              }}
            >×</button>
          </div>
        ))}
      </div>
    </aside>
  );
}
