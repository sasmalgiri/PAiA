// Commerce: external checkout + customer portal handoff (v3-B2).
//
// PAiA doesn't host its own checkout — we hand off to the configured
// merchant of record (Paddle or LemonSqueezy) and let them handle PCI,
// tax, and dunning. This module:
//
//   1. Opens an external browser to the MoR's hosted checkout page with
//      the installId pre-filled as client_reference_id so the webhook
//      can route the issued license back.
//   2. Opens the MoR's customer portal so existing subscribers can
//      manage billing, cancel, swap cards, etc.
//
// MoR provider + product URLs are configured via env vars at build time
// so the same binary can target staging vs prod. Falls back to PAiA's
// own pricing page when nothing is configured.

import { app, shell } from 'electron';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';
import type { LicenseTier } from '../shared/types';

const PRICING_FALLBACK_URL = 'https://paia.app/pricing';

// MoR config — read at startup. The env vars are the contract; users
// don't see them.
const MOR_CHECKOUT_BASE = process.env.PAIA_CHECKOUT_BASE_URL ?? '';
const MOR_PORTAL_BASE = process.env.PAIA_PORTAL_BASE_URL ?? '';
// One product URL per upgrade target.
const PRODUCT_URLS: Record<Exclude<LicenseTier, 'free'>, string> = {
  pro: process.env.PAIA_CHECKOUT_PRO_URL ?? '',
  legal: process.env.PAIA_CHECKOUT_LEGAL_URL ?? '',
  therapy: process.env.PAIA_CHECKOUT_THERAPY_URL ?? '',
  finance: process.env.PAIA_CHECKOUT_FINANCE_URL ?? '',
  team: process.env.PAIA_CHECKOUT_TEAM_URL ?? '',
};

// installId — stable per machine, used as client_reference_id so the
// webhook knows which install to issue the license for. Generated on
// first call; persists in userData.
function installIdPath(): string {
  return path.join(app.getPath('userData'), 'install-id.txt');
}

export function getInstallId(): string {
  try {
    const cached = fs.readFileSync(installIdPath(), 'utf-8').trim();
    if (cached) return cached;
  } catch {
    /* fall through */
  }
  const fresh = crypto.randomBytes(16).toString('hex');
  try {
    fs.mkdirSync(path.dirname(installIdPath()), { recursive: true });
    fs.writeFileSync(installIdPath(), fresh);
  } catch (err) {
    logger.warn('checkout: failed to persist installId', err);
  }
  return fresh;
}

/**
 * Open the MoR hosted checkout for a specific upgrade target. Falls
 * back to the public pricing page if PAIA_CHECKOUT_<TIER>_URL isn't set
 * (e.g. during development, or before MoR onboarding completes).
 */
export async function openCheckout(target: Exclude<LicenseTier, 'free'>): Promise<void> {
  const productUrl = PRODUCT_URLS[target] || MOR_CHECKOUT_BASE;
  if (!productUrl) {
    logger.info(`checkout: no PAIA_CHECKOUT_${target.toUpperCase()}_URL set; opening public pricing`);
    await shell.openExternal(PRICING_FALLBACK_URL);
    return;
  }
  const installId = getInstallId();
  const url = appendQuery(productUrl, {
    client_reference_id: installId,
    install_id: installId,
    paia_version: app.getVersion(),
  });
  await shell.openExternal(url);
}

/**
 * Open the MoR customer portal so an existing subscriber can manage
 * their subscription (cancel, swap cards, change seats, etc.).
 * The subscriptionId, if known, is passed so the portal can deep-link
 * to that specific subscription.
 */
export async function openCustomerPortal(subscriptionId?: string): Promise<void> {
  if (!MOR_PORTAL_BASE) {
    logger.info('checkout: no PAIA_PORTAL_BASE_URL set; opening public account page');
    await shell.openExternal('https://paia.app/account');
    return;
  }
  const url = subscriptionId
    ? appendQuery(MOR_PORTAL_BASE, { subscription_id: subscriptionId })
    : MOR_PORTAL_BASE;
  await shell.openExternal(url);
}

function appendQuery(url: string, params: Record<string, string>): string {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) {
    u.searchParams.set(k, v);
  }
  return u.toString();
}
