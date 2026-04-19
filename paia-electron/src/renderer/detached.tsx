// Entry point for detached chat windows.
//
// Opened when the user clicks "Detach" on a thread in the main Panel's
// sidebar. Loads exactly one thread in a stand-alone window that shares
// the same DB, provider, persona, and memory pipeline as the main
// window — it's literally another renderer talking to the same main
// process. Closing the window doesn't delete the thread; reopening
// starts a fresh detached view on the same conversation.
//
// Intentionally slim: no ball, no settings, no ambient toast, no
// quick-actions. Just a single Panel-style chat view for the thread.

import { createRoot } from 'react-dom/client';
import { useCallback, useEffect, useState } from 'react';
import type { DbAttachment, DbMessage, DbThread, Persona, Settings } from '../shared/types';
import { api } from './lib/api';
import { setLocale } from './lib/i18n';
import { Panel } from './components/Panel';

function parseThreadId(): string | null {
  const usp = new URLSearchParams(window.location.search);
  return usp.get('thread');
}

function DetachedApp() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [thread, setThread] = useState<DbThread | null>(null);
  const [messages, setMessages] = useState<DbMessage[]>([]);
  const threadId = parseThreadId();

  useEffect(() => {
    void (async () => {
      const s = await api.getSettings();
      setSettings(s);
      setLocale(s.locale);
      setPersonas(await api.listPersonas());
      if (!threadId) return;
      const t = await api.getThread(threadId);
      if (t) {
        setThread(t);
        setMessages(await api.listMessages(t.id));
      }
    })();
  }, [threadId]);

  // Apply theme locally so detached windows honour the user's selection.
  useEffect(() => {
    if (!settings) return;
    const root = document.documentElement;
    if (settings.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', settings.theme);
  }, [settings?.theme]);

  const sendMessage = useCallback(async (text: string, attachments: Omit<DbAttachment, 'id' | 'messageId'>[]) => {
    if (!settings || !thread) return;
    const persona = personas.find((p) => p.id === settings.personaId) ?? personas[0];
    const systemPrompt = persona?.systemPrompt ?? 'You are a helpful assistant.';
    const model = thread.model ?? settings.model;
    if (!model) return;

    const optimisticUser: DbMessage = {
      id: 'opt-user-' + Date.now(), threadId: thread.id, role: 'user', content: text,
      createdAt: Date.now(), redactedCount: 0,
      attachments: attachments.map((a, i) => ({ ...a, id: `opt-${i}`, messageId: 'opt' })),
    };
    const optimisticAssistant: DbMessage = {
      id: 'opt-asst-' + Date.now(), threadId: thread.id, role: 'assistant', content: '',
      createdAt: Date.now(), redactedCount: 0, attachments: [],
    };
    setMessages((prev) => [...prev, optimisticUser, optimisticAssistant]);

    const offTok = api.onChatToken(({ threadId: tid, token }) => {
      if (tid !== thread.id) return;
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === 'assistant') next[next.length - 1] = { ...last, content: last.content + token };
        return next;
      });
    });
    try {
      await api.chatSend({ threadId: thread.id, model, systemPrompt, userText: text, attachments });
      setMessages(await api.listMessages(thread.id));
    } finally {
      offTok();
    }
  }, [settings, thread, personas]);

  if (!settings || !threadId) {
    return <div style={{ padding: 40, color: 'var(--muted)' }}>No thread specified.</div>;
  }
  if (!thread) {
    return <div style={{ padding: 40, color: 'var(--muted)' }}>Thread not found.</div>;
  }

  return (
    <Panel
      settings={settings}
      personas={personas}
      threads={[thread]}
      currentThread={thread}
      messages={messages}
      onClose={() => window.close()}
      onOpenSettings={() => { /* Settings lives in the main window. */ }}
      onOpenThread={() => { /* single-thread window */ }}
      onNewThread={() => { /* disabled in detached mode */ }}
      onDeleteThread={() => { /* disabled */ }}
      onSend={sendMessage}
      onPersonaChange={(id) => {
        void api.saveSettings({ personaId: id });
        setSettings((s) => (s ? { ...s, personaId: id } : s));
      }}
      onModelChange={(m) => {
        void api.updateThread(thread.id, { model: m });
        setThread({ ...thread, model: m });
      }}
      onStartAgent={() => { /* could wire later */ }}
      onStartResearch={() => { /* could wire later */ }}
      onOpenCanvas={() => { /* canvas lives in the main window */ }}
    />
  );
}

const rootEl = document.getElementById('root');
if (rootEl) createRoot(rootEl).render(<DetachedApp />);
