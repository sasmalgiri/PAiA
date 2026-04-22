// Minimal UI for the persistent task queue.
//
// The runner lives in the main process (src/main/taskQueue.ts). This
// panel is just a controlled view: enqueue new goals, watch status
// transitions, cancel/clear. Real-time updates stream in via
// paia:queue-update; we also refresh once on mount in case the window
// missed an update while hidden.

import { useEffect, useState } from 'react';
import type { QueuedTask } from '../../shared/types';
import { api } from '../lib/api';

export function TaskQueuePanel() {
  const [tasks, setTasks] = useState<QueuedTask[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.queueList().then(setTasks);
    const off = api.onQueueUpdate(setTasks);
    return () => off();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const goal = draft.trim();
    if (!goal || busy) return;
    setBusy(true);
    try {
      await api.queueEnqueue({ goal });
      setDraft('');
    } finally {
      setBusy(false);
    }
  }

  const pending = tasks.filter((t) => t.status === 'pending');
  const running = tasks.filter((t) => t.status === 'running');
  const finished = tasks.filter((t) =>
    t.status === 'done' || t.status === 'failed' || t.status === 'cancelled',
  );

  return (
    <div className="task-queue-panel">
      <header className="task-queue-header">
        <strong>Task queue</strong>
        <span className="task-queue-count">
          {running.length} running · {pending.length} pending · {finished.length} done
        </span>
      </header>

      <form className="task-queue-form" onSubmit={submit}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a task (one goal, as if you were asking PAiA directly)..."
          rows={2}
          disabled={busy}
        />
        <button type="submit" disabled={busy || draft.trim() === ''}>
          {busy ? 'Adding...' : 'Enqueue'}
        </button>
      </form>

      <ul className="task-queue-list">
        {tasks.length === 0 && (
          <li className="task-queue-empty">
            No tasks yet. Enqueue a goal above; it will start as soon as any current run finishes.
          </li>
        )}
        {tasks.map((t) => (
          <li key={t.id} className={`task-queue-item status-${t.status}`}>
            <div className="task-queue-row">
              <span className={`task-queue-dot dot-${t.status}`} />
              <span className="task-queue-goal" title={t.goal}>{t.goal}</span>
              <span className="task-queue-status">{t.status}</span>
              {(t.status === 'pending' || t.status === 'running') && (
                <button
                  type="button"
                  className="task-queue-cancel"
                  onClick={() => void api.queueCancel(t.id)}
                >
                  Cancel
                </button>
              )}
            </div>
            {t.result && (
              <div className="task-queue-result">{t.result}</div>
            )}
          </li>
        ))}
      </ul>

      {finished.length > 0 && (
        <footer className="task-queue-footer">
          <button type="button" onClick={() => void api.queueClearFinished()}>
            Clear finished ({finished.length})
          </button>
        </footer>
      )}
    </div>
  );
}
