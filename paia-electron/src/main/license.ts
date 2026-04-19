// License key verification, trial tracking, and feature gating.
//
// Cryptographic model:
//   - We embed an Ed25519 public key in the app binary (PAIA_PUBLIC_KEY).
//   - License keys are JSON payloads signed with the corresponding
//     private key (kept off the user's machine — typically on the seller's
//     server or a one-off issuance script: see scripts/issue-license.mjs).
//   - The renderer can verify a license entirely offline. The first
//     successful verification stores the license at userData/license.json.
//
// Trial model:
//   - On first run, we record the start timestamp in userData/trial.json.
//   - The trial unlocks every feature for TRIAL_DAYS days.
//   - When the trial expires, the user falls back to the free tier
//     (unless they have a valid Pro license).
//
// Feature gating:
//   - The dispatcher in main only enforces gating for features that
//     could leak to the network or run untrusted code (cloud providers,
//     MCP). The renderer hides Pro UI for cosmetic gating.
//   - Replace PAIA_PUBLIC_KEY below with your real public key when you
//     start issuing licenses.

import { app, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { publicKeyFromB64, verifyLicense } from '../shared/licenseVerify';
import * as crypto from 'crypto';
import type {
  FeatureFlag,
  LicenseStatus,
  LicenseTier,
  SignedLicense,
  SignedTrialExtension,
} from '../shared/types';
import { logger } from './logger';

// ─── public key ────────────────────────────────────────────────────
//
// Replace this with your real Ed25519 public key (raw 32-byte key,
// base64-encoded). The matching private key NEVER ships with the app.
// Generate a fresh keypair with:
//
//   node scripts/issue-license.mjs --gen-keys
//
// Until you replace this, all signed licenses will fail verification —
// only the trial path will unlock features.
const PAIA_PUBLIC_KEY_B64 = process.env.PAIA_PUBLIC_KEY ?? '';

const TRIAL_DAYS = 14;
const FREE_TIER: LicenseTier = 'free';

// ─── persisted state ───────────────────────────────────────────────

function licenseFile(): string {
  return path.join(app.getPath('userData'), 'license.json');
}
function trialFile(): string {
  return path.join(app.getPath('userData'), 'trial.json');
}

interface TrialState {
  startedAt: number;
  /** Days added via redeemed trial-extension codes. */
  bonusDays?: number;
  /** Nonces of extensions already redeemed so the same code can't re-apply. */
  redeemedNonces?: string[];
}

function loadTrial(): TrialState {
  try {
    return JSON.parse(fs.readFileSync(trialFile(), 'utf-8')) as TrialState;
  } catch {
    const fresh = { startedAt: Date.now() };
    fs.mkdirSync(path.dirname(trialFile()), { recursive: true });
    fs.writeFileSync(trialFile(), JSON.stringify(fresh));
    return fresh;
  }
}

function loadLicense(): SignedLicense | null {
  try {
    return JSON.parse(fs.readFileSync(licenseFile(), 'utf-8')) as SignedLicense;
  } catch {
    return null;
  }
}

function saveLicense(license: SignedLicense): void {
  fs.mkdirSync(path.dirname(licenseFile()), { recursive: true });
  fs.writeFileSync(licenseFile(), JSON.stringify(license, null, 2));
}

// ─── verification ──────────────────────────────────────────────────

function verifySignature(license: SignedLicense): boolean {
  if (!PAIA_PUBLIC_KEY_B64) {
    logger.warn('PAIA_PUBLIC_KEY not set — cannot verify licenses');
    return false;
  }
  const pub = publicKeyFromB64(PAIA_PUBLIC_KEY_B64);
  if (!pub) {
    logger.warn('PAIA_PUBLIC_KEY could not be parsed');
    return false;
  }
  return verifyLicense(license, pub);
}

// Short-lived cache to avoid re-reading license.json + trial.json on
// every feature-gate check. Agent loops + metering can call status()
// hundreds of times per second; blocking disk reads here produce
// visible UI jank. 1s TTL is invisible to users but kills the cost.
let statusCache: { at: number; value: LicenseStatus } | null = null;
const STATUS_TTL_MS = 1000;

export function invalidateStatusCache(): void {
  statusCache = null;
}

export function status(): LicenseStatus {
  const now = Date.now();
  if (statusCache && now - statusCache.at < STATUS_TTL_MS) {
    return statusCache.value;
  }
  const trial = loadTrial();
  const bonus = Math.max(0, trial.bonusDays ?? 0);
  const trialEndsAt = trial.startedAt + (TRIAL_DAYS + bonus) * 24 * 60 * 60 * 1000;
  const trialDaysLeft = Math.max(0, Math.ceil((trialEndsAt - Date.now()) / (24 * 60 * 60 * 1000)));
  const inTrial = Date.now() < trialEndsAt;

  const license = loadLicense();
  let value: LicenseStatus;
  if (license && verifySignature(license)) {
    const expired = license.payload.expiresAt !== null && Date.now() > license.payload.expiresAt;
    if (!expired) {
      value = {
        effectiveTier: license.payload.tier,
        source: 'license',
        license: license.payload,
        trialStartedAt: trial.startedAt,
        trialEndsAt,
        trialDaysLeft,
      };
      statusCache = { at: now, value };
      return value;
    }
  }

  if (inTrial) {
    value = {
      effectiveTier: 'pro',
      source: 'trial',
      trialStartedAt: trial.startedAt,
      trialEndsAt,
      trialDaysLeft,
    };
    statusCache = { at: now, value };
    return value;
  }

  value = {
    effectiveTier: FREE_TIER,
    source: 'free',
    trialStartedAt: trial.startedAt,
    trialEndsAt,
    trialDaysLeft,
  };
  statusCache = { at: now, value };
  return value;
}

export function activate(license: SignedLicense): { ok: boolean; reason?: string } {
  if (!verifySignature(license)) {
    return { ok: false, reason: 'Signature is invalid. Check that you copied the entire key.' };
  }
  if (license.payload.expiresAt !== null && Date.now() > license.payload.expiresAt) {
    return { ok: false, reason: 'License has expired.' };
  }
  saveLicense(license);
  invalidateStatusCache();
  logger.info('license activated for', license.payload.email, license.payload.tier);
  return { ok: true };
}

export function deactivate(): void {
  try {
    fs.unlinkSync(licenseFile());
  } catch {
    /* ignore */
  }
  invalidateStatusCache();
}

/**
 * Redeem a signed trial-extension (typically a referral reward).
 * Verifies the signature against PAIA_PUBLIC_KEY, checks the nonce
 * hasn't been redeemed before, then adds the grant to bonusDays.
 */
export function redeemExtension(ext: SignedTrialExtension): { ok: boolean; reason?: string; addedDays?: number } {
  if (!PAIA_PUBLIC_KEY_B64) return { ok: false, reason: 'This build has no public key, so extensions cannot be verified.' };
  const pub = publicKeyFromB64(PAIA_PUBLIC_KEY_B64);
  if (!pub) return { ok: false, reason: 'PAIA_PUBLIC_KEY could not be parsed.' };
  if (ext.payload.kind !== 'trial-extension') return { ok: false, reason: 'Not a trial-extension payload.' };
  if (!Number.isFinite(ext.payload.extendDays) || ext.payload.extendDays <= 0 || ext.payload.extendDays > 365) {
    return { ok: false, reason: 'Invalid extendDays.' };
  }
  if (typeof ext.signatureBase64 !== 'string') return { ok: false, reason: 'Signature missing.' };
  const sig = Buffer.from(ext.signatureBase64, 'base64');
  // Ed25519 signatures are always 64 bytes. Reject mangled input early.
  if (sig.length !== 64) return { ok: false, reason: 'Signature length invalid.' };
  const msg = Buffer.from(JSON.stringify(ext.payload));
  let valid = false;
  try { valid = crypto.verify(null, msg, pub, sig); } catch { valid = false; }
  if (!valid) return { ok: false, reason: 'Signature is invalid.' };

  const trial = loadTrial();
  const redeemed = trial.redeemedNonces ?? [];
  if (redeemed.includes(ext.payload.nonce)) {
    return { ok: false, reason: 'This extension has already been redeemed on this device.' };
  }
  const next: TrialState = {
    startedAt: trial.startedAt,
    bonusDays: (trial.bonusDays ?? 0) + ext.payload.extendDays,
    redeemedNonces: [...redeemed, ext.payload.nonce],
  };
  fs.writeFileSync(trialFile(), JSON.stringify(next));
  invalidateStatusCache();
  logger.info(`trial extended by ${ext.payload.extendDays} days (reason: ${ext.payload.reason})`);
  return { ok: true, addedDays: ext.payload.extendDays };
}

// ─── feature flags ─────────────────────────────────────────────────

// Feature matrix — keep synchronised with pricing page + COMMERCIALIZATION.md.
//
// Free is a real, usable tier: the app works as a local chat assistant
// without paying. Gating is concentrated on the differentiators that
// cost us money (cloud calls burn user keys but still represent our
// "premium" positioning) or open scary surfaces (agent / MCP / plugins
// / enforcement). Classroom + OS-level enforcement are Team-only because
// they're purchased by institutions with per-seat budgets.

const FREE_FEATURES: FeatureFlag[] = [
  'multi-thread',     // with a thread cap enforced elsewhere
  'voice-whisper',    // basic offline STT
  'screen-region',    // capture + OCR
  'quick-actions',    // Ctrl+Alt+Q popup
  'active-window',    // foreground window context
  'memory',           // long-term memory with a cap
];

const PRO_FEATURES: FeatureFlag[] = [
  ...FREE_FEATURES,
  'rag',
  'mcp',
  'cloud-providers',
  'personas-custom',
  'web-search',
  'agent',
  'deep-research',
  'canvas',
  'connectors',
  'scheduler',
  'ambient',
  'team',          // multi-agent team runs
  'plugins',
  'beta',
];

const TEAM_FEATURES: FeatureFlag[] = [
  ...PRO_FEATURES,
  'classroom',
  'enforcement',
];

export function isFeatureEnabled(feature: FeatureFlag): boolean {
  const tier = status().effectiveTier;
  if (tier === 'team') return TEAM_FEATURES.includes(feature);
  if (tier === 'pro') return PRO_FEATURES.includes(feature);
  return FREE_FEATURES.includes(feature);
}

// Throws when called against a gated feature in the current tier.
// Call sites use this at entry points; the renderer catches the error
// and surfaces an upgrade prompt.
export function requireFeature(feature: FeatureFlag): void {
  if (isFeatureEnabled(feature)) return;
  const tier = status().effectiveTier;
  const targetTier: LicenseTier = TEAM_FEATURES.includes(feature) && !PRO_FEATURES.includes(feature) ? 'team' : 'pro';
  throw new Error(
    `Feature "${feature}" requires PAiA ${targetTier === 'team' ? 'Team' : 'Pro'}. ` +
    `You're on ${tier}. Start a trial or activate a license in Settings → License.`,
  );
}

// ─── IPC ───────────────────────────────────────────────────────────

ipcMain.handle('paia:license-status', () => status());

ipcMain.handle('paia:license-activate', (_e, license: SignedLicense) => {
  return activate(license);
});

ipcMain.handle('paia:license-activate-text', (_e, raw: string) => {
  try {
    const parsed = JSON.parse(raw) as SignedLicense;
    return activate(parsed);
  } catch (err) {
    return { ok: false, reason: 'Could not parse license. Make sure you copied the entire JSON block.' };
  }
});

ipcMain.handle('paia:license-deactivate', () => {
  deactivate();
  return status();
});

ipcMain.handle('paia:feature-enabled', (_e, feature: FeatureFlag) => isFeatureEnabled(feature));

ipcMain.handle('paia:license-redeem-extension', (_e, raw: string) => {
  let parsed: SignedTrialExtension;
  try { parsed = JSON.parse(raw) as SignedTrialExtension; }
  catch {
    try { parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf-8')) as SignedTrialExtension; }
    catch { return { ok: false, reason: 'Could not parse the code.' }; }
  }
  return redeemExtension(parsed);
});
