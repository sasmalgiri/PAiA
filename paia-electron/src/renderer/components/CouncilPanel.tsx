// Modal panel for a council-of-experts run.
//
// Layout:
//   ┌──────────────────────────────────────────────┐
//   │ 🏛 Council on: <question>      [Abort] [×]   │
//   ├──────────────────────────────────────────────┤
//   │ Synthesised reply (streams as the synthesis  │
//   │ pass produces tokens).                       │
//   ├──────────────────────────────────────────────┤
//   │ ▼ Individual experts (N)                     │
//   │   🫀 Cardiologist  ✓ (1.2s)                  │
//   │      <answer body>                           │
//   │   💊 Pharmacist    ✓ (0.9s)                  │
//   │      <answer body>                           │
//   │   …                                          │
//   └──────────────────────────────────────────────┘

import { useEffect, useState } from 'react';
import { renderMarkdown } from '../lib/markdown';

export interface ExpertAnswer {
  personaId: string;
  personaName: string;
  emoji: string;
  content: string;
  durationMs: number;
  error?: string;
}

export interface CouncilState {
  runId: string | null;
  question: string;
  personaIds: string[];
  expertAnswers: ExpertAnswer[];
  synthesis: string;
  status: 'pending' | 'experts-running' | 'synthesising' | 'done' | 'error';
  error?: string;
}

interface Props {
  state: CouncilState;
  onClose: () => void;
  onAbort: () => void;
}

export function CouncilPanel({ state, onClose, onAbort }: Props) {
  const [showExperts, setShowExperts] = useState(true);

  // ESC closes when not running.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && (state.status === 'done' || state.status === 'error')) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.status, onClose]);

  const inProgress = state.status === 'pending' || state.status === 'experts-running' || state.status === 'synthesising';
  const okExperts = state.expertAnswers.filter((a) => !a.error).length;
  const expectedExperts = state.personaIds.length;

  return (
    <div className="council-backdrop" onClick={() => { if (!inProgress) onClose(); }}>
      <div className="council-panel" role="dialog" aria-label="Council of experts" onClick={(e) => e.stopPropagation()}>
        <header className="council-header">
          <div className="council-title">
            <span aria-hidden>🏛</span>
            <span>Council on: <em>{state.question.length > 80 ? state.question.slice(0, 77) + '…' : state.question}</em></span>
          </div>
          <div className="council-actions">
            {inProgress && (
              <button type="button" className="small danger" onClick={onAbort}>Abort</button>
            )}
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close" disabled={inProgress}>×</button>
          </div>
        </header>

        <div className="council-status">
          {state.status === 'pending' && <span>Briefing experts…</span>}
          {state.status === 'experts-running' && <span>{okExperts}/{expectedExperts} experts have answered…</span>}
          {state.status === 'synthesising' && <span>All {okExperts}/{expectedExperts} experts in — synthesising…</span>}
          {state.status === 'done' && <span>Council complete · {okExperts}/{expectedExperts} experts contributed</span>}
          {state.status === 'error' && <span className="danger">{state.error ?? 'Council failed.'}</span>}
        </div>

        <section className="council-synthesis">
          <h4 className="council-section-title">Synthesised reply</h4>
          {state.synthesis ? (
            <div className="markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(state.synthesis) }} />
          ) : (
            <div className="muted-note">
              {state.status === 'synthesising' ? 'Streaming…' : 'Waiting for experts to finish before synthesis.'}
            </div>
          )}
        </section>

        <section className="council-experts">
          <button
            type="button"
            className="council-expert-toggle"
            onClick={() => setShowExperts((v) => !v)}
            aria-expanded={showExperts}
          >
            {showExperts ? '▼' : '▶'} Individual experts ({state.expertAnswers.length}/{expectedExperts})
          </button>
          {showExperts && (
            <div className="council-expert-list">
              {state.personaIds.map((id) => {
                const ans = state.expertAnswers.find((a) => a.personaId === id);
                if (!ans) {
                  return (
                    <div key={id} className="council-expert-row pending">
                      <div className="council-expert-head">
                        <span className="council-expert-emoji" aria-hidden>⏳</span>
                        <span className="council-expert-name">{id}</span>
                        <span className="council-expert-status muted-note">thinking…</span>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={id} className={`council-expert-row ${ans.error ? 'failed' : 'done'}`}>
                    <div className="council-expert-head">
                      <span className="council-expert-emoji" aria-hidden>{ans.emoji}</span>
                      <span className="council-expert-name">{ans.personaName}</span>
                      <span className="council-expert-status muted-note">
                        {ans.error ? `failed: ${ans.error}` : `✓ ${(ans.durationMs / 1000).toFixed(1)}s`}
                      </span>
                    </div>
                    {ans.content && (
                      <div className="council-expert-body markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(ans.content) }} />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
