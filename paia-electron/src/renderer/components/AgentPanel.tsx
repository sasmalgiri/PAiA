// Live view for an agent run.
//
// Shows the evolving step list, the currently-executing tool call (if any),
// and an approval prompt when the run is blocked. The parent owns the
// "currently open" runId — this component just subscribes to IPC events.

import { useEffect, useState } from 'react';
import type {
  AgentApprovalRequest,
  AgentRun,
  AgentStep,
} from '../../shared/types';
import { api } from '../lib/api';

interface AgentPanelProps {
  run: AgentRun;
  onClose: () => void;
  /** Approval requests that arrived from the main process. */
  approval: AgentApprovalRequest | null;
  onApprove: (allow: boolean) => void;
}

export function AgentPanel({ run: initialRun, onClose, approval, onApprove }: AgentPanelProps) {
  const [run, setRun] = useState<AgentRun>(initialRun);
  const [steps, setSteps] = useState<AgentStep[]>([]);

  useEffect(() => {
    void api.agentListSteps(initialRun.id).then(setSteps);
  }, [initialRun.id]);

  useEffect(() => {
    const offRun = api.onAgentRun((r) => {
      if (r.id === run.id) setRun(r);
    });
    const offStep = api.onAgentStep((s) => {
      if (s.runId !== run.id) return;
      setSteps((prev) => {
        if (prev.some((p) => p.id === s.id)) return prev;
        return [...prev, s];
      });
    });
    return () => {
      offRun();
      offStep();
    };
  }, [run.id]);

  const done = run.status === 'done' || run.status === 'error' || run.status === 'aborted';

  return (
    <div className="agent-panel">
      <header className="agent-panel-header">
        <div>
          <div className="agent-status-line">
            <span className={`dot ${run.status === 'done' ? 'ok' : run.status === 'error' ? 'bad' : ''}`} />
            <strong>Agent: {run.goal.slice(0, 60)}{run.goal.length > 60 ? '…' : ''}</strong>
          </div>
          <div className="agent-sub">
            {run.status} · {steps.length} step{steps.length === 1 ? '' : 's'} · autonomy={run.autonomy}
          </div>
        </div>
        <div className="agent-panel-actions">
          {!done && (
            <button type="button" className="secondary" onClick={() => void api.agentAbort(run.id)}>
              Abort
            </button>
          )}
          <button type="button" className="icon-btn" onClick={onClose}>×</button>
        </div>
      </header>

      <div className="agent-steps">
        {steps.length === 0 && <div className="agent-empty">Thinking…</div>}
        {steps.map((s) => (
          <StepRow key={s.id} step={s} />
        ))}
      </div>

      {approval && approval.runId === run.id && (
        <div className="agent-approval">
          <div className="approval-title">
            Approve tool call? <span className={`risk risk-${approval.risk}`}>{approval.risk}</span>
          </div>
          <div className="approval-tool">
            <code>{approval.tool}</code> — {approval.description}
          </div>
          <pre className="approval-args">{JSON.stringify(approval.args, null, 2)}</pre>
          <div className="approval-buttons">
            <button type="button" className="secondary" onClick={() => onApprove(false)}>Deny</button>
            <button type="button" className="primary" onClick={() => onApprove(true)}>Approve</button>
          </div>
        </div>
      )}

      {done && run.summary && (
        <div className="agent-final">
          <div className="agent-final-label">Result</div>
          <div className="agent-final-text">{run.summary}</div>
        </div>
      )}
    </div>
  );
}

function StepRow({ step }: { step: AgentStep }) {
  if (step.kind === 'thought') {
    return (
      <div className="step step-thought">
        <div className="step-kind">💭 thought</div>
        <div className="step-body">{step.content}</div>
      </div>
    );
  }
  if (step.kind === 'tool') {
    return (
      <div className={`step step-tool ${step.tool?.error ? 'step-error' : ''}`}>
        <div className="step-kind">
          🛠 <code>{step.tool?.name}</code>
          {step.tool && <span className="step-ms"> ({step.tool.durationMs}ms)</span>}
        </div>
        <pre className="step-args">{JSON.stringify(step.tool?.args ?? {}, null, 2)}</pre>
        {step.tool?.error && <div className="step-error-text">Error: {step.tool.error}</div>}
        {step.tool?.result && (
          <pre className="step-result">{step.tool.result.length > 1500 ? step.tool.result.slice(0, 1500) + '\n…' : step.tool.result}</pre>
        )}
      </div>
    );
  }
  if (step.kind === 'final') {
    return (
      <div className="step step-final">
        <div className="step-kind">✅ final</div>
        <div className="step-body">{step.content}</div>
      </div>
    );
  }
  if (step.kind === 'error') {
    return (
      <div className="step step-error">
        <div className="step-kind">⚠ error</div>
        <div className="step-body">{step.content}</div>
      </div>
    );
  }
  return (
    <div className="step">
      <div className="step-kind">{step.kind}</div>
      <div className="step-body">{step.content}</div>
    </div>
  );
}
