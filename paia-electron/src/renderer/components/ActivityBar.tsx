// Thin indeterminate progress strip shown at the top of the chat panel
// whenever ANY long-running main-process work is active. Subscribes to
// the event streams each subsystem already emits, so nothing new needs
// to be instrumented downstream.
//
// The bar debounces: it only shows if work has been ongoing for >300 ms,
// so very short operations (a 200 ms cloud call) don't flash a bar.

import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

export function ActivityBar() {
  const [visible, setVisible] = useState(false);
  const activeRef = useRef(new Set<string>());
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const start = (key: string): void => {
      activeRef.current.add(key);
      // Debounce: only reveal after 300 ms so fast operations don't flash.
      if (showTimerRef.current) return;
      showTimerRef.current = setTimeout(() => {
        showTimerRef.current = null;
        if (activeRef.current.size > 0) setVisible(true);
      }, 300);
    };
    const end = (key: string): void => {
      activeRef.current.delete(key);
      if (activeRef.current.size > 0) return;
      if (showTimerRef.current) {
        clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }
      // Briefly linger after the last work ends so a continuous
      // operation that reopens within 100 ms looks seamless.
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => setVisible(false), 150);
    };

    // ── Chat streaming ──
    const offChat = api.onChatToken(() => start('chat'));
    const offChatDone = api.onChatDone(() => end('chat'));
    const offChatErr = api.onChatError(() => end('chat'));

    // ── Agent runs ──
    const offAgent = api.onAgentRun((run) => {
      const key = `agent:${run.id}`;
      if (run.status === 'running' || run.status === 'awaiting-approval') start(key);
      else end(key);
    });

    // ── Research runs ──
    const offResearch = api.onResearchRun((run) => {
      const key = `research:${run.id}`;
      if (run.status === 'done' || run.status === 'error') end(key);
      else start(key);
    });

    // ── RAG ingestion ──
    const offIngest = api.onIngestProgress((p) => {
      const key = `ingest:${p.collectionId}`;
      if (p.stage === 'done' || p.stage === 'error') end(key);
      else start(key);
    });

    // ── Sync ──
    const offSync = api.onSyncProgress((p) => {
      if (p.stage === 'done' || p.stage === 'error') end('sync');
      else start('sync');
    });

    // ── Ollama model pull ──
    const offPull = api.onOllamaPullProgress((p) => {
      const key = `pull:${p.name}`;
      if (p.status?.toLowerCase().includes('success') || p.status?.toLowerCase().includes('error')) end(key);
      else start(key);
    });

    return () => {
      offChat();
      offChatDone();
      offChatErr();
      offAgent();
      offResearch();
      offIngest();
      offSync();
      offPull();
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  if (!visible) return null;
  return (
    <div className="activity-bar" role="progressbar" aria-label="Activity in progress" aria-busy="true">
      <div className="activity-bar-track" />
    </div>
  );
}
