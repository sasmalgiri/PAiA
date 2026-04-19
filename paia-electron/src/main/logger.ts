// Centralised logger. Wraps electron-log so we get rotating files
// in userData/logs and console output in dev. Imported by every other
// main-process module.

import log from 'electron-log/main';

log.transports.file.level = 'info';
log.transports.console.level = 'info';
log.transports.file.maxSize = 5 * 1024 * 1024; // 5 MB rotation
log.errorHandler.startCatching({
  showDialog: false,
  onError: ({ error }) => {
    log.error('uncaught:', error);
  },
});

export const logger = log;
