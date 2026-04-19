// Crash reporting via Sentry — strictly opt-in.
//
// Privacy posture:
//   - DISABLED by default. The user has to flip a switch in Settings →
//     Privacy → "Enable crash reports" before anything is sent.
//   - The user picks the DSN. Default is empty (do nothing). Set it to
//     your hosted Sentry project, OR a self-hosted GlitchTip URL, OR
//     anything else that speaks the Sentry protocol. We don't bake a
//     default DSN — that would be a tracking footgun.
//   - We scrub PII from breadcrumbs and event messages using the same
//     redaction rules the chat path uses, so accidental capture of
//     emails/keys/etc. gets blocked at send time.
//   - We never attach the user's chat history, knowledge base contents,
//     or screen captures. Just stack traces, machine info, and our own
//     log lines.
//
// To turn this off completely at build time, simply do not set
// PAIA_BUILTIN_SENTRY_DSN — the default empty DSN means init() is a no-op.

import { app } from 'electron';
import * as sentry from '@sentry/electron/main';
import { redact } from '../shared/redaction';
import { logger } from './logger';
import * as settingsStore from './settings';

let initialized = false;

export function initCrashReporting(): void {
  if (initialized) return;
  const settings = settingsStore.load();
  const dsn = settings.crashReportsDsn || process.env.PAIA_BUILTIN_SENTRY_DSN || '';

  if (!settings.crashReportsEnabled || !dsn) {
    logger.info('crash reporting: disabled (opt-in)');
    return;
  }

  try {
    sentry.init({
      dsn,
      release: `paia@${app.getVersion()}`,
      environment: app.isPackaged ? 'production' : 'dev',
      // Don't auto-collect electron's preload/renderer breadcrumbs since
      // they could capture user input.
      sendDefaultPii: false,
      // Scrub PII from messages and breadcrumbs.
      beforeSend(event) {
        if (event.message) {
          event.message = redact(event.message).redacted;
        }
        if (event.exception?.values) {
          for (const ex of event.exception.values) {
            if (ex.value) ex.value = redact(ex.value).redacted;
          }
        }
        // Drop username, IP address, anything user-identifying.
        delete event.user;
        delete event.server_name;
        return event;
      },
      beforeBreadcrumb(crumb) {
        if (crumb.message) {
          crumb.message = redact(crumb.message).redacted;
        }
        // Drop console breadcrumbs entirely — too noisy and may leak.
        if (crumb.category === 'console') return null;
        return crumb;
      },
    });
    initialized = true;
    logger.info('crash reporting: initialised');
  } catch (err) {
    logger.warn('crash reporting init failed', err);
  }
}

/**
 * Manually capture an exception for one-off error paths that don't bubble
 * up to the global handler. Safe to call when reporting is disabled —
 * Sentry's sdk no-ops if init() was never called.
 */
export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return;
  try {
    sentry.captureException(err, context ? { extra: context } : undefined);
  } catch {
    /* ignore */
  }
}
