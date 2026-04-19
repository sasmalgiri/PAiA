// Classroom role UIs.
//
// Three renderer components:
//
//   ClassroomTab       — lives inside Settings. Teacher/student role picker,
//                        policy editor for teachers, join form for students.
//   TeacherDashboard   — full-panel overlay shown while a teacher session
//                        is active. Roster, activity feed, broadcast bar.
//   StudentLock        — full-screen overlay shown while a student session
//                        is active. Shows policy, current focus status, and
//                        any incoming teacher messages. NOT closable.
//
// App.tsx owns the top-level ClassroomState and chooses which overlay to
// show.

import { useEffect, useState } from 'react';
import type {
  ClassroomPolicy,
  ClassroomSession,
  ClassroomState,
  StudentActivity,
} from '../../shared/types';
import { api } from '../lib/api';

// ─── Settings tab ─────────────────────────────────────────────────

export function ClassroomTab() {
  const [state, setState] = useState<ClassroomState>({ role: 'off' });
  const [mode, setMode] = useState<'teacher' | 'student'>('teacher');
  const [teacherName, setTeacherName] = useState('Teacher');
  const [policy, setPolicy] = useState<ClassroomPolicy | null>(null);
  const [joinHost, setJoinHost] = useState('');
  const [joinPort, setJoinPort] = useState(8742);
  const [joinCode, setJoinCode] = useState('');
  const [studentName, setStudentName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    void api.classroomState().then(setState);
    void api.classroomDefaultPolicy().then(setPolicy);
    const off = api.onClassroomState(setState);
    return off;
  }, []);

  if (state.role !== 'off') {
    return (
      <div className="settings-form">
        <div className="muted-note">
          A classroom session is currently active. Use the dashboard/lock overlay to manage it.
          {state.role === 'teacher' && (
            <> The teacher dashboard opens automatically on the main panel.</>
          )}
          {state.role === 'student' && (
            <> You are in a student session. Leave it from the lock screen.</>
          )}
        </div>
      </div>
    );
  }

  async function startTeacher(): Promise<void> {
    if (!policy) return;
    setBusy(true); setErr('');
    const res = await api.classroomStartTeacher({ teacherName, policy });
    setBusy(false);
    if (!res.ok) setErr(res.error ?? 'failed');
  }

  async function joinStudent(): Promise<void> {
    if (!joinHost || !joinCode) return;
    setBusy(true); setErr('');
    const res = await api.classroomJoin({ host: joinHost, port: joinPort, code: joinCode, name: studentName });
    setBusy(false);
    if (!res.ok) setErr(res.error ?? 'failed');
  }

  return (
    <div className="settings-form">
      <div className="muted-note">
        <strong>Classroom mode</strong> turns PAiA into a lab-control tool. A teacher runs a small
        HTTP server on the LAN; students join with a 6-letter code. The teacher sees a live roster +
        activity feed, and can broadcast messages. The student's PAiA enforces a policy (tool
        allow-list, focus-app monitoring, cloud lock). Note: we can detect off-task activity and
        disconnects but cannot <em>prevent</em> a student from closing PAiA without an admin-level
        install.
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <label><input type="radio" checked={mode === 'teacher'} onChange={() => setMode('teacher')} /> Teacher</label>
        <label><input type="radio" checked={mode === 'student'} onChange={() => setMode('student')} /> Student</label>
      </div>

      {mode === 'teacher' && policy && (
        <>
          <label className="field">
            <span>Your name (shown to students)</span>
            <input type="text" value={teacherName} onChange={(e) => setTeacherName(e.target.value)} />
          </label>
          <PolicyEditor policy={policy} onChange={setPolicy} />
          <button type="button" className="primary" disabled={busy} onClick={() => void startTeacher()}>
            {busy ? 'Starting…' : 'Start session'}
          </button>
        </>
      )}

      {mode === 'student' && (
        <>
          <label className="field">
            <span>Teacher host (IP shown on the teacher's dashboard)</span>
            <input type="text" value={joinHost} onChange={(e) => setJoinHost(e.target.value)} placeholder="192.168.1.42" />
          </label>
          <label className="field">
            <span>Port</span>
            <input type="number" value={joinPort} onChange={(e) => setJoinPort(Number(e.target.value) || 8742)} />
          </label>
          <label className="field">
            <span>Join code</span>
            <input type="text" value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} placeholder="ABCDEF" />
          </label>
          <label className="field">
            <span>Your name</span>
            <input type="text" value={studentName} onChange={(e) => setStudentName(e.target.value)} />
          </label>
          <button type="button" className="primary" disabled={busy} onClick={() => void joinStudent()}>
            {busy ? 'Joining…' : 'Join'}
          </button>
        </>
      )}

      {err && <div className="muted-note" style={{ color: '#c0392b' }}>Error: {err}</div>}
    </div>
  );
}

// ─── policy editor ────────────────────────────────────────────────

function PolicyEditor({ policy, onChange }: { policy: ClassroomPolicy; onChange: (p: ClassroomPolicy) => void }) {
  function set<K extends keyof ClassroomPolicy>(k: K, v: ClassroomPolicy[K]): void {
    onChange({ ...policy, [k]: v });
  }
  function setList<K extends keyof ClassroomPolicy>(k: K, raw: string): void {
    const list = raw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    onChange({ ...policy, [k]: list as ClassroomPolicy[K] });
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
      <label className="field">
        <span>Session title</span>
        <input type="text" value={policy.title} onChange={(e) => set('title', e.target.value)} />
      </label>
      <label className="field">
        <span>Duration (minutes, 0 = open-ended)</span>
        <input type="number" min={0} value={policy.durationMinutes} onChange={(e) => set('durationMinutes', Number(e.target.value) || 0)} />
      </label>
      <label className="field">
        <span>Allowed apps (one per line or comma separated — substring match on window title/app)</span>
        <textarea rows={3} value={policy.allowedApps.join('\n')} onChange={(e) => setList('allowedApps', e.target.value)} />
      </label>
      <label className="field">
        <span>Allowed URLs (browsers only)</span>
        <textarea rows={2} value={policy.allowedUrls.join('\n')} onChange={(e) => setList('allowedUrls', e.target.value)} />
      </label>
      <label className="field">
        <span>Blocked URLs (flagged as violations even inside allowed browsers)</span>
        <textarea rows={2} value={policy.blockedUrls.join('\n')} onChange={(e) => setList('blockedUrls', e.target.value)} />
      </label>
      <label className="field row"><span>Allow Agent mode</span><input type="checkbox" checked={policy.allowAgent} onChange={(e) => set('allowAgent', e.target.checked)} /></label>
      <label className="field row"><span>Allow shell.exec</span><input type="checkbox" checked={policy.allowShell} onChange={(e) => set('allowShell', e.target.checked)} /></label>
      <label className="field row"><span>Allow filesystem tools</span><input type="checkbox" checked={policy.allowFs} onChange={(e) => set('allowFs', e.target.checked)} /></label>
      <label className="field row"><span>Allow web tools</span><input type="checkbox" checked={policy.allowWebTools} onChange={(e) => set('allowWebTools', e.target.checked)} /></label>
      <label className="field row"><span>Allow cloud LLM providers</span><input type="checkbox" checked={policy.allowCloudProviders} onChange={(e) => set('allowCloudProviders', e.target.checked)} /></label>
      <label className="field row"><span>Lock student's PAiA panel</span><input type="checkbox" checked={policy.lockPanel} onChange={(e) => set('lockPanel', e.target.checked)} /></label>
      <label className="field">
        <span>Heartbeat interval (seconds)</span>
        <input type="number" min={2} max={60} value={policy.heartbeatSeconds} onChange={(e) => set('heartbeatSeconds', Math.max(2, Math.min(60, Number(e.target.value) || 5)))} />
      </label>
    </div>
  );
}

// ─── teacher dashboard overlay ───────────────────────────────────

interface TeacherDashboardProps {
  state: Extract<ClassroomState, { role: 'teacher' }>;
  onClose: () => void;
}

export function TeacherDashboard({ state, onClose }: TeacherDashboardProps) {
  const [feed, setFeed] = useState<StudentActivity[]>(state.recentActivity);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    const off = api.onClassroomActivity((a) => {
      setFeed((prev) => [a, ...prev].slice(0, 100));
    });
    return off;
  }, []);

  async function end(): Promise<void> {
    if (!confirm('End this session for all students?')) return;
    await api.classroomEndForAll();
    onClose();
  }

  async function broadcast(): Promise<void> {
    const text = msg.trim();
    if (!text) return;
    await api.classroomBroadcast(text);
    setMsg('');
  }

  const { session, students } = state;
  return (
    <div className="classroom-teacher">
      <header className="classroom-header">
        <div>
          <strong>Classroom · {session.title}</strong>
          <div className="classroom-sub">
            Code <code>{session.code}</code> · {session.host}:{session.port} · {students.length} student{students.length === 1 ? '' : 's'}
            {session.endsAt && <> · ends {new Date(session.endsAt).toLocaleTimeString()}</>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="danger" onClick={() => void end()}>End for all</button>
          <button type="button" className="icon-btn" onClick={onClose}>×</button>
        </div>
      </header>

      <div className="classroom-body">
        <aside className="classroom-roster">
          <div className="classroom-section-title">Roster</div>
          {students.length === 0 && <div className="muted-note">Waiting for students to join…</div>}
          {students.map((s) => (
            <div key={s.studentId} className={`classroom-student ${s.online ? 'online' : 'offline'}`}>
              <div>
                <strong>{s.name}</strong>
                {s.violations > 0 && <span className="classroom-violations"> · {s.violations} flag{s.violations === 1 ? '' : 's'}</span>}
              </div>
              <div className="classroom-student-meta">{s.machine}</div>
              <div className="classroom-student-meta">
                {s.online ? 'online' : 'offline'} · last seen {new Date(s.lastSeenAt).toLocaleTimeString()}
              </div>
            </div>
          ))}
        </aside>

        <section className="classroom-feed">
          <div className="classroom-section-title">Activity ({feed.length})</div>
          <div className="classroom-feed-list">
            {feed.length === 0 && <div className="muted-note">No activity yet.</div>}
            {feed.map((a) => (
              <div key={a.id} className={`feed-row feed-${a.kind}`}>
                <span className="feed-time">{new Date(a.at).toLocaleTimeString()}</span>
                <span className="feed-name">{a.studentName}</span>
                <span className="feed-kind">{a.kind}</span>
                <span className="feed-detail">{a.detail}</span>
              </div>
            ))}
          </div>
          <div className="classroom-broadcast">
            <input
              type="text"
              placeholder="Broadcast a message to all students…"
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void broadcast(); }}
            />
            <button type="button" className="primary" onClick={() => void broadcast()}>Send</button>
          </div>
        </section>
      </div>
    </div>
  );
}

// ─── student lock overlay ────────────────────────────────────────

interface StudentLockProps {
  state: Extract<ClassroomState, { role: 'student' }>;
  incoming: { kind: 'end' | 'message'; text: string }[];
  onDismissMessage: (idx: number) => void;
  onLeave: () => void;
}

export function StudentLock({ state, incoming, onDismissMessage, onLeave }: StudentLockProps) {
  const { session, focus } = state;
  const policy = session.policy;
  const onTask = focus?.onTask ?? true;

  return (
    <div className={`classroom-student-lock ${onTask ? 'on-task' : 'off-task'}`}>
      <div className="lock-card">
        <div className="lock-title">{policy.title}</div>
        <div className="lock-sub">
          Teacher: <strong>{session.teacherName}</strong>
          {session.endsAt && <> · ends {new Date(session.endsAt).toLocaleTimeString()}</>}
        </div>

        <div className={`lock-focus ${onTask ? 'ok' : 'bad'}`}>
          {focus ? (
            <>
              <div className="lock-focus-label">{onTask ? 'On task' : 'Off task — your teacher will see this'}</div>
              <div className="lock-focus-detail">{focus.app} · {focus.title}</div>
            </>
          ) : (
            <div className="lock-focus-label">Waiting for focus data…</div>
          )}
        </div>

        <div className="lock-policy">
          <div><strong>Allowed apps:</strong> {policy.allowedApps.slice(0, 8).join(', ')}{policy.allowedApps.length > 8 ? '…' : ''}</div>
          {policy.allowedUrls.length > 0 && <div><strong>Allowed URLs:</strong> {policy.allowedUrls.slice(0, 5).join(', ')}</div>}
          <div className="lock-policy-flags">
            {policy.allowAgent ? '✓ agent' : '✗ agent'}{' · '}
            {policy.allowShell ? '✓ shell' : '✗ shell'}{' · '}
            {policy.allowFs ? '✓ fs' : '✗ fs'}{' · '}
            {policy.allowWebTools ? '✓ web' : '✗ web'}{' · '}
            {policy.allowCloudProviders ? '✓ cloud' : '✗ cloud'}
          </div>
        </div>

        <div className="lock-status">
          {state.connected ? (
            <span className="dot ok"></span>
          ) : (
            <span className="dot bad"></span>
          )}{' '}
          {state.connected ? 'connected' : `disconnected${state.lastError ? ': ' + state.lastError : ''}`}
          {state.violations > 0 && <> · {state.violations} flag{state.violations === 1 ? '' : 's'}</>}
        </div>

        {incoming.length > 0 && (
          <div className="lock-messages">
            {incoming.map((m, i) => (
              <div key={i} className={`lock-message ${m.kind === 'end' ? 'end' : ''}`}>
                <span>{m.text}</span>
                <button type="button" className="icon-btn" onClick={() => onDismissMessage(i)}>×</button>
              </div>
            ))}
          </div>
        )}

        <button type="button" className="secondary" onClick={() => {
          if (confirm('Leave this session? Your teacher will be notified.')) onLeave();
        }}>Leave session</button>
      </div>
    </div>
  );
}
