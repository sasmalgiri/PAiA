// Native OS notifications.
//
// Thin wrapper over Electron's Notification so the rest of the app
// doesn't have to import electron just to nudge the user. Respects
// settings.notificationsEnabled.

import { Notification } from 'electron';
import * as settingsStore from './settings';

export interface NotifyOpts {
  title: string;
  body: string;
  /** Silent notifications don't beep; useful for ambient suggestions. */
  silent?: boolean;
  /** If set, clicking the notification focuses a specific target in the renderer. */
  clickTarget?: string;
  onClick?: () => void;
}

export function notify(opts: NotifyOpts): void {
  if (!settingsStore.load().notificationsEnabled) return;
  if (!Notification.isSupported()) return;
  const n = new Notification({
    title: opts.title,
    body: opts.body,
    silent: opts.silent,
    timeoutType: 'default',
  });
  if (opts.onClick) n.on('click', opts.onClick);
  n.show();
}
