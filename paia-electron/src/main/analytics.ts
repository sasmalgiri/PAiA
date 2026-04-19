// Anonymous usage analytics — strictly opt-in.
//
// Design notes:
//   - DISABLED by default. The user has to flip the switch in Settings →
//     Privacy → "Enable usage analytics" before any event leaves the
//     machine.
//   - The user picks the endpoint URL. Default is empty (do nothing).
//     Drop in a PostHog self-hosted URL, a Plausible custom-events URL,
//     or your own webhook. We never bake a default — that would defeat
//     the privacy story.
//   - We send a per-install **anonymous** UUID generated on first launch
//     and stored in userData/anonymous-id.txt. NOT tied to email,
//     license, machine fingerprint, or anything else identifiable.
//   - Events are POSTed as JSON. No fancy SDK — keeps the install
//     footprint zero and lets users point at any HTTP endpoint that
//     accepts JSON.
//   - We never include the content of user prompts, file contents,
//     screen captures, voice recordings, or chat history. Just event
//     names and a small whitelist of properties (version, platform,
//     feature usage counters).

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import * as settingsStore from './settings';
import { logger } from './logger';

let cachedId: string | null = null;

function anonymousIdPath(): string {
  return path.join(app.getPath('userData'), 'anonymous-id.txt');
}

function getAnonymousId(): string {
  if (cachedId) return cachedId;
  try {
    cachedId = fs.readFileSync(anonymousIdPath(), 'utf-8').trim();
    if (cachedId) return cachedId;
  } catch {
    /* fall through and create one */
  }
  cachedId = randomUUID();
  try {
    fs.mkdirSync(path.dirname(anonymousIdPath()), { recursive: true });
    fs.writeFileSync(anonymousIdPath(), cachedId);
  } catch (err) {
    logger.warn('failed to persist anonymous id', err);
  }
  return cachedId;
}

/**
 * Send a single event. The whitelist of allowed property keys keeps us
 * honest — anything outside it is silently dropped, so future
 * contributors can't accidentally start logging chat content.
 */
const ALLOWED_PROPS = new Set([
  'version',
  'platform',
  'feature',
  'count',
  'tier',
  'persona',
  'provider',
  'success',
  'duration_ms',
]);

export async function event(name: string, props: Record<string, unknown> = {}): Promise<void> {
  const settings = settingsStore.load();
  if (!settings.analyticsEnabled || !settings.analyticsEndpoint) return;

  const safeProps: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (ALLOWED_PROPS.has(k)) safeProps[k] = v;
  }

  const payload = {
    anonymous_id: getAnonymousId(),
    event: name,
    timestamp: new Date().toISOString(),
    properties: safeProps,
  };

  try {
    await fetch(settings.analyticsEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      // Short timeout — analytics must NEVER block the app.
      signal: AbortSignal.timeout(3000),
    });
  } catch (err) {
    // Swallow — analytics failures are completely non-fatal.
    logger.warn('analytics failed', err);
  }
}

/**
 * Reset the anonymous id. Exposed so users who want a clean slate (or
 * who just disabled telemetry) can wipe their identifier.
 */
export function resetAnonymousId(): void {
  try {
    fs.unlinkSync(anonymousIdPath());
  } catch {
    /* ignore */
  }
  cachedId = null;
}

export function getCurrentAnonymousId(): string | null {
  if (!settingsStore.load().analyticsEnabled) return null;
  return getAnonymousId();
}
