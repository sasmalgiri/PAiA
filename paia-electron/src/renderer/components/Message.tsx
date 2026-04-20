// Single chat message. Renders Markdown for assistant responses, plain
// wrapped text for user input. Code blocks get a "copy" button injected
// after render.

import { useEffect, useRef } from 'react';
import type { DbMessage } from '../../shared/types';
import { renderMarkdown, renderDiagramsInside } from '../lib/markdown';

interface MessageProps {
  message: DbMessage;
  streaming?: boolean;
}

export function Message({ message, streaming }: MessageProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // After every render, attach copy buttons to <pre> blocks. We do this
  // imperatively rather than re-rendering React because the markdown HTML
  // is set via dangerouslySetInnerHTML.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const pres = el.querySelectorAll('pre');
    pres.forEach((pre) => {
      if (pre.querySelector('.copy-btn')) return;
      const btn = document.createElement('button');
      btn.className = 'copy-btn';
      btn.textContent = 'copy';
      btn.addEventListener('click', () => {
        const code = pre.querySelector('code');
        if (!code) return;
        navigator.clipboard.writeText(code.textContent ?? '').then(
          () => {
            btn.textContent = 'copied';
            setTimeout(() => (btn.textContent = 'copy'), 1500);
          },
          () => {
            // Clipboard can be blocked by permission or a non-secure context.
            btn.textContent = 'copy failed';
            setTimeout(() => (btn.textContent = 'copy'), 2000);
          },
        );
      });
      pre.appendChild(btn);
    });
    // Render any mermaid/SMILES blocks that haven't been rendered yet.
    // We skip this while a response is still streaming so we don't try to
    // parse a half-finished diagram on every token.
    if (!streaming) {
      void renderDiagramsInside(el);
    }
  });

  if (message.role === 'system') {
    return <div className={`msg system`}>{message.content}</div>;
  }

  if (message.role === 'user') {
    return (
      <div className="msg user">
        {message.attachments.length > 0 && (
          <div className="msg-attachments">
            {message.attachments.map((a) => (
              <div key={a.id} className="msg-attachment" title={a.filename}>
                {a.kind === 'image' ? (
                  <img src={a.content} alt={a.filename} />
                ) : (
                  <span>📎 {a.filename}</span>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="msg-body">{message.content}</div>
        {message.redactedCount > 0 && (
          <div className="msg-meta">🛡 Redacted {message.redactedCount} PII item(s) before send</div>
        )}
      </div>
    );
  }

  // assistant
  return (
    <div className="msg assistant">
      <div
        ref={bodyRef}
        className="msg-body markdown"
        // marked escapes raw HTML inside markdown by default.
        dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content || (streaming ? '…' : '')) }}
      />
    </div>
  );
}
