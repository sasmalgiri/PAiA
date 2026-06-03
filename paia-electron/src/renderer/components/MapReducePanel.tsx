// Modal for a /longread (map-reduce) run.
//
// Three states surface to the user:
//   pending     — chunks queued, none done yet
//   mapping     — progress bar fills as chunks complete
//   reducing    — synthesising the final answer, tokens stream live
//   done        — show final answer with a "N of M chunks contributed" stat
//   error       — explain what went wrong

import { useEffect } from 'react';
import { renderMarkdown } from '../lib/markdown';

export interface MapReduceState {
  runId: string | null;
  question: string;
  documentLabel: string;
  totalChunks: number;
  chunksDone: number;
  chunksWithContent: number;
  usableChunks: number;
  answer: string;
  status: 'pending' | 'mapping' | 'reducing' | 'done' | 'error';
  error?: string;
}

interface Props {
  state: MapReduceState;
  onClose: () => void;
  onAbort: () => void;
}

export function MapReducePanel({ state, onClose, onAbort }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && (state.status === 'done' || state.status === 'error')) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.status, onClose]);

  const inProgress = state.status === 'pending' || state.status === 'mapping' || state.status === 'reducing';
  const pct = state.totalChunks > 0 ? Math.min(100, Math.round((state.chunksDone / state.totalChunks) * 100)) : 0;

  return (
    <div className="council-backdrop" onClick={() => { if (!inProgress) onClose(); }}>
      <div className="council-panel" role="dialog" aria-label="Long-read map-reduce" onClick={(e) => e.stopPropagation()}>
        <header className="council-header">
          <div className="council-title">
            <span aria-hidden>📚</span>
            <span>
              Long-read of <em>{state.documentLabel}</em>:
              <span style={{ marginLeft: 6 }}>
                {state.question.length > 70 ? state.question.slice(0, 67) + '…' : state.question}
              </span>
            </span>
          </div>
          <div className="council-actions">
            {inProgress && (
              <button type="button" className="small danger" onClick={onAbort}>Abort</button>
            )}
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close" disabled={inProgress}>×</button>
          </div>
        </header>

        <div className="council-status">
          {state.status === 'pending' && <span>Splitting document into chunks…</span>}
          {state.status === 'mapping' && (
            <span>
              Processing chunks: {state.chunksDone} / {state.totalChunks}
              {' '}({state.chunksWithContent} relevant so far)
            </span>
          )}
          {state.status === 'reducing' && (
            <span>Synthesising across {state.usableChunks} relevant chunks…</span>
          )}
          {state.status === 'done' && (
            <span>Done · {state.usableChunks} of {state.totalChunks} chunks contributed</span>
          )}
          {state.status === 'error' && <span className="danger">{state.error ?? 'Map-reduce failed.'}</span>}
        </div>

        {(state.status === 'mapping' || state.status === 'pending') && (
          <div style={{ padding: '0 16px 12px' }}>
            <div style={{ height: 6, background: 'var(--bg-2)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent, #5b9dd9)', transition: 'width 220ms ease' }} />
            </div>
          </div>
        )}

        <section className="council-synthesis">
          <h4 className="council-section-title">Final answer</h4>
          {state.answer ? (
            <div className="markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(state.answer) }} />
          ) : (
            <div className="muted-note">
              {state.status === 'reducing' ? 'Streaming…' :
               state.status === 'mapping' ? 'Waiting for chunks to finish processing.' :
               state.status === 'pending' ? 'Preparing…' :
               state.status === 'done' ? '(Empty — no chunks were relevant.)' :
               ''}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
