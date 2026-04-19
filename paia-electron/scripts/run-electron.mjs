// Launches Electron with a clean environment.
//
// Why this exists: some shells (notably ones that have ever sourced an
// `electron-debug` profile or set up an Electron→Node test harness) export
// `ELECTRON_RUN_AS_NODE=1`. When that variable is set, the electron.exe
// binary skips its Chromium/main-process bootstrap and behaves like vanilla
// Node — which makes `require('electron')` return a string path instead of
// the API surface, and the app instantly crashes with "Cannot read
// properties of undefined (reading 'requestSingleInstanceLock')".
//
// We strip ELECTRON_RUN_AS_NODE from the spawned environment so the app
// always launches in real GUI mode regardless of the parent shell.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronPath = require('electron'); // resolves to the binary path string

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const args = ['.', ...process.argv.slice(2)];
const child = spawn(electronPath, args, {
  stdio: 'inherit',
  env,
  cwd: process.cwd(),
});

child.on('exit', (code) => process.exit(code ?? 0));
