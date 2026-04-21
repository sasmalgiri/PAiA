// Classroom / lab control mode.
//
// Two roles:
//
//   TEACHER — runs a small HTTP server on the LAN, hands out a 6-letter
//             join code, collects student heartbeats + activity events,
//             pushes commands ("end session", "broadcast message").
//
//   STUDENT — joins by entering the teacher's host + code, then runs a
//             heartbeat loop. PAiA's panel locks always-on-top, the
//             close button becomes a "you are in a session" warning,
//             the active-window monitor flags non-allowed apps, and
//             the Agent tool registry consults policy.canUseTool().
//
// Transport is plain HTTP+JSON with HMAC-signed payloads. No WebSocket
// dep required, no ports opened unless the teacher explicitly starts a
// session. Session keys are derived from the join code via PBKDF2 so a
// casual LAN sniffer can't impersonate a student without the code.
//
// HONEST LIMITS (surfaced in the UI too):
//   • We cannot prevent a student from force-quitting PAiA or the Node
//     runtime. We CAN detect the disconnect and flag it to the teacher.
//   • We cannot truly block other apps from launching. We can detect
//     active-window switches and log/report violations.
//   • Real enforcement (app whitelisting, kiosk lock) needs an OS-level
//     MDM / admin install — out of scope for a user-space Electron app.

import { app, ipcMain, BrowserWindow } from 'electron';
import * as http from 'http';
import * as os from 'os';
import * as crypto from 'crypto';
import type {
  ClassroomPolicy,
  ClassroomRole,
  ClassroomSession,
  ClassroomState,
  StudentActivity,
  StudentActivityKind,
  StudentInfo,
} from '../shared/types';
import { getActiveWindow } from './activeWindow';
import { requireFeature } from './license';
import { logger } from './logger';

// ─── defaults ─────────────────────────────────────────────────────

export const DEFAULT_POLICY: ClassroomPolicy = {
  title: 'Class session',
  durationMinutes: 45,
  allowedApps: ['vscode', 'code.exe', 'code', 'terminal', 'cmd.exe', 'powershell', 'iterm', 'chrome', 'firefox', 'safari', 'edge'],
  allowedUrls: ['github.com', 'stackoverflow.com', 'developer.mozilla.org', 'docs.python.org'],
  blockedUrls: ['youtube.com/watch', 'netflix.com', 'tiktok.com', 'reddit.com', 'instagram.com', 'twitter.com', 'x.com', 'facebook.com'],
  allowAgent: true,
  allowShell: false,
  allowFs: true,
  allowWebTools: true,
  allowCloudProviders: false,
  lockPanel: true,
  heartbeatSeconds: 5,
};

const DEFAULT_PORT = 8742;

// ─── runtime state ────────────────────────────────────────────────

let role: ClassroomRole = 'off';
let activeWindow: BrowserWindow | null = null;

// Teacher state
let teacherSession: ClassroomSession | null = null;
let teacherKey: Buffer | null = null;
let teacherPublicKey: Buffer | null = null;
let teacherServer: http.Server | null = null;
let teacherSweepInterval: NodeJS.Timeout | null = null;
const studentMap = new Map<string, StudentInfo>();
const activityLog: StudentActivity[] = [];
const pendingCommands = new Map<string, TeacherCommand[]>();

// Student state
let studentSession: ClassroomSession | null = null;
let studentId = '';
let studentName = '';
let studentKey: Buffer | null = null;
let studentTimer: NodeJS.Timeout | null = null;
let studentLastError: string | undefined;
let studentViolations = 0;
let studentLastFocus: { title: string; app: string; onTask: boolean } | undefined;
let lastActiveAppKey = '';
let lastActiveUrl = '';

// ─── helpers ──────────────────────────────────────────────────────

export function setActiveWindow(win: BrowserWindow): void {
  activeWindow = win;
}

function send(channel: string, payload: unknown): void {
  activeWindow?.webContents.send(channel, payload);
}

function hostLanIp(): string {
  const nets = os.networkInterfaces();
  for (const key of Object.keys(nets)) {
    for (const iface of nets[key] ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

function deriveKey(code: string, sessionId: string): Buffer {
  return crypto.pbkdf2Sync(code.toUpperCase(), `paia-classroom:${sessionId}`, 50000, 32, 'sha256');
}

function derivePublicKey(code: string): Buffer {
  // Used for the very first /join call, before the client knows the
  // sessionId. Low entropy (the 6-letter code alone) is fine because
  // the server rotates sessions on every start and the code is only
  // valid for the duration of the current session.
  return crypto.pbkdf2Sync(code.toUpperCase(), `paia-classroom:public`, 50000, 32, 'sha256');
}

function sign(key: Buffer, body: string): string {
  return crypto.createHmac('sha256', key).update(body).digest('base64');
}

function verify(key: Buffer, body: string, mac: string): boolean {
  const expected = sign(key, body);
  // timingSafeEqual requires equal-length inputs.
  if (expected.length !== mac.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(mac));
}

function genCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
}

function logActivity(a: StudentActivity): void {
  activityLog.unshift(a);
  if (activityLog.length > 500) activityLog.pop();
  send('paia:classroom-activity', a);
  send('paia:classroom-state', getState());
}

// ─── policy checks (called by the Agent + tools) ──────────────────

export function isStudent(): boolean {
  return role === 'student' && studentSession !== null;
}

export function currentPolicy(): ClassroomPolicy | null {
  return studentSession?.policy ?? null;
}

/**
 * Called by the built-in tool executor for each agent tool call. Returns
 * null if allowed, or a reason string if the active classroom policy
 * blocks this tool for the student.
 */
export function checkToolAllowed(toolName: string, category: string): string | null {
  if (!isStudent()) return null;
  const policy = studentSession!.policy;
  if (!policy.allowAgent) return 'Agent mode is disabled by your classroom policy.';
  if (category === 'shell' && !policy.allowShell) return 'Shell execution is disabled in this session.';
  if (category === 'fs' && !policy.allowFs) return 'Filesystem tools are disabled in this session.';
  if (category === 'web' && !policy.allowWebTools) return 'Web tools are disabled in this session.';
  // Connector tools stay blocked outright — student accounts shouldn't be
  // running arbitrary calendar / email / Slack actions during class.
  if (category === 'connector') return 'Connector tools are disabled during class.';
  void toolName; // reserved for future per-tool denylists
  return null;
}

export function checkCloudAllowed(): boolean {
  if (!isStudent()) return true;
  return studentSession!.policy.allowCloudProviders;
}

// ─── teacher: HTTP server ─────────────────────────────────────────

interface TeacherCommand {
  id: string;
  kind: 'end' | 'message' | 'policy';
  payload?: unknown;
  createdAt: number;
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      try {
        resolve(raw ? JSON.parse(raw) : null);
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function respond(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(text);
}

interface SignedPacket<T> {
  body: T;
  mac: string;
  ts: number;
}

// Anti-replay: reject any packet whose timestamp is more than 30 s
// off from our clock. Classroom sessions are LAN-local and don't have
// enough clock skew to justify a wider window. Also rejects packets
// with obviously tampered `ts` values (0, negative, far-future).
const MAX_CLOCK_SKEW_MS = 30_000;

function extractPacket<T>(raw: unknown): SignedPacket<T> | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.mac !== 'string' || typeof r.ts !== 'number' || !r.body) return null;
  const skew = Math.abs(Date.now() - r.ts);
  if (!Number.isFinite(r.ts) || r.ts <= 0 || skew > MAX_CLOCK_SKEW_MS) return null;
  return { body: r.body as T, mac: r.mac, ts: r.ts };
}

function handleTeacherRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  if (!teacherSession || !teacherKey) {
    respond(res, 503, { error: 'No active session' });
    return;
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (url.pathname === '/classroom/info' && req.method === 'GET') {
    respond(res, 200, {
      title: teacherSession.title,
      teacher: teacherSession.teacherName,
      startedAt: teacherSession.startedAt,
      endsAt: teacherSession.endsAt,
    });
    return;
  }

  if (url.pathname === '/classroom/join' && req.method === 'POST') {
    // Snapshot the session + public key at request-entry so a concurrent
    // stopTeacher() can't null them out mid-verify.
    const sessionAtEntry = teacherSession;
    const pubAtEntry = teacherPublicKey;
    void readJson(req).then((raw) => {
      const packet = extractPacket<{ code: string; name: string; machine: string }>(raw);
      // Join uses the public (code-only) key so the client can sign
      // without yet knowing the sessionId.
      if (!packet || !pubAtEntry || !sessionAtEntry || !verify(pubAtEntry, JSON.stringify(packet.body), packet.mac)) {
        respond(res, 401, { error: 'Invalid signature' });
        return;
      }
      if (packet.body.code.toUpperCase() !== sessionAtEntry.code) {
        respond(res, 403, { error: 'Wrong code' });
        return;
      }
      const id = crypto.randomUUID();
      const info: StudentInfo = {
        studentId: id,
        name: packet.body.name || 'Anonymous',
        machine: packet.body.machine || '',
        joinedAt: Date.now(),
        lastSeenAt: Date.now(),
        online: true,
        violations: 0,
      };
      studentMap.set(id, info);
      pendingCommands.set(id, []);
      logActivity({
        id: crypto.randomUUID(),
        studentId: id,
        studentName: info.name,
        at: Date.now(),
        kind: 'joined',
        detail: `${info.name} @ ${info.machine}`,
      });
      respond(res, 200, {
        studentId: id,
        session: sessionAtEntry,
      });
    }).catch((err) => respond(res, 400, { error: String(err) }));
    return;
  }

  if (url.pathname === '/classroom/heartbeat' && req.method === 'POST') {
    // Same snapshot discipline — readJson is async, state can change.
    const keyAtEntry = teacherKey;
    void readJson(req).then((raw) => {
      const packet = extractPacket<{ studentId: string; events: StudentActivity[] }>(raw);
      if (!packet || !keyAtEntry || !verify(keyAtEntry, JSON.stringify(packet.body), packet.mac)) {
        respond(res, 401, { error: 'Invalid signature' });
        return;
      }
      const student = studentMap.get(packet.body.studentId);
      if (!student) {
        respond(res, 404, { error: 'Unknown studentId' });
        return;
      }
      student.lastSeenAt = Date.now();
      student.online = true;
      for (const ev of packet.body.events) {
        if (ev.kind === 'focus-off' || ev.kind === 'violation' || ev.kind === 'tool-denied') {
          student.violations++;
        }
        logActivity(ev);
      }
      const cmds = pendingCommands.get(packet.body.studentId) ?? [];
      pendingCommands.set(packet.body.studentId, []);
      respond(res, 200, { commands: cmds });
    }).catch((err) => respond(res, 400, { error: String(err) }));
    return;
  }

  respond(res, 404, { error: 'Not found' });
}

export function startTeacher(opts: {
  teacherName: string;
  policy: ClassroomPolicy;
  port?: number;
}): ClassroomSession {
  requireFeature('classroom');
  if (role !== 'off') throw new Error('Another classroom role is already active. Stop it first.');

  const port = opts.port ?? DEFAULT_PORT;
  const sessionId = crypto.randomUUID();
  const code = genCode();
  const now = Date.now();
  teacherKey = deriveKey(code, sessionId);
  teacherPublicKey = derivePublicKey(code);
  teacherSession = {
    sessionId,
    code,
    title: opts.policy.title,
    teacherName: opts.teacherName || os.hostname(),
    host: hostLanIp(),
    port,
    startedAt: now,
    endsAt: opts.policy.durationMinutes > 0 ? now + opts.policy.durationMinutes * 60_000 : undefined,
    policy: opts.policy,
  };
  studentMap.clear();
  activityLog.length = 0;
  pendingCommands.clear();

  teacherServer = http.createServer(handleTeacherRequest);
  teacherServer.listen(port, () => {
    logger.info(`classroom teacher listening on ${teacherSession!.host}:${port}`);
  });
  teacherServer.on('error', (err) => {
    logger.error('teacher server error', err);
  });

  role = 'teacher';

  // Liveness sweep every 10s — mark students offline if they missed 3 heartbeats.
  if (teacherSweepInterval) clearInterval(teacherSweepInterval);
  teacherSweepInterval = setInterval(() => {
    if (role !== 'teacher') {
      if (teacherSweepInterval) clearInterval(teacherSweepInterval);
      teacherSweepInterval = null;
      return;
    }
    const threshold = (teacherSession?.policy.heartbeatSeconds ?? 5) * 3 * 1000;
    let changed = false;
    for (const s of studentMap.values()) {
      const wasOnline = s.online;
      s.online = Date.now() - s.lastSeenAt < threshold;
      if (wasOnline && !s.online) {
        changed = true;
        logActivity({
          id: crypto.randomUUID(),
          studentId: s.studentId,
          studentName: s.name,
          at: Date.now(),
          kind: 'left',
          detail: 'missed heartbeats — may have closed PAiA',
        });
      } else if (!wasOnline && s.online) {
        changed = true;
      }
    }
    if (changed) send('paia:classroom-state', getState());
  }, 10_000);

  send('paia:classroom-state', getState());
  return teacherSession;
}

export function stopTeacher(): void {
  if (role !== 'teacher') return;
  if (teacherSweepInterval) {
    clearInterval(teacherSweepInterval);
    teacherSweepInterval = null;
  }
  if (teacherServer) {
    try { teacherServer.close(); } catch { /* ignore */ }
    teacherServer = null;
  }
  teacherSession = null;
  teacherKey = null;
  teacherPublicKey = null;
  studentMap.clear();
  activityLog.length = 0;
  pendingCommands.clear();
  role = 'off';
  send('paia:classroom-state', getState());
}

export function endSessionForAll(): void {
  if (role !== 'teacher') return;
  for (const id of studentMap.keys()) {
    pendingCommands.set(id, [
      ...(pendingCommands.get(id) ?? []),
      { id: crypto.randomUUID(), kind: 'end', createdAt: Date.now() },
    ]);
  }
  // Give clients a beat to receive the command, then shut down.
  setTimeout(() => stopTeacher(), 3000);
}

export function broadcastMessage(text: string): void {
  if (role !== 'teacher') return;
  for (const id of studentMap.keys()) {
    pendingCommands.set(id, [
      ...(pendingCommands.get(id) ?? []),
      { id: crypto.randomUUID(), kind: 'message', payload: { text }, createdAt: Date.now() },
    ]);
  }
  logActivity({
    id: crypto.randomUUID(),
    studentId: '__teacher__',
    studentName: teacherSession?.teacherName ?? 'Teacher',
    at: Date.now(),
    kind: 'message',
    detail: text,
  });
}

// ─── student: HTTP client ────────────────────────────────────────

interface PendingEvent {
  kind: StudentActivityKind;
  detail: string;
}

const studentEventQueue: PendingEvent[] = [];

function enqueueEvent(kind: StudentActivityKind, detail: string): void {
  studentEventQueue.push({ kind, detail });
  if (kind === 'focus-off' || kind === 'violation' || kind === 'tool-denied') {
    studentViolations++;
  }
}

export async function studentJoin(opts: {
  host: string;
  port: number;
  code: string;
  name: string;
}): Promise<ClassroomSession> {
  if (role !== 'off') throw new Error('Another classroom role is already active. Stop it first.');

  const code = opts.code.trim().toUpperCase();
  const baseUrl = `http://${opts.host}:${opts.port}`;

  // Sanity-check that the teacher is actually reachable before we spin up
  // the heartbeat loop. Turn the usual failures (wrong LAN, firewall,
  // teacher not running) into messages the student can actually act on.
  let infoRes: Response;
  try {
    infoRes = await fetch(`${baseUrl}/classroom/info`, { signal: AbortSignal.timeout(8000) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/abort|timeout/i.test(msg)) {
      throw new Error(
        `Couldn't reach teacher at ${opts.host}:${opts.port} within 8s. Check that you're on the same Wi-Fi and that the teacher has started the session. School Wi-Fi may also block port ${opts.port} — ask the teacher to try a different port from Classroom settings.`,
      );
    }
    if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|network/i.test(msg)) {
      throw new Error(
        `Couldn't open a connection to ${opts.host}:${opts.port}. Either the host/port is wrong, the teacher stopped the session, or a firewall is blocking the connection. Ask the teacher to verify the join info shown in their PAiA window.`,
      );
    }
    throw new Error(`Teacher not reachable at ${opts.host}:${opts.port}: ${msg}`);
  }
  if (!infoRes.ok) {
    throw new Error(
      `Teacher refused the connection (HTTP ${infoRes.status}). Double-check the 6-letter code and ask the teacher to re-share it.`,
    );
  }

  // The very first packet is signed with a code-only key (both sides can
  // derive without any shared state); the teacher returns the sessionId,
  // and both sides then switch to the session-salted key for heartbeats.
  const publicKey = derivePublicKey(code);

  const body = {
    code,
    name: opts.name || os.hostname(),
    machine: `${os.hostname()} (${process.platform})`,
  };
  const bodyStr = JSON.stringify(body);
  const joinRes = await fetch(`${baseUrl}/classroom/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body, mac: sign(publicKey, bodyStr), ts: Date.now() }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!joinRes.ok) {
    const err = await joinRes.text();
    throw new Error(`Join failed: HTTP ${joinRes.status} ${err}`);
  }
  const joinJson = (await joinRes.json()) as { studentId: string; session: ClassroomSession };

  // Switch to per-session key for subsequent heartbeats.
  studentKey = deriveKey(code, joinJson.session.sessionId);
  studentId = joinJson.studentId;
  studentName = body.name;
  studentSession = joinJson.session;
  studentLastError = undefined;
  studentViolations = 0;
  role = 'student';

  startStudentLoop(baseUrl);
  send('paia:classroom-state', getState());
  return joinJson.session;
}

function startStudentLoop(baseUrl: string): void {
  if (studentTimer) {
    clearInterval(studentTimer);
    studentTimer = null;
  }
  const intervalMs = (studentSession?.policy.heartbeatSeconds ?? 5) * 1000;
  studentTimer = setInterval(() => {
    // Guard against a stale closure firing after studentLeave().
    if (role !== 'student') {
      if (studentTimer) clearInterval(studentTimer);
      studentTimer = null;
      return;
    }
    void studentTick(baseUrl);
  }, intervalMs);
  void studentTick(baseUrl);
}

async function studentTick(baseUrl: string): Promise<void> {
  if (role !== 'student' || !studentSession || !studentKey) return;

  // 1. Monitor active window → queue focus events.
  try {
    const aw = await getActiveWindow();
    if (aw) {
      const appKey = (aw.appName || aw.title).toLowerCase();
      const policy = studentSession.policy;
      const allowedApp = policy.allowedApps.length === 0 ||
        policy.allowedApps.some((a) => appKey.includes(a.toLowerCase()));
      const blocked = aw.url
        ? policy.blockedUrls.some((u) => aw.url!.toLowerCase().includes(u.toLowerCase()))
        : false;
      const urlAllowed = !aw.url || policy.allowedUrls.length === 0 ||
        policy.allowedUrls.some((u) => aw.url!.toLowerCase().includes(u.toLowerCase()));
      const onTask = allowedApp && !blocked && urlAllowed;
      studentLastFocus = { title: aw.title, app: aw.appName, onTask };

      if (appKey !== lastActiveAppKey) {
        enqueueEvent('app-switch', `${aw.appName}: ${aw.title}`);
        lastActiveAppKey = appKey;
      }
      if (aw.url && aw.url !== lastActiveUrl) {
        enqueueEvent('url-visit', aw.url);
        lastActiveUrl = aw.url;
      }
      if (!onTask) {
        enqueueEvent('focus-off', `off-task: ${aw.appName}${aw.url ? ' · ' + aw.url : ''}`);
      }
    }
  } catch (err) {
    logger.warn('classroom: active window poll failed', err);
  }

  // 2. Send heartbeat with queued events + receive commands.
  const events: StudentActivity[] = studentEventQueue.splice(0).map((e) => ({
    id: crypto.randomUUID(),
    studentId,
    studentName,
    at: Date.now(),
    kind: e.kind,
    detail: e.detail,
  }));
  // Always include at least a heartbeat so the teacher sees us online.
  if (events.length === 0) {
    events.push({
      id: crypto.randomUUID(),
      studentId,
      studentName,
      at: Date.now(),
      kind: 'heartbeat',
      detail: 'ok',
    });
  }

  const body = { studentId, events };
  const bodyStr = JSON.stringify(body);
  try {
    const res = await fetch(`${baseUrl}/classroom/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, mac: sign(studentKey!, bodyStr), ts: Date.now() }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      studentLastError = `HTTP ${res.status}`;
    } else {
      studentLastError = undefined;
      const json = (await res.json()) as { commands: { kind: string; payload?: unknown }[] };
      for (const cmd of json.commands ?? []) {
        if (cmd.kind === 'end') {
          send('paia:classroom-message', { kind: 'end', text: 'Your teacher ended the session.' });
          studentLeave();
          return;
        }
        if (cmd.kind === 'message' && cmd.payload && typeof (cmd.payload as { text?: unknown }).text === 'string') {
          send('paia:classroom-message', { kind: 'message', text: (cmd.payload as { text: string }).text });
        }
      }
    }
  } catch (err) {
    studentLastError = err instanceof Error ? err.message : String(err);
  }

  send('paia:classroom-state', getState());
}

export function studentLeave(): void {
  if (role !== 'student') return;
  if (studentTimer) {
    clearInterval(studentTimer);
    studentTimer = null;
  }
  studentSession = null;
  studentKey = null;
  studentId = '';
  studentName = '';
  studentEventQueue.length = 0;
  role = 'off';
  send('paia:classroom-state', getState());
}

// ─── state snapshot ───────────────────────────────────────────────

export function getState(): ClassroomState {
  if (role === 'off') return { role: 'off' };
  if (role === 'teacher' && teacherSession) {
    return {
      role: 'teacher',
      session: teacherSession,
      students: Array.from(studentMap.values()),
      recentActivity: activityLog.slice(0, 50),
    };
  }
  if (role === 'student' && studentSession) {
    return {
      role: 'student',
      session: studentSession,
      studentId,
      name: studentName,
      connected: !studentLastError,
      lastError: studentLastError,
      violations: studentViolations,
      focus: studentLastFocus,
    };
  }
  return { role: 'off' };
}

// ─── IPC ──────────────────────────────────────────────────────────

ipcMain.handle('paia:classroom-state', () => getState());

ipcMain.handle('paia:classroom-start-teacher', (_e, p: { teacherName: string; policy: ClassroomPolicy; port?: number }) => {
  try {
    return { ok: true, session: startTeacher(p) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('paia:classroom-stop-teacher', () => {
  stopTeacher();
  return { ok: true };
});

ipcMain.handle('paia:classroom-end-for-all', () => {
  endSessionForAll();
  return { ok: true };
});

ipcMain.handle('paia:classroom-broadcast', (_e, p: { text: string }) => {
  broadcastMessage(p.text);
  return { ok: true };
});

ipcMain.handle('paia:classroom-join', async (_e, p: { host: string; port: number; code: string; name: string }) => {
  try {
    return { ok: true, session: await studentJoin(p) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('paia:classroom-leave', () => {
  studentLeave();
  return { ok: true };
});

ipcMain.handle('paia:classroom-default-policy', (): ClassroomPolicy => ({ ...DEFAULT_POLICY }));

void app;
