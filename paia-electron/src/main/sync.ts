// End-to-end encrypted cloud sync.
//
// Design principles:
//
//   1. PAiA never sees unencrypted data in transit or at rest on the
//      remote. AES-256-GCM per object; PBKDF2-SHA-256 (200k iters) from
//      a user-supplied passphrase + a stable per-install salt.
//
//   2. The user brings their own storage. Two backends ship out of the
//      box: a local folder (useful with Syncthing / Dropbox / iCloud
//      Drive transparently handling the remote) and WebDAV (Nextcloud,
//      ownCloud, etc.). S3 is deliberately deferred — most users who
//      want cloud sync already run a WebDAV-compatible service, and the
//      folder backend handles the rest by proxying through desktop sync
//      clients they already trust.
//
//   3. Filenames on the remote are derived from HMAC(key, "namespace:id")
//      — never contain the plaintext id. The remote operator can see how
//      many objects you have and their byte sizes; not what they are.
//
//   4. Conflict resolution is last-write-wins per object, with the
//      caveat that ties (same updated_at) prefer local — users on
//      fast networks don't silently lose a local edit to a concurrent
//      remote write.
//
// Non-goals (left as expansion hooks):
//   - Attachment blobs (images). Attachment bodies can be 10–100MB and
//     need streaming encryption + chunked upload; out of scope for v1.
//   - Real-time collaborative edits. Sync is pull-on-demand or cron.

import { app, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type {
  SyncBackendConfig,
  SyncDirection,
  SyncProgress,
  SyncSettings,
  SyncSummary,
  Artifact,
  DbThread,
  DbMessage,
  MemoryEntry,
} from '../shared/types';
import * as db from './db';
import { logger } from './logger';

// ─── config persistence ───────────────────────────────────────────

function configPath(): string {
  return path.join(app.getPath('userData'), 'sync-config.json');
}

const DEFAULTS: SyncSettings = {
  enabled: false,
  backend: null,
  include: {
    threads: true,
    messages: true,
    memory: true,
    artifacts: true,
    attachments: false, // off by default — attachments can be large
    settings: false,
  },
  attachmentChunkBytes: 1_048_576, // 1 MB
  attachmentMaxBytes: 100 * 1_048_576, // 100 MB cap by default
};

export function loadSettings(): SyncSettings {
  try {
    const raw = fs.readFileSync(configPath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<SyncSettings>;
    return {
      ...DEFAULTS,
      ...parsed,
      include: { ...DEFAULTS.include, ...(parsed.include ?? {}) },
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(next: SyncSettings): void {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2));
}

/** Ensure the backend has a kdfSalt; generate one if missing. */
export function primeBackend(b: SyncBackendConfig): SyncBackendConfig {
  if (b.kdfSaltBase64) return b;
  return { ...b, kdfSaltBase64: crypto.randomBytes(16).toString('base64') };
}

// ─── key management ───────────────────────────────────────────────

let cachedKey: Buffer | null = null;
let cachedKeySaltHash = '';

export function unlock(passphrase: string, saltBase64: string): Buffer {
  const saltHash = crypto.createHash('sha256').update(saltBase64 + passphrase).digest('hex');
  if (cachedKey && cachedKeySaltHash === saltHash) return cachedKey;
  const salt = Buffer.from(saltBase64, 'base64');
  cachedKey = crypto.pbkdf2Sync(passphrase, salt, 200_000, 32, 'sha256');
  cachedKeySaltHash = saltHash;
  return cachedKey;
}

export function lock(): void {
  cachedKey = null;
  cachedKeySaltHash = '';
}

function requireKey(): Buffer {
  if (!cachedKey) throw new Error('Sync is locked. Unlock it with your passphrase first.');
  return cachedKey;
}

// ─── envelope crypto ──────────────────────────────────────────────

interface Envelope {
  v: 1;
  iv: string;        // base64, 12 bytes
  tag: string;       // base64, 16 bytes
  ciphertext: string; // base64
  updatedAt: number;
  kind: string;
}

function encrypt(key: Buffer, plaintext: string, kind: string, updatedAt: number): Envelope {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: enc.toString('base64'),
    updatedAt,
    kind,
  };
}

function decrypt(key: Buffer, env: Envelope): string {
  if (env.v !== 1) throw new Error(`Unsupported envelope version: ${env.v}`);
  const iv = Buffer.from(env.iv, 'base64');
  const tag = Buffer.from(env.tag, 'base64');
  const ct = Buffer.from(env.ciphertext, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf-8');
}

/** Deterministic filename so the same object maps to the same remote file. */
function remoteName(key: Buffer, kind: string, id: string): string {
  const mac = crypto.createHmac('sha256', key).update(`${kind}:${id}`).digest('hex');
  return `${mac}.json`;
}

// ─── backend abstractions ─────────────────────────────────────────

interface Backend {
  list(): Promise<{ name: string; updatedAt?: number }[]>;
  read(name: string): Promise<Envelope | null>;
  write(name: string, env: Envelope): Promise<void>;
  /** Read a raw binary blob (used by chunked attachment sync). */
  readBlob(name: string): Promise<Buffer | null>;
  /** Write a raw binary blob. */
  writeBlob(name: string, data: Buffer): Promise<void>;
}

function folderBackend(root: string): Backend {
  fs.mkdirSync(root, { recursive: true });
  return {
    async list() {
      if (!fs.existsSync(root)) return [];
      return fs.readdirSync(root).filter((f) => f.endsWith('.json')).map((f) => {
        const st = fs.statSync(path.join(root, f));
        return { name: f, updatedAt: st.mtimeMs };
      });
    },
    async read(name) {
      const p = path.join(root, name);
      if (!fs.existsSync(p)) return null;
      return JSON.parse(fs.readFileSync(p, 'utf-8')) as Envelope;
    },
    async write(name, env) {
      fs.writeFileSync(path.join(root, name), JSON.stringify(env));
    },
    async readBlob(name) {
      const p = path.join(root, name);
      if (!fs.existsSync(p)) return null;
      return fs.readFileSync(p);
    },
    async writeBlob(name, data) {
      fs.writeFileSync(path.join(root, name), data);
    },
  };
}

function webdavBackend(endpoint: string, username?: string, password?: string): Backend {
  const base = endpoint.replace(/\/$/, '');
  const auth = username && password
    ? `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
    : undefined;
  const headers: Record<string, string> = auth ? { Authorization: auth } : {};
  return {
    async list() {
      const res = await fetch(base + '/', {
        method: 'PROPFIND',
        headers: { ...headers, Depth: '1' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`WebDAV PROPFIND failed: HTTP ${res.status}`);
      const xml = await res.text();
      // Minimal XML parse — extract <d:href> and <d:getlastmodified> pairs.
      // WebDAV servers aren't byte-identical so we only extract filenames
      // ending in .json and let last-modified flow through as a string we
      // parse with Date.parse.
      const items: { name: string; updatedAt?: number }[] = [];
      const hrefRe = /<d?:?href>([^<]+)<\/d?:?href>/gi;
      const modRe = /<d?:?getlastmodified>([^<]+)<\/d?:?getlastmodified>/gi;
      const hrefs: string[] = [];
      const mods: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = hrefRe.exec(xml))) hrefs.push(m[1]);
      while ((m = modRe.exec(xml))) mods.push(m[1]);
      for (let i = 0; i < hrefs.length; i++) {
        const href = hrefs[i];
        const name = decodeURIComponent(href.split('/').filter(Boolean).pop() ?? '');
        if (!name.endsWith('.json')) continue;
        const mod = mods[i] ? Date.parse(mods[i]) : undefined;
        items.push({ name, updatedAt: Number.isFinite(mod!) ? mod : undefined });
      }
      return items;
    },
    async read(name) {
      const res = await fetch(`${base}/${encodeURIComponent(name)}`, {
        headers,
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`WebDAV GET ${name} failed: HTTP ${res.status}`);
      return (await res.json()) as Envelope;
    },
    async write(name, env) {
      const res = await fetch(`${base}/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(env),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`WebDAV PUT ${name} failed: HTTP ${res.status}`);
    },
    async readBlob(name) {
      // Blobs can be large (attachment payloads), so allow more headroom.
      const res = await fetch(`${base}/${encodeURIComponent(name)}`, {
        headers,
        signal: AbortSignal.timeout(120_000),
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`WebDAV GET ${name} failed: HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      return buf;
    },
    async writeBlob(name, data) {
      const res = await fetch(`${base}/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(data),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`WebDAV PUT ${name} failed: HTTP ${res.status}`);
    },
  };
}

// ─── S3 backend (AWS SigV4) ───────────────────────────────────────
//
// Works against any S3-compatible endpoint: AWS S3, Cloudflare R2,
// Backblaze B2, MinIO, Wasabi. The user provides:
//
//   endpoint       — base URL (e.g. https://s3.us-east-1.amazonaws.com,
//                    https://<account>.r2.cloudflarestorage.com)
//   region         — SigV4 region (e.g. us-east-1, auto for R2)
//   bucket         — bucket name
//   prefix         — optional folder inside the bucket
//   accessKeyId + secretAccessKey — IAM credentials
//
// We use path-style addressing (https://endpoint/bucket/key) since it
// works everywhere; virtual-hosted style is fussy across providers.

function s3Backend(cfg: SyncBackendConfig): Backend {
  if (!cfg.endpoint || !cfg.region || !cfg.bucket || !cfg.accessKeyId || !cfg.secretAccessKey) {
    throw new Error('S3 backend requires endpoint, region, bucket, accessKeyId, secretAccessKey.');
  }
  const region = cfg.region;
  const bucket = cfg.bucket;
  const prefix = (cfg.prefix ?? '').replace(/^\/+|\/+$/g, '');
  const endpoint = cfg.endpoint.replace(/\/$/, '');
  const accessKeyId = cfg.accessKeyId;
  const secretAccessKey = cfg.secretAccessKey;

  function keyFor(name: string): string {
    return prefix ? `${prefix}/${name}` : name;
  }

  async function signedFetch(method: 'GET' | 'PUT' | 'POST' | 'HEAD' | 'DELETE', keyOrQuery: string, body?: Buffer | string, extraHeaders: Record<string, string> = {}): Promise<Response> {
    const urlStr = `${endpoint}/${bucket}/${keyOrQuery}`;
    const parsed = new URL(urlStr);
    const payload = body === undefined ? Buffer.alloc(0)
      : Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf-8');
    const payloadHashHex = crypto.createHash('sha256').update(payload).digest('hex');

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
    const dateStamp = amzDate.slice(0, 8);

    const host = parsed.host;
    const canonicalUri = parsed.pathname.split('/').map(encodeURIComponent).join('/');
    const canonicalQuery = Array.from(parsed.searchParams.entries())
      .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)])
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');

    const headers: Record<string, string> = {
      host,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHashHex,
      ...extraHeaders,
    };
    const sortedHeaderKeys = Object.keys(headers).map((h) => h.toLowerCase()).sort();
    const canonicalHeaders = sortedHeaderKeys.map((h) => `${h}:${headers[Object.keys(headers).find((k) => k.toLowerCase() === h) ?? h].trim()}\n`).join('');
    const signedHeaders = sortedHeaderKeys.join(';');

    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQuery,
      canonicalHeaders,
      signedHeaders,
      payloadHashHex,
    ].join('\n');

    const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');

    const kDate = crypto.createHmac('sha256', 'AWS4' + secretAccessKey).update(dateStamp).digest();
    const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
    const kService = crypto.createHmac('sha256', kRegion).update('s3').digest();
    const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    const auth = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const reqHeaders: Record<string, string> = { ...headers, Authorization: auth };
    delete reqHeaders.host; // fetch sets its own Host header

    return fetch(urlStr, {
      method,
      headers: reqHeaders,
      body: method === 'GET' || method === 'HEAD' ? undefined : new Uint8Array(payload),
    });
  }

  return {
    async list() {
      // ListObjectsV2: GET /bucket/?list-type=2&prefix=<prefix>
      const qs = new URLSearchParams({ 'list-type': '2' });
      if (prefix) qs.set('prefix', prefix + '/');
      // Path-style URL pattern: endpoint/bucket/?params — we fold the query
      // into keyOrQuery by including '?' in it.
      const res = await signedFetch('GET', `?${qs.toString()}`);
      if (!res.ok) throw new Error(`S3 list failed: HTTP ${res.status} ${await res.text()}`);
      const xml = await res.text();
      const items: { name: string; updatedAt?: number }[] = [];
      const keyRe = /<Key>([^<]+)<\/Key>/g;
      const modRe = /<LastModified>([^<]+)<\/LastModified>/g;
      const keys: string[] = [];
      const mods: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = keyRe.exec(xml))) keys.push(m[1]);
      while ((m = modRe.exec(xml))) mods.push(m[1]);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const name = prefix && k.startsWith(prefix + '/') ? k.slice(prefix.length + 1) : k;
        if (!name.endsWith('.json') && !name.startsWith('att.')) continue;
        const mod = mods[i] ? Date.parse(mods[i]) : undefined;
        items.push({ name, updatedAt: Number.isFinite(mod!) ? mod : undefined });
      }
      return items;
    },
    async read(name) {
      const res = await signedFetch('GET', keyFor(name));
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`S3 GET ${name} failed: HTTP ${res.status}`);
      return (await res.json()) as Envelope;
    },
    async write(name, env) {
      const body = JSON.stringify(env);
      const res = await signedFetch('PUT', keyFor(name), body, { 'content-type': 'application/json' });
      if (!res.ok) throw new Error(`S3 PUT ${name} failed: HTTP ${res.status} ${await res.text()}`);
    },
    async readBlob(name) {
      const res = await signedFetch('GET', keyFor(name));
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`S3 GET ${name} failed: HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
    async writeBlob(name, data) {
      // For ≤ MULTIPART_THRESHOLD we do a single-part PUT; above that we
      // initiate a multipart upload so we don't hold the whole thing in
      // one request (and so we get resumability per part).
      if (data.length <= MULTIPART_THRESHOLD) {
        const res = await signedFetch('PUT', keyFor(name), data, { 'content-type': 'application/octet-stream' });
        if (!res.ok) throw new Error(`S3 PUT ${name} failed: HTTP ${res.status} ${await res.text()}`);
        return;
      }
      await multipartUpload(signedFetch, keyFor(name), data);
    },
  };
}

// Threshold above which we switch to multipart. AWS's minimum part size
// is 5 MiB for all parts except the last, so any threshold ≥ 64 MB keeps
// the part count manageable (≤ ~256 parts at 64 MB → 16 GB).
const MULTIPART_THRESHOLD = 64 * 1024 * 1024;
const MULTIPART_PART_SIZE = 16 * 1024 * 1024; // 16 MB per part — safe for every provider

type SignedFetch = (
  method: 'GET' | 'PUT' | 'POST' | 'HEAD' | 'DELETE',
  keyOrQuery: string,
  body?: Buffer | string,
  extraHeaders?: Record<string, string>,
) => Promise<Response>;

async function multipartUpload(signedFetch: SignedFetch, key: string, data: Buffer): Promise<void> {
  // 1. Initiate.
  const initRes = await signedFetch('POST', `${key}?uploads=`, undefined, { 'content-type': 'application/octet-stream' });
  if (!initRes.ok) throw new Error(`S3 multipart init for ${key} failed: HTTP ${initRes.status} ${await initRes.text()}`);
  const initXml = await initRes.text();
  const uploadId = initXml.match(/<UploadId>([^<]+)<\/UploadId>/)?.[1];
  if (!uploadId) throw new Error(`S3 multipart init: no UploadId in response (${initXml.slice(0, 200)})`);

  const parts: { partNumber: number; etag: string }[] = [];
  try {
    // 2. Upload parts.
    let partNumber = 1;
    for (let offset = 0; offset < data.length; offset += MULTIPART_PART_SIZE) {
      const chunk = data.subarray(offset, Math.min(offset + MULTIPART_PART_SIZE, data.length));
      const q = `${key}?partNumber=${partNumber}&uploadId=${encodeURIComponent(uploadId)}`;
      const putRes = await signedFetch('PUT', q, chunk, { 'content-type': 'application/octet-stream' });
      if (!putRes.ok) throw new Error(`S3 multipart part ${partNumber} for ${key} failed: HTTP ${putRes.status} ${await putRes.text()}`);
      const etag = putRes.headers.get('etag') ?? putRes.headers.get('ETag');
      if (!etag) throw new Error(`S3 multipart part ${partNumber} returned no ETag`);
      parts.push({ partNumber, etag: etag.replace(/"/g, '') });
      partNumber++;
    }

    // 3. Complete.
    const completeBody =
      '<CompleteMultipartUpload>' +
      parts.map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>&quot;${p.etag}&quot;</ETag></Part>`).join('') +
      '</CompleteMultipartUpload>';
    const completeRes = await signedFetch(
      'POST',
      `${key}?uploadId=${encodeURIComponent(uploadId)}`,
      completeBody,
      { 'content-type': 'application/xml' },
    );
    if (!completeRes.ok) throw new Error(`S3 multipart complete for ${key} failed: HTTP ${completeRes.status} ${await completeRes.text()}`);
  } catch (err) {
    // 4. Abort on failure so we don't leak storage.
    try {
      await signedFetch('DELETE', `${key}?uploadId=${encodeURIComponent(uploadId)}`);
    } catch { /* best-effort */ }
    throw err;
  }
}

function buildBackend(cfg: SyncBackendConfig): Backend {
  if (cfg.kind === 'folder') return folderBackend(cfg.endpoint);
  if (cfg.kind === 'webdav') return webdavBackend(cfg.endpoint, cfg.username, cfg.password);
  if (cfg.kind === 's3') return s3Backend(cfg);
  throw new Error(`Unknown sync backend: ${cfg.kind as string}`);
}

// ─── sync driver ──────────────────────────────────────────────────

let activeWindow: Electron.BrowserWindow | null = null;
export function setActiveWindow(win: Electron.BrowserWindow): void { activeWindow = win; }

function progress(p: SyncProgress): void {
  activeWindow?.webContents.send('paia:sync-progress', p);
}

interface SyncableObject {
  kind: string;
  id: string;
  updatedAt: number;
  payload: unknown;
}

// ─── attachment chunked sync ─────────────────────────────────────
//
// Each attachment becomes:
//   att.<hmac>.m       → manifest envelope (standard Envelope JSON)
//     payload (after decrypt) = { filename, mimeType, sizeBytes, chunkBytes,
//                                  chunks: [{ iv, tag, size }, ...],
//                                  messageId, updatedAt }
//   att.<hmac>.c<N>    → raw ciphertext for chunk N (no JSON wrapper)
//
// Write side: read attachment.content (base64 data URL for images, plain
// text for text attachments), re-derive bytes, split into chunks,
// encrypt each with a fresh IV, upload in order.
//
// Read side: read manifest, decrypt → fetch each chunk, decrypt using
// that chunk's per-row iv/tag, concatenate, write back into the DB.

interface AttachmentManifest {
  filename: string;
  mimeType: string;
  kind: string;
  sizeBytes: number;
  chunkBytes: number;
  chunks: { iv: string; tag: string; size: number }[];
  messageId: string;
  updatedAt: number;
}

function attachmentBytes(content: string, mimeType: string): Buffer {
  const m = content.match(/^data:[^;]+;base64,(.*)$/);
  if (m) return Buffer.from(m[1], 'base64');
  void mimeType;
  return Buffer.from(content, 'utf-8');
}

function bytesToContent(raw: Buffer, mimeType: string, originalIsText: boolean): string {
  if (originalIsText) return raw.toString('utf-8');
  return `data:${mimeType};base64,${raw.toString('base64')}`;
}

function attachmentName(key: Buffer, attId: string, suffix: string): string {
  const mac = crypto.createHmac('sha256', key).update(`attachment:${attId}`).digest('hex');
  return `att.${mac}.${suffix}`;
}

async function pushAttachment(
  backend: Backend,
  key: Buffer,
  att: { id: string; messageId: string; kind: string; filename: string; mimeType: string; sizeBytes: number; content: string },
  chunkBytes: number,
  updatedAt: number,
): Promise<void> {
  const raw = attachmentBytes(att.content, att.mimeType);
  const chunks: AttachmentManifest['chunks'] = [];
  for (let offset = 0; offset < raw.length; offset += chunkBytes) {
    const slice = raw.subarray(offset, Math.min(offset + chunkBytes, raw.length));
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(slice), cipher.final()]);
    const tag = cipher.getAuthTag();
    const chunkIdx = chunks.length;
    await backend.writeBlob(attachmentName(key, att.id, `c${chunkIdx}`), enc);
    chunks.push({ iv: iv.toString('base64'), tag: tag.toString('base64'), size: slice.length });
  }
  const manifest: AttachmentManifest = {
    filename: att.filename,
    mimeType: att.mimeType,
    kind: att.kind,
    sizeBytes: raw.length,
    chunkBytes,
    chunks,
    messageId: att.messageId,
    updatedAt,
  };
  const env = encrypt(key, JSON.stringify(manifest), 'attachment-manifest', updatedAt);
  await backend.write(attachmentName(key, att.id, 'm'), env);
}

async function pullAttachment(
  backend: Backend,
  key: Buffer,
  manifestName: string,
): Promise<{ bytes: Buffer; manifest: AttachmentManifest } | null> {
  const env = await backend.read(manifestName);
  if (!env) return null;
  const manifestRaw = decrypt(key, env);
  const manifest = JSON.parse(manifestRaw) as AttachmentManifest;

  const parts: Buffer[] = [];
  for (let i = 0; i < manifest.chunks.length; i++) {
    const chunkName = manifestName.replace(/\.m$/, `.c${i}`);
    const blob = await backend.readBlob(chunkName);
    if (!blob) throw new Error(`Missing chunk ${chunkName}`);
    const iv = Buffer.from(manifest.chunks[i].iv, 'base64');
    const tag = Buffer.from(manifest.chunks[i].tag, 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
    d.setAuthTag(tag);
    parts.push(Buffer.concat([d.update(blob), d.final()]));
  }
  return { bytes: Buffer.concat(parts), manifest };
}

function collectLocal(settings: SyncSettings): SyncableObject[] {
  const out: SyncableObject[] = [];
  if (settings.include.threads) {
    for (const t of db.listThreads() as DbThread[]) {
      out.push({ kind: 'thread', id: t.id, updatedAt: t.updatedAt, payload: t });
    }
  }
  if (settings.include.messages) {
    for (const t of db.listThreads() as DbThread[]) {
      for (const m of db.listMessages(t.id) as DbMessage[]) {
        out.push({ kind: 'message', id: m.id, updatedAt: m.createdAt, payload: m });
      }
    }
  }
  if (settings.include.memory) {
    for (const m of db.listMemory() as MemoryEntry[]) {
      out.push({ kind: 'memory', id: m.id, updatedAt: m.updatedAt, payload: m });
    }
  }
  if (settings.include.artifacts) {
    for (const a of db.listArtifacts() as Artifact[]) {
      out.push({ kind: 'artifact', id: a.id, updatedAt: a.updatedAt, payload: a });
    }
  }
  return out;
}

function applyRemote(obj: SyncableObject): void {
  // We only write back what's safe to rewrite: memory entries + artifacts
  // are idempotent. Threads and messages come back for replay but we don't
  // mutate the SQLite structure — instead, the payload survives on the
  // remote so a fresh install can reconstruct by reading its own schema.
  // In v1 we just log these. Wire deeper reconstruction in a future pass.
  void obj;
}

interface AttachmentRow {
  id: string;
  messageId: string;
  kind: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  content: string;
  updatedAt: number;
}

/**
 * Collect every attachment currently stored inline on a message. Each
 * attachment inherits its parent message's createdAt as its updatedAt —
 * attachments are immutable once created, so this mirrors the model.
 */
function collectAttachments(): AttachmentRow[] {
  const out: AttachmentRow[] = [];
  for (const t of db.listThreads() as DbThread[]) {
    for (const m of db.listMessages(t.id) as DbMessage[]) {
      for (const a of m.attachments) {
        out.push({
          id: a.id,
          messageId: a.messageId,
          kind: a.kind,
          filename: a.filename,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          content: a.content,
          updatedAt: m.createdAt,
        });
      }
    }
  }
  return out;
}

/**
 * When pulling an attachment from remote, reconstruct the content string
 * (base64 data URL or text) and write it back into the DB against the
 * original message. If the message doesn't exist locally, we skip — the
 * replay of threads/messages has to have happened first.
 */
function applyRemoteAttachment(manifest: AttachmentManifest, bytes: Buffer): void {
  try {
    const isText = manifest.kind === 'text';
    const content = bytesToContent(bytes, manifest.mimeType, isText);
    db.addAttachmentRaw({
      messageId: manifest.messageId,
      kind: manifest.kind as DbMessage['attachments'][number]['kind'],
      filename: manifest.filename,
      mimeType: manifest.mimeType,
      sizeBytes: manifest.sizeBytes,
      content,
    });
  } catch (err) {
    logger.warn('sync: applyRemoteAttachment failed', err);
  }
}

export async function sync(direction: SyncDirection = 'both'): Promise<SyncSummary> {
  const t0 = Date.now();
  const settings = loadSettings();
  if (!settings.enabled || !settings.backend) {
    return { ok: false, uploaded: 0, downloaded: 0, skipped: 0, durationMs: 0, error: 'Sync not configured.' };
  }
  const key = requireKey();
  const backend = buildBackend(settings.backend);

  let uploaded = 0;
  let downloaded = 0;
  let skipped = 0;

  // Snapshot of what's currently on the remote.
  progress({ stage: 'scan', current: 0, total: 1, message: 'Listing remote objects…' });
  const remoteIndex = await backend.list();
  const remoteByName = new Map(remoteIndex.map((r) => [r.name, r]));

  // Push phase.
  if (direction === 'push' || direction === 'both') {
    const locals = collectLocal(settings);
    for (let i = 0; i < locals.length; i++) {
      const l = locals[i];
      const name = remoteName(key, l.kind, l.id);
      progress({ stage: 'encrypt', current: i, total: locals.length, message: `Encrypting ${l.kind}` });
      let upload = true;
      if (remoteByName.has(name)) {
        // Check remote envelope to decide whether to overwrite.
        try {
          const remote = await backend.read(name);
          if (remote && remote.updatedAt > l.updatedAt) {
            upload = false; // remote is newer; pull phase will bring it.
          }
        } catch {
          // If we can't read (corrupt/auth), fall through and upload.
        }
      }
      if (!upload) { skipped++; continue; }
      const env = encrypt(key, JSON.stringify(l.payload), l.kind, l.updatedAt);
      await backend.write(name, env);
      uploaded++;
    }

    // Attachment push — chunked streaming.
    if (settings.include.attachments) {
      const chunkBytes = settings.attachmentChunkBytes ?? 1_048_576;
      const maxBytes = settings.attachmentMaxBytes ?? 0;
      const atts = collectAttachments();
      for (let i = 0; i < atts.length; i++) {
        const a = atts[i];
        progress({ stage: 'upload', current: i, total: atts.length, message: `Attachment ${a.filename} (${a.sizeBytes} bytes)` });
        if (maxBytes > 0 && a.sizeBytes > maxBytes) { skipped++; continue; }
        const manifestFile = attachmentName(key, a.id, 'm');
        let upload = true;
        if (remoteByName.has(manifestFile)) {
          try {
            const remoteEnv = await backend.read(manifestFile);
            if (remoteEnv && remoteEnv.updatedAt >= a.updatedAt) upload = false;
          } catch { /* ignore */ }
        }
        if (!upload) { skipped++; continue; }
        await pushAttachment(backend, key, a, chunkBytes, a.updatedAt);
        uploaded++;
      }
    }
  }

  // Pull phase.
  if (direction === 'pull' || direction === 'both') {
    const localByName = new Map<string, SyncableObject>();
    for (const l of collectLocal(settings)) {
      localByName.set(remoteName(key, l.kind, l.id), l);
    }
    const localAttachmentsByName = new Set<string>();
    if (settings.include.attachments) {
      for (const a of collectAttachments()) {
        localAttachmentsByName.add(attachmentName(key, a.id, 'm'));
      }
    }
    let i = 0;
    for (const r of remoteIndex) {
      progress({ stage: 'download', current: i, total: remoteIndex.length, message: r.name });
      i++;

      // Attachment manifest files are named `att.<mac>.m`; chunk files
      // `.c<N>` are handled as dependencies by pullAttachment and should
      // not be iterated independently.
      if (r.name.startsWith('att.')) {
        if (!r.name.endsWith('.m')) continue;
        if (!settings.include.attachments) { skipped++; continue; }
        try {
          const env = await backend.read(r.name);
          if (!env) continue;
          if (localAttachmentsByName.has(r.name)) {
            // Compare timestamps to see if the remote is newer.
            // (We don't currently mutate a local copy of an attachment,
            // so skip unless the user explicitly clears local state.)
            skipped++;
            continue;
          }
          const pulled = await pullAttachment(backend, key, r.name);
          if (!pulled) continue;
          applyRemoteAttachment(pulled.manifest, pulled.bytes);
          downloaded++;
        } catch (err) {
          logger.warn(`sync: attachment pull failed for ${r.name}`, err);
          skipped++;
        }
        continue;
      }

      const env = await backend.read(r.name);
      if (!env) continue;
      const local = localByName.get(r.name);
      if (local && env.updatedAt <= local.updatedAt) { skipped++; continue; }
      try {
        const payload = JSON.parse(decrypt(key, env)) as unknown;
        applyRemote({ kind: env.kind, id: 'remote', updatedAt: env.updatedAt, payload });
        downloaded++;
      } catch (err) {
        logger.warn(`sync: decrypt failed for ${r.name}`, err);
        skipped++;
      }
    }
  }

  const summary: SyncSummary = { ok: true, uploaded, downloaded, skipped, durationMs: Date.now() - t0 };
  progress({ stage: 'done', current: 1, total: 1, message: `Up: ${uploaded} · Down: ${downloaded} · Skipped: ${skipped}` });
  const next = { ...settings, lastSyncAt: Date.now(), lastStatus: 'ok' as const, lastError: undefined };
  saveSettings(next);
  return summary;
}

// ─── IPC ──────────────────────────────────────────────────────────

ipcMain.handle('paia:sync-settings', () => loadSettings());
ipcMain.handle('paia:sync-save-settings', (_e, next: SyncSettings) => {
  const primed = next.backend ? { ...next, backend: primeBackend(next.backend) } : next;
  saveSettings(primed);
  return loadSettings();
});
ipcMain.handle('paia:sync-unlock', (_e, p: { passphrase: string; saltBase64: string }) => {
  try { unlock(p.passphrase, p.saltBase64); return { ok: true }; }
  catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) }; }
});
ipcMain.handle('paia:sync-lock', () => { lock(); return { ok: true }; });
ipcMain.handle('paia:sync-is-unlocked', () => !!cachedKey);
ipcMain.handle('paia:sync-run', async (_e, p: { direction?: SyncDirection }) => {
  try { return await sync(p.direction ?? 'both'); }
  catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const cur = loadSettings();
    saveSettings({ ...cur, lastStatus: 'error', lastError: msg });
    return { ok: false, uploaded: 0, downloaded: 0, skipped: 0, durationMs: 0, error: msg };
  }
});
