// Observability inspector — per-assistant-message diagnostic pane.
//
// Reads the 'message-telemetry' attachment that main attaches to every
// assistant message in chat-send (E4), and renders the pipeline state:
//
//   Timing       redaction → memory → RAG → prompt build →
//                first token → total generation → grand total
//   Context      persona, model, escalated, active window, memory,
//                RAG collections + citations
//   Redaction    count (categories deliberately not stored)
//   Generation   input/output char counts
//
// Read-only. Purely diagnostic. Never feeds back into retrieval logic.

import { useState } from 'react';
import type { DbAttachment, MessageTelemetry } from '../../shared/types';

interface Props {
  attachments: DbAttachment[];
}

function findTelemetry(attachments: DbAttachment[]): MessageTelemetry | null {
  const att = attachments.find((a) => a.kind === 'message-telemetry');
  if (!att) return null;
  try {
    return JSON.parse(att.content) as MessageTelemetry;
  } catch {
    return null;
  }
}

function ms(n: number): string {
  if (n < 1) return '<1 ms';
  if (n < 1000) return `${Math.round(n)} ms`;
  return `${(n / 1000).toFixed(2)} s`;
}

interface BarSegment {
  label: string;
  ms: number;
  className: string;
}

function TimingBar({ segments, totalMs }: { segments: BarSegment[]; totalMs: number }) {
  // Filter out zero-duration segments so the bar isn't noisy.
  const real = segments.filter((s) => s.ms > 0);
  const sumKnown = real.reduce((acc, s) => acc + s.ms, 0);
  return (
    <div className="inspector-bar">
      <div className="inspector-bar-track">
        {real.map((s) => (
          <div
            key={s.label}
            className={`inspector-bar-seg ${s.className}`}
            style={{ width: `${(s.ms / Math.max(1, sumKnown)) * 100}%` }}
            title={`${s.label}: ${ms(s.ms)}`}
          />
        ))}
      </div>
      <div className="inspector-bar-legend">
        {real.map((s) => (
          <span key={s.label} className={`inspector-legend ${s.className}`}>
            <span className="dot" /> {s.label} {ms(s.ms)}
          </span>
        ))}
        <span className="muted-note" style={{ marginLeft: 'auto' }}>total {ms(totalMs)}</span>
      </div>
    </div>
  );
}

export function MessageInspector({ attachments }: Props) {
  const [open, setOpen] = useState(false);
  const tel = findTelemetry(attachments);
  if (!tel) return null;

  const segments: BarSegment[] = [
    { label: 'redact',   ms: tel.durations.redactionMs,     className: 'seg-redact' },
    { label: 'active',   ms: tel.durations.activeWindowMs,  className: 'seg-active' },
    { label: 'memory',   ms: tel.durations.memoryMs,        className: 'seg-memory' },
    { label: 'RAG',      ms: tel.durations.ragMs,           className: 'seg-rag' },
    { label: 'build',    ms: tel.durations.promptBuildMs,   className: 'seg-build' },
    { label: 'TTFT',     ms: tel.durations.timeToFirstTokenMs, className: 'seg-ttft' },
    { label: 'generate', ms: Math.max(0, tel.durations.totalGenerationMs - tel.durations.timeToFirstTokenMs), className: 'seg-gen' },
  ];

  return (
    <details className="inspector" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="inspector-summary">
        <span>🔍 Inspector</span>
        <span className="muted-note">{ms(tel.durations.totalMs)} · {tel.context.model.split(':').pop()}{tel.context.ragCitations.length > 0 ? ` · ${tel.context.ragCitations.length} cited` : ''}</span>
      </summary>
      <div className="inspector-body">
        <section>
          <h5>Timing</h5>
          <TimingBar segments={segments} totalMs={tel.durations.totalMs} />
        </section>

        <section>
          <h5>Context</h5>
          <dl className="inspector-dl">
            <div><dt>Persona</dt><dd>{tel.context.personaName ?? '(none)'}</dd></div>
            <div><dt>Model</dt><dd>{tel.context.model}{tel.context.isCloudModel && ' ☁️'}{tel.context.escalated && ' (escalated)'}</dd></div>
            {tel.context.activeWindowApp && <div><dt>Active window</dt><dd>{tel.context.activeWindowApp}</dd></div>}
            <div><dt>Memory injected</dt><dd>{tel.context.memoryInjected ? 'yes' : 'no'}</dd></div>
            <div><dt>RAG collections</dt><dd>{tel.context.ragCollectionIds.length === 0 ? '(none)' : tel.context.ragCollectionIds.length}</dd></div>
          </dl>
        </section>

        {tel.context.ragCitations.length > 0 && (
          <section>
            <h5>RAG citations</h5>
            <ul className="inspector-citations">
              {tel.context.ragCitations.map((c, i) => (
                <li key={i}>
                  <span className="muted-note">#{c.ordinal}</span>{' '}
                  <strong>{c.filename}</strong>{' '}
                  <span className="muted-note">score {c.score.toFixed(3)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h5>Redaction / generation</h5>
          <dl className="inspector-dl">
            <div><dt>PII matches scrubbed</dt><dd>{tel.redaction.matchCount}</dd></div>
            <div><dt>Input chars</dt><dd>{tel.generation.inputCharCount.toLocaleString()}</dd></div>
            <div><dt>Output chars</dt><dd>{tel.generation.outputCharCount.toLocaleString()}</dd></div>
            <div><dt>First token at</dt><dd>{ms(tel.durations.timeToFirstTokenMs)}</dd></div>
          </dl>
        </section>
      </div>
    </details>
  );
}
