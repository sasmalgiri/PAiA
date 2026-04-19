// Modal that pops when an MCP tool wants to run. The user must explicitly
// approve or deny. Approval requests come from main via the
// `paia:mcp-tool-approval` channel; the response goes back through
// `api.mcpApprove(requestId, allow)`.

import { useRef } from 'react';
import type { McpToolCallApprovalRequest } from '../../shared/types';
import { useFocusTrap } from '../lib/focusTrap';

interface Props {
  request: McpToolCallApprovalRequest;
  onApprove: () => void;
  onDeny: () => void;
}

export function McpApprovalModal({ request, onApprove, onDeny }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(containerRef, { onClose: onDeny });

  let prettyArgs = '';
  try {
    prettyArgs = JSON.stringify(request.args, null, 2);
  } catch {
    prettyArgs = String(request.args);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal"
        ref={containerRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="mcp-approval-title"
        aria-describedby="mcp-approval-desc"
      >
        <div className="modal-title" id="mcp-approval-title">
          <span>🛡 Tool call approval</span>
        </div>
        <div className="modal-body" id="mcp-approval-desc">
          <p>
            <strong>{request.serverName}</strong> wants to call tool{' '}
            <code>{request.toolName}</code>.
          </p>
          <p className="muted-note">Inputs:</p>
          <pre className="modal-args">{prettyArgs}</pre>
          <p className="muted-note">
            Tool calls run on your machine but can read files, hit URLs, or run code
            depending on what the server is configured to do. Only approve calls you
            understand.
          </p>
        </div>
        <div className="modal-actions">
          <button type="button" className="danger" onClick={onDeny}>Deny</button>
          <button type="button" className="primary" onClick={onApprove}>Approve</button>
        </div>
      </div>
    </div>
  );
}
