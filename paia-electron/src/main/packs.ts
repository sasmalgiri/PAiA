// Knowledge stack packs — main-process runtime.
//
// Lifecycle:
//   loadFromFile(path)  → SignedPack | error            (gunzip + parse + shape + signature)
//   install(pack, opts) → InstalledPack                  (write personas, ingest collections, record install)
//   list()              → InstalledPack[]                (reads userData/installed-packs.json)
//   uninstall(packId)   → void                          (deletes personas + collections, restores defaults)
//
// Trust:
//   Signatures are verified against PAIA_PUBLIC_KEY — same root of trust
//   as license signing. One key compromise affects both; that's the
//   intentional simplicity tradeoff (see project-paia-v3-plan memory).
//
// Atomicity:
//   Best-effort. Install creates collections, ingests docs, and registers
//   personas in order. On failure mid-install, the partial state is left
//   in place and the user can uninstall to clean up. We don't transaction
//   across modules because the modules don't share a transaction context.
//
// Pack persona namespacing:
//   Personas installed by a pack get `packId` set in their JSON. The
//   personas module already returns the union of built-in + custom; we
//   extend it to also walk pack-installed persona files at userData/
//   pack-personas/<packId>/. Removing those files (uninstall) removes
//   the personas cleanly.

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { promisify } from 'util';
import { app } from 'electron';
import {
  PACK_FORMAT_VERSION,
  buildSignablePayload,
  compareVersions,
  validatePackShape,
  type PackTier,
  type SignedPack,
} from '../shared/packFormat';
import { publicKeyFromB64 } from '../shared/licenseVerify';
import * as db from './db';
import * as rag from './rag';
import { logger } from './logger';

const gunzip = promisify(zlib.gunzip);

const PAIA_PUBLIC_KEY_B64 = process.env.PAIA_PUBLIC_KEY ?? '';

export interface InstalledPack {
  id: string;
  name: string;
  version: string;
  installedAt: number;
  /** Persona IDs the pack added — used to clean up on uninstall. */
  personaIds: string[];
  /** Collection IDs the pack created — used to clean up on uninstall. */
  collectionIds: string[];
  /** Settings keys the pack changed (with the prior values) so uninstall
   *  can restore them. Keys default-empty if user declined to apply
   *  defaults at install time. */
  defaultsBackup: Record<string, unknown>;
}

interface RegistryFile { packs: InstalledPack[] }

export interface InstallProgress {
  packId: string;
  stage: 'verify' | 'personas' | 'collection' | 'ingest' | 'defaults' | 'done' | 'error';
  current?: number;
  total?: number;
  message?: string;
}

// ─── path helpers ───────────────────────────────────────────────────

function packPersonaDir(packId: string): string {
  return path.join(app.getPath('userData'), 'pack-personas', packId);
}

function registryFile(): string {
  return path.join(app.getPath('userData'), 'installed-packs.json');
}

function loadRegistry(): RegistryFile {
  try {
    const raw = fs.readFileSync(registryFile(), 'utf-8');
    const parsed = JSON.parse(raw) as RegistryFile;
    if (!Array.isArray(parsed.packs)) return { packs: [] };
    return parsed;
  } catch {
    return { packs: [] };
  }
}

function saveRegistry(reg: RegistryFile): void {
  fs.mkdirSync(path.dirname(registryFile()), { recursive: true });
  fs.writeFileSync(registryFile(), JSON.stringify(reg, null, 2));
}

// ─── verify ────────────────────────────────────────────────────────

export function verifyPackSignature(pack: SignedPack): boolean {
  if (!PAIA_PUBLIC_KEY_B64) {
    logger.warn('packs: PAIA_PUBLIC_KEY not set — cannot verify signatures');
    return false;
  }
  const pub = publicKeyFromB64(PAIA_PUBLIC_KEY_B64);
  if (!pub) return false;
  try {
    const sig = Buffer.from(pack.signature, 'base64');
    if (sig.length !== 64) return false;
    const payload = buildSignablePayload({
      version: pack.version,
      manifest: pack.manifest,
      files: pack.files,
    });
    return crypto.verify(null, payload, pub, sig);
  } catch (err) {
    logger.warn('packs: signature verification threw', err);
    return false;
  }
}

// ─── load from file ─────────────────────────────────────────────────

export async function loadFromFile(filePath: string): Promise<SignedPack> {
  const buf = fs.readFileSync(filePath);
  const json = (await gunzip(buf)).toString('utf-8');
  const raw = JSON.parse(json) as unknown;
  const shape = validatePackShape(raw);
  if (!shape.ok) {
    throw new Error(`Invalid pack: ${shape.reason}`);
  }
  if (!verifyPackSignature(shape.pack)) {
    throw new Error('Pack signature did not verify against PAIA_PUBLIC_KEY');
  }
  return shape.pack;
}

// ─── list ──────────────────────────────────────────────────────────

export function listInstalled(): InstalledPack[] {
  return loadRegistry().packs;
}

export function isInstalled(packId: string): boolean {
  return loadRegistry().packs.some((p) => p.id === packId);
}

// ─── install ───────────────────────────────────────────────────────

export interface InstallOptions {
  applyDefaults: boolean;
  /** Optional tier check. If provided and the pack requires a higher
   *  tier, install is refused. */
  currentTier?: PackTier;
  /** Current app version for paiaMinVersion gating. */
  paiaVersion?: string;
  onProgress?: (p: InstallProgress) => void;
}

export async function install(pack: SignedPack, opts: InstallOptions): Promise<InstalledPack> {
  const m = pack.manifest;
  const { onProgress } = opts;

  // Gate by required tier — caller can pre-check and surface a nicer
  // upgrade prompt, but this is the defensive enforcement.
  if (m.requiresTier && opts.currentTier) {
    // Tier-ordering for pack-install gating: legal and therapy are
    // both vertical packs priced at the Pro tier level + curated
    // content; treat them as peer to team for install permission.
    const order: Record<PackTier, number> = { free: 0, pro: 1, team: 2, legal: 2, therapy: 2, finance: 2 };
    if (order[opts.currentTier] < order[m.requiresTier]) {
      throw new Error(`This pack requires the ${m.requiresTier} tier; you're on ${opts.currentTier}.`);
    }
  }

  // Gate by paiaMinVersion.
  if (m.paiaMinVersion && opts.paiaVersion) {
    if (compareVersions(opts.paiaVersion, m.paiaMinVersion) < 0) {
      throw new Error(`This pack requires PAiA ${m.paiaMinVersion} or newer (you're on ${opts.paiaVersion}).`);
    }
  }

  if (isInstalled(m.id)) {
    throw new Error(`Pack "${m.id}" is already installed. Uninstall it first to update.`);
  }

  onProgress?.({ packId: m.id, stage: 'verify', message: 'Signature verified' });

  // 1. Personas — write each as a file under pack-personas/<packId>/<personaId>.json
  // Personas module is extended to walk these directories.
  const personaDir = packPersonaDir(m.id);
  fs.mkdirSync(personaDir, { recursive: true });
  const personaIds: string[] = [];
  const personas = pack.files.personas ?? [];
  for (let i = 0; i < personas.length; i++) {
    onProgress?.({
      packId: m.id, stage: 'personas',
      current: i + 1, total: personas.length,
      message: `Installing persona ${i + 1}/${personas.length}`,
    });
    let parsed: { id?: unknown; name?: unknown };
    try {
      parsed = JSON.parse(personas[i].content) as { id?: unknown; name?: unknown };
    } catch {
      throw new Error(`Persona ${personas[i].filename} is not valid JSON.`);
    }
    if (typeof parsed.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(parsed.id)) {
      throw new Error(`Persona ${personas[i].filename} has missing or invalid id.`);
    }
    // Stamp the packId for clean uninstall and listing UX.
    const stamped = { ...parsed, packId: m.id, isBuiltin: false };
    fs.writeFileSync(
      path.join(personaDir, `${parsed.id}.json`),
      JSON.stringify(stamped, null, 2),
    );
    personaIds.push(parsed.id);
  }

  // 2. Collections — create + ingest docs.
  const collectionIds: string[] = [];
  const collections = pack.files.collections ?? [];
  for (let ci = 0; ci < collections.length; ci++) {
    const c = collections[ci];
    onProgress?.({
      packId: m.id, stage: 'collection',
      current: ci + 1, total: collections.length,
      message: `Creating collection ${c.meta.name}`,
    });
    const created = db.createCollection(c.meta.name, c.meta.description, c.meta.embedModel);
    collectionIds.push(created.id);

    // Ingest documents — write to a temp file (rag.ingestFile takes a
    // path) then ingest.
    for (let di = 0; di < c.documents.length; di++) {
      const doc = c.documents[di];
      const tmp = path.join(os.tmpdir(), `paia-pack-${m.id}-${Date.now()}-${di}-${doc.filename}`);
      try {
        fs.writeFileSync(tmp, Buffer.from(doc.bytesBase64, 'base64'));
        onProgress?.({
          packId: m.id, stage: 'ingest',
          current: di + 1, total: c.documents.length,
          message: `Ingesting ${doc.filename} (${di + 1}/${c.documents.length})`,
        });
        await rag.ingestFile({
          collectionId: created.id,
          filePath: tmp,
          filename: doc.filename,
          mimeType: doc.mimeType,
          embeddingModel: c.meta.embedModel,
        });
      } finally {
        try { fs.unlinkSync(tmp); } catch { /* swallow */ }
      }
    }
  }

  // 3. Defaults — caller controls whether these apply.
  const defaultsBackup: Record<string, unknown> = {};
  if (opts.applyDefaults && pack.files.defaults) {
    onProgress?.({ packId: m.id, stage: 'defaults', message: 'Applying pack defaults' });
    // The settings module reads the current value and writes the new one;
    // we record both so uninstall can restore. Import lazily so this
    // module stays importable in non-Electron contexts (tests).
    const settingsStore = await import('./settings');
    const current = settingsStore.load() as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(pack.files.defaults)) {
      defaultsBackup[k] = current[k];
      (current as Record<string, unknown>)[k] = v;
    }
    settingsStore.save(current as Parameters<typeof settingsStore.save>[0]);
  }

  // 4. Register the install.
  const installed: InstalledPack = {
    id: m.id,
    name: m.name,
    version: m.version,
    installedAt: Date.now(),
    personaIds,
    collectionIds,
    defaultsBackup,
  };
  const reg = loadRegistry();
  reg.packs.push(installed);
  saveRegistry(reg);

  onProgress?.({ packId: m.id, stage: 'done', message: `${m.name} installed` });
  logger.info(`packs: installed ${m.id}@${m.version} (${personaIds.length} personas, ${collectionIds.length} collections)`);
  return installed;
}

// ─── uninstall ──────────────────────────────────────────────────────

export async function uninstall(packId: string): Promise<void> {
  const reg = loadRegistry();
  const idx = reg.packs.findIndex((p) => p.id === packId);
  if (idx < 0) throw new Error(`Pack "${packId}" is not installed.`);
  const installed = reg.packs[idx];

  // Personas — delete the pack-personas directory.
  try {
    fs.rmSync(packPersonaDir(packId), { recursive: true, force: true });
  } catch (err) {
    logger.warn(`packs: failed to remove persona dir for ${packId}`, err);
  }

  // Collections — delete via db (cascades to documents + chunks).
  for (const cid of installed.collectionIds) {
    try {
      db.deleteCollection(cid);
    } catch (err) {
      logger.warn(`packs: failed to delete collection ${cid}`, err);
    }
  }

  // Defaults — restore the backed-up values.
  if (Object.keys(installed.defaultsBackup).length > 0) {
    const settingsStore = await import('./settings');
    const current = settingsStore.load() as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(installed.defaultsBackup)) {
      (current as Record<string, unknown>)[k] = v;
    }
    settingsStore.save(current as Parameters<typeof settingsStore.save>[0]);
  }

  // Drop from registry.
  reg.packs.splice(idx, 1);
  saveRegistry(reg);

  logger.info(`packs: uninstalled ${packId}`);
}

// ─── pack persona loader (used by personas.ts) ─────────────────────

/**
 * Returns every persona installed via packs. Exported so the personas
 * module can union it with built-ins and user-defined.
 */
export function loadPackPersonas(): Array<{ id: string; name: string; emoji: string; systemPrompt: string; isBuiltin: false; ragCollectionIds?: string[]; packId?: string }> {
  const root = path.join(app.getPath('userData'), 'pack-personas');
  const out: Array<{ id: string; name: string; emoji: string; systemPrompt: string; isBuiltin: false; ragCollectionIds?: string[]; packId?: string }> = [];
  let packDirs: string[] = [];
  try {
    packDirs = fs.readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return out;
  }
  for (const packId of packDirs) {
    const dir = path.join(root, packId);
    let files: string[] = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { continue; }
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(dir, f), 'utf-8');
        const parsed = JSON.parse(raw) as {
          id?: string; name?: string; emoji?: string; systemPrompt?: string;
          ragCollectionIds?: string[]; packId?: string;
        };
        if (typeof parsed.id !== 'string' || typeof parsed.name !== 'string' ||
            typeof parsed.emoji !== 'string' || typeof parsed.systemPrompt !== 'string') {
          continue;
        }
        out.push({
          id: parsed.id,
          name: parsed.name,
          emoji: parsed.emoji,
          systemPrompt: parsed.systemPrompt,
          isBuiltin: false,
          ragCollectionIds: Array.isArray(parsed.ragCollectionIds) ? parsed.ragCollectionIds : undefined,
          packId: parsed.packId ?? packId,
        });
      } catch {
        /* skip malformed file */
      }
    }
  }
  return out;
}

export const PACK_FORMAT = PACK_FORMAT_VERSION;
