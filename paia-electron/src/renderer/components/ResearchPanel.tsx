// Live view for a Deep Research run.
//
// The component is self-mounted: the parent passes the initial ResearchRun
// and this component subscribes to progress + token events until the run
// finishes. It renders the sub-question plan, the collected sources, and
// streams the final report token-by-token.

import { useEffect, useState } from 'react';
import type { ResearchProgress, ResearchRun } from '../../shared/types';
import { api } from '../lib/api';
import { renderMarkdown } from '../lib/markdown';

function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

interface Props {
  run: ResearchRun;
  onClose: () => void;
}

export function ResearchPanel({ run: initialRun, onClose }: Props) {
  const [run, setRun] = useState<ResearchRun>(initialRun);
  const [reportStream, setReportStream] = useState<string>('');
  const [progress, setProgress] = useState<ResearchProgress | null>(null);

  useEffect(() => {
    const offRun = api.onResearchRun((r) => {
      if (r.id !== run.id) return;
      setRun(r);
      if (r.status === 'done' || r.status === 'error') {
        setReportStream(r.report ?? reportStream);
      }
    });
    const offTok = api.onResearchToken(({ runId, token }) => {
      if (runId !== run.id) return;
      setReportStream((prev) => prev + token);
    });
    const offProg = api.onResearchProgress((p) => {
      if (p.runId && p.runId !== run.id) return;
      setProgress(p);
    });
    return () => {
      offRun();
      offTok();
      offProg();
    };
  }, [run.id]);

  const report = run.report ?? reportStream;
  const done = run.status === 'done' || run.status === 'error';

  return (
    <div className="research-panel">
      <header className="research-header">
        <div>
          <div className="research-title">
            <span className={`dot ${run.status === 'done' ? 'ok' : run.status === 'error' ? 'bad' : ''}`} />
            <strong>Research · {run.question}</strong>
          </div>
          <div className="research-sub">
            {run.status}
            {progress && progress.total > 1 && (
              <> · {progress.message} ({progress.current + 1}/{progress.total})</>
            )}
          </div>
        </div>
        <button type="button" className="icon-btn" onClick={onClose}>×</button>
      </header>

      {run.subQuestions.length > 0 && (
        <div className="research-section">
          <div className="research-section-title">Plan</div>
          <ol className="research-subs">
            {run.subQuestions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>
      )}

      {run.sources.length > 0 && (
        <div className="research-section">
          <div className="research-section-title">Sources ({run.sources.length})</div>
          <ul className="research-sources">
            {run.sources.map((s) => {
              // Guard: web.fetch results can, in principle, include
              // non-http URLs. Silently swallow invalid schemes rather
              // than hand them to openExternal (which would have
              // refused, but better to filter before render).
              const safe = isHttpUrl(s.url);
              return (
                <li key={s.url}>
                  {safe ? (
                    <button
                      type="button"
                      className="link-like"
                      onClick={() => void api.openExternal(s.url)}
                      title={s.url}
                    >
                      [{s.n}] {s.title}
                    </button>
                  ) : (
                    <span title={s.url} className="muted-note" style={{ fontSize: 12 }}>
                      [{s.n}] {s.title} <em>(blocked non-http link)</em>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {(report || !done) && (
        <div className="research-section">
          <div className="research-section-title">Report</div>
          <div
            className="markdown research-report"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(report || '_Writing…_') }}
          />
        </div>
      )}
    </div>
  );
}
