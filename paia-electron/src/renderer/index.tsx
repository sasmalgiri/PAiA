// React renderer entry. Mounts <App/> into #root.
//
// Renderer-process Sentry init lives here. It's gated on the same
// opt-in flags as the main process (settings.crashReportsEnabled +
// settings.crashReportsDsn), but the renderer can't synchronously read
// settings — so we ask main first, then init. The window comes up
// either way; init runs in the background.

import { createRoot } from 'react-dom/client';
import * as sentry from '@sentry/electron/renderer';
import { App } from './App';
import { api } from './lib/api';
import { redact } from '../shared/redaction';

async function maybeInitSentry(): Promise<void> {
  try {
    const settings = await api.getSettings();
    if (!settings.crashReportsEnabled || !settings.crashReportsDsn) return;
    sentry.init({
      // The DSN is set in the main process. We pass an empty string
      // here so the SDK picks up the main-process configuration via
      // its own IPC channel.
      dsn: '',
      sendDefaultPii: false,
      beforeSend(event) {
        if (event.message) event.message = redact(event.message).redacted;
        if (event.exception?.values) {
          for (const ex of event.exception.values) {
            if (ex.value) ex.value = redact(ex.value).redacted;
          }
        }
        delete event.user;
        return event;
      },
      beforeBreadcrumb(crumb) {
        // Drop console + DOM input breadcrumbs — both can leak chat
        // content into stack traces.
        if (crumb.category === 'console' || crumb.category === 'ui.input') return null;
        if (crumb.message) crumb.message = redact(crumb.message).redacted;
        return crumb;
      },
    });
  } catch {
    /* swallow — never block renderer boot on telemetry */
  }
}

void maybeInitSentry();

const container = document.getElementById('root');
if (!container) throw new Error('No #root element');
createRoot(container).render(<App />);
