// Canvas side panel — editable artifacts the model has emitted (code,
// markdown, html). Click an artifact to view/edit; saving bumps the
// version number. The model can refer to artifact ids, so a subsequent
// "rewrite this" prompt works without re-pasting the whole file.

import { useEffect, useRef, useState } from 'react';
import type { Artifact } from '../../shared/types';
import { api } from '../lib/api';
import { renderMarkdown, renderDiagramsInside } from '../lib/markdown';
import { InputModal } from './InputModal';
import { Whiteboard } from './Whiteboard';

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
  const [titlePromptOpen, setTitlePromptOpen] = useState<false | 'code' | 'whiteboard'>(false);
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

  async function createArtifactWithTitle(title: string, kind: 'code' | 'whiteboard' = 'code'): Promise<void> {
    const created = await api.artifactsCreate({
      threadId,
      title,
      kind,
      language: kind === 'whiteboard' ? 'excalidraw' : 'txt',
      content: kind === 'whiteboard' ? '{"elements":[],"appState":{}}' : '',
    });
    await refresh();
    setSelected(created);
    // Whiteboards edit live; text artifacts open in edit mode.
    setEditing(kind !== 'whiteboard');
  }

  // Whiteboards autosave as the user draws — we keep a debounce so rapid
  // pointer moves don't hammer the DB.
  const whiteboardSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  async function saveWhiteboard(next: string): Promise<void> {
    if (!selected) return;
    if (whiteboardSaveTimerRef.current) clearTimeout(whiteboardSaveTimerRef.current);
    whiteboardSaveTimerRef.current = setTimeout(async () => {
      const updated = await api.artifactsUpdate(selected.id, next);
      if (updated) setSelected(updated);
    }, 400);
  }

  return (
    <div className="canvas-panel">
      <header className="canvas-header">
        <strong>Canvas</strong>
        <div className="canvas-header-actions">
          <button type="button" className="secondary" onClick={() => setTitlePromptOpen('code')}>+ New</button>
          <button type="button" className="secondary" onClick={() => setTitlePromptOpen('whiteboard')} title="New whiteboard">+ Whiteboard</button>
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
              {selected.kind === 'whiteboard' ? (
                <div className="canvas-view canvas-whiteboard">
                  <Whiteboard value={selected.content} onChange={(n) => void saveWhiteboard(n)} />
                </div>
              ) : editing ? (
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
          title={titlePromptOpen === 'whiteboard' ? 'New whiteboard' : 'New artifact'}
          description={titlePromptOpen === 'whiteboard' ? 'Name this whiteboard. Drawing autosaves as you go.' : 'Name this draft. You can change it later.'}
          placeholder={titlePromptOpen === 'whiteboard' ? 'e.g. Motor winding v1' : 'e.g. Marketing brief v1'}
          submitLabel="Create"
          onCancel={() => setTitlePromptOpen(false)}
          onSubmit={async (title) => {
            const kind = titlePromptOpen;
            setTitlePromptOpen(false);
            if (kind) await createArtifactWithTitle(title, kind);
          }}
        />
      )}
    </div>
  );
}
