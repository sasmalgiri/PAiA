// Canvas side panel — editable artifacts the model has emitted (code,
// markdown, html). Click an artifact to view/edit; saving bumps the
// version number. The model can refer to artifact ids, so a subsequent
// "rewrite this" prompt works without re-pasting the whole file.

import { useEffect, useRef, useState } from 'react';
import type { Artifact } from '../../shared/types';
import { api } from '../lib/api';
import { renderMarkdown, renderDiagramsInside } from '../lib/markdown';
import { InputModal } from './InputModal';

interface Props {
  threadId: string | null;
  onClose: () => void;
  initialArtifactId?: string | null;
}

export function Canvas({ threadId, onClose, initialArtifactId }: Props) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selected, setSelected] = useState<Artifact | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [titlePromptOpen, setTitlePromptOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  async function refresh(): Promise<void> {
    const list = await api.artifactsList(threadId ?? undefined);
    setArtifacts(list);
    if (!selected && list.length > 0) {
      setSelected(list.find((a) => a.id === initialArtifactId) ?? list[0]);
    }
  }

  useEffect(() => {
    void refresh();
  }, [threadId]);

  useEffect(() => {
    setDraft(selected?.content ?? '');
    setEditing(false);
  }, [selected?.id]);

  async function save(): Promise<void> {
    if (!selected) return;
    const next = await api.artifactsUpdate(selected.id, draft);
    if (next) {
      setSelected(next);
      setEditing(false);
      void refresh();
    }
  }

  async function remove(id: string): Promise<void> {
    if (!confirm('Delete this artifact?')) return;
    await api.artifactsDelete(id);
    if (selected?.id === id) setSelected(null);
    void refresh();
  }

  async function copy(): Promise<void> {
    if (!selected) return;
    await navigator.clipboard.writeText(selected.content);
  }

  async function createArtifactWithTitle(title: string): Promise<void> {
    const created = await api.artifactsCreate({
      threadId,
      title,
      kind: 'code',
      language: 'txt',
      content: '',
    });
    await refresh();
    setSelected(created);
    setEditing(true);
  }

  return (
    <div className="canvas-panel">
      <header className="canvas-header">
        <strong>Canvas</strong>
        <div className="canvas-header-actions">
          <button type="button" className="secondary" onClick={() => setTitlePromptOpen(true)}>+ New</button>
          <button type="button" className="icon-btn" onClick={onClose}>×</button>
        </div>
      </header>

      <div className="canvas-body">
        <aside className="canvas-list">
          {artifacts.length === 0 && <div className="canvas-empty">No artifacts yet.</div>}
          {artifacts.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`canvas-item ${selected?.id === a.id ? 'active' : ''}`}
              onClick={() => setSelected(a)}
            >
              <div className="canvas-item-title">{a.title}</div>
              <div className="canvas-item-meta">
                {a.kind}/{a.language} · v{a.version}
              </div>
            </button>
          ))}
        </aside>

        <section className="canvas-content">
          {!selected && <div className="canvas-empty-large">Select an artifact or create a new one.</div>}
          {selected && (
            <>
              <div className="canvas-toolbar">
                <span className="canvas-title">{selected.title}</span>
                <span className="canvas-meta">{selected.kind}/{selected.language} · v{selected.version}</span>
                <div className="canvas-spacer" />
                {editing ? (
                  <>
                    <button type="button" className="secondary" onClick={() => { setDraft(selected.content); setEditing(false); }}>Cancel</button>
                    <button type="button" className="primary" onClick={() => void save()}>Save</button>
                  </>
                ) : (
                  <>
                    <button type="button" className="secondary" onClick={() => void copy()}>Copy</button>
                    <button type="button" className="secondary" onClick={() => void remove(selected.id)}>Delete</button>
                    <button type="button" className="primary" onClick={() => { setEditing(true); setTimeout(() => textareaRef.current?.focus(), 0); }}>Edit</button>
                  </>
                )}
              </div>
              {editing ? (
                <textarea
                  ref={textareaRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="canvas-editor"
                />
              ) : selected.kind === 'markdown' ? (
                <div
                  className="markdown canvas-view"
                  ref={(el) => { if (el) void renderDiagramsInside(el); }}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(selected.content) }}
                />
              ) : selected.kind === 'html' || selected.kind === 'svg' ? (
                <div className="canvas-view canvas-preview">
                  <iframe
                    title={selected.title}
                    sandbox=""
                    srcDoc={selected.content}
                    className="canvas-iframe"
                  />
                </div>
              ) : (
                <pre className="canvas-view canvas-code">
                  <code className={`hljs language-${selected.language}`}>{selected.content}</code>
                </pre>
              )}
            </>
          )}
        </section>
      </div>
      {titlePromptOpen && (
        <InputModal
          title="New artifact"
          description="Name this draft. You can change it later."
          placeholder="e.g. Marketing brief v1"
          submitLabel="Create"
          onCancel={() => setTitlePromptOpen(false)}
          onSubmit={async (title) => {
            setTitlePromptOpen(false);
            await createArtifactWithTitle(title);
          }}
        />
      )}
    </div>
  );
}
