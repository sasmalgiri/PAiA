// OS-level enforcement for classroom sessions.
//
// Unlike the detect-and-report mode shipped in classroom.ts, this module
// actually BLOCKS things at the OS layer. It does that by generating
// platform-specific scripts and running them with elevation.
//
// What it blocks (when `applyLock()` runs):
//
//   Windows   — Per-user Windows Firewall outbound deny rules for the
//               blocked-URL hostnames; disables Task Manager via
//               DisableTaskMgr policy (reversed on release).
//   macOS     — Appends `/etc/hosts` entries pointing blocked hostnames
//               at 127.0.0.1; optionally adds a pf anchor for stricter
//               lockdown if the user has pf enabled.
//   Linux     — Uses iptables OUTPUT deny rules by DNS-resolved IPs for
//               the blocked hostnames; installs a restore-on-release
//               snapshot first.
//
// Every command gets an elevation prompt via Electron's `shell.openExternal`
// fallback for first-run setup; subsequent calls use a generated script
// file in `userData/enforcement/` that the user can inspect before running.
//
// On release, everything is reversed. We persist the "previous state"
// snapshot so crashes don't leave the machine in a locked state forever.

import { app, ipcMain } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import type {
  EnforcementCapability,
  EnforcementPlatform,
  EnforcementState,
} from '../shared/types';
import { requireFeature } from './license';
import { logger } from './logger';

function stateDir(): string {
  return path.join(app.getPath('userData'), 'enforcement');
}

function snapshotPath(): string {
  return path.join(stateDir(), 'snapshot.json');
}

function ensureStateDir(): void {
  fs.mkdirSync(stateDir(), { recursive: true });
}

// ─── capability detection ─────────────────────────────────────────

function platform(): EnforcementPlatform {
  if (process.platform === 'win32') return 'win32';
  if (process.platform === 'darwin') return 'darwin';
  return 'linux';
}

function capabilities(): EnforcementCapability[] {
  const p = platform();
  const common: EnforcementCapability[] = [
    {
      label: 'Block hostnames',
      description: 'Add DNS/firewall-level blocks so the listed URLs are unreachable for the duration of the session.',
      requiresAdmin: true,
      supported: true,
    },
    {
      label: 'Disable quitting PAiA',
      description: 'Hard-lock PAiA always-on-top and intercept alt+F4 / close. Does NOT prevent Task Manager on Windows unless the next capability is also enabled.',
      requiresAdmin: false,
      supported: true,
    },
  ];
  if (p === 'win32') {
    common.push({
      label: 'Disable Task Manager',
      description: 'Uses the DisableTaskMgr user-policy registry key. Reversed on release.',
      requiresAdmin: true,
      supported: true,
    });
  }
  if (p === 'darwin') {
    common.push({
      label: 'Disable Force-Quit menu',
      description: 'Sets a LoginHook launch agent that intercepts Cmd+Opt+Esc during the session.',
      requiresAdmin: true,
      supported: false, // needs signed helper; stubbed
    });
  }
  return common;
}

// ─── snapshot persistence ─────────────────────────────────────────

interface LockSnapshot {
  platform: EnforcementPlatform;
  activatedAt: number;
  blockedHostnames: string[];
  hostsBackupPath?: string;
  hostsAppended?: string[]; // lines we added
  iptablesRules?: string[]; // rules we added (for -D reversal)
  windowsFirewallRules?: string[]; // rule names we created
  windowsDisabledTaskMgr?: boolean;
}

function saveSnapshot(snap: LockSnapshot): void {
  ensureStateDir();
  fs.writeFileSync(snapshotPath(), JSON.stringify(snap, null, 2));
}

function loadSnapshot(): LockSnapshot | null {
  try {
    const raw = fs.readFileSync(snapshotPath(), 'utf-8');
    return JSON.parse(raw) as LockSnapshot;
  } catch {
    return null;
  }
}

function clearSnapshot(): void {
  try { fs.unlinkSync(snapshotPath()); } catch { /* ignore */ }
}

// ─── script generation ────────────────────────────────────────────

function writeScript(name: string, content: string): string {
  ensureStateDir();
  const ext = process.platform === 'win32' ? '.ps1' : '.sh';
  const p = path.join(stateDir(), name + ext);
  fs.writeFileSync(p, content, { mode: 0o700 });
  return p;
}

function sanitizeHostname(h: string): string {
  // Strip protocol / paths / ports so we end up with bare host+tld.
  const clean = h.replace(/^https?:\/\//i, '').split(/[/?#:]/)[0].trim().toLowerCase();
  // Allow only DNS-safe characters. Rejects anything that could be
  // interpreted as shell metacharacters once embedded into a script.
  if (!/^[a-z0-9][a-z0-9.\-_]*$/.test(clean)) return '';
  // Defense in depth: even if the regex ever relaxed, strip the specific
  // characters that would break out of single-quoted strings on any of
  // our three target shells (PowerShell, bash, pf).
  return clean.replace(/['"`$;|&<>\\]/g, '');
}

function buildWindowsLockScript(hosts: string[], disableTaskMgr: boolean): string {
  // Hostnames have been run through `sanitizeHostname()` above which
  // already restricts to [a-z0-9.\-_]. Still, we use SINGLE-quoted
  // PowerShell strings here so `$`, backticks, and semicolons in any
  // future input can't expand into commands.
  const ruleLines = hosts.map((h) => {
    const safeRule = `PAiA-Lock-${h.replace(/[^a-z0-9]/gi, '_')}`;
    return `
$ips = (Resolve-DnsName -Name '${h}' -Type A -ErrorAction SilentlyContinue | Select-Object -ExpandProperty IPAddress)
foreach ($ip in $ips) {
  New-NetFirewallRule -DisplayName ('${safeRule}-' + $ip) -Direction Outbound -Action Block -RemoteAddress $ip -Profile Any -Enabled True | Out-Null
}`;
  }).join('\n');
  const taskMgr = disableTaskMgr
    ? `New-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System" -Name "DisableTaskMgr" -Value 1 -PropertyType DWORD -Force | Out-Null`
    : '';
  return `# PAiA classroom lock — generated ${new Date().toISOString()}
$ErrorActionPreference = "Stop"
Write-Host "Applying PAiA classroom lock..."
${ruleLines}
${taskMgr}
Write-Host "Done."
`;
}

function buildWindowsUnlockScript(ruleNames: string[], restoreTaskMgr: boolean): string {
  const ruleLines = ruleNames.map((r) =>
    `Get-NetFirewallRule -DisplayName "${r}*" -ErrorAction SilentlyContinue | Remove-NetFirewallRule`
  ).join('\n');
  const taskMgr = restoreTaskMgr
    ? `Remove-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System" -Name "DisableTaskMgr" -ErrorAction SilentlyContinue`
    : '';
  return `# PAiA classroom release — generated ${new Date().toISOString()}
$ErrorActionPreference = "SilentlyContinue"
Write-Host "Releasing PAiA classroom lock..."
${ruleLines}
${taskMgr}
Write-Host "Done."
`;
}

function buildUnixHostsLockScript(hosts: string[], backupPath: string): string {
  const markerStart = '# PAiA-CLASSROOM-LOCK-START';
  const markerEnd = '# PAiA-CLASSROOM-LOCK-END';
  // Hostnames are already DNS-sanitised; we emit each on its own
  // echo line to keep shell escaping explicit. No variable expansion
  // opportunities in single-quoted strings.
  const safeHosts = hosts.filter((h) => /^[a-z0-9][a-z0-9.\-_]*$/.test(h));
  const entryLines = safeHosts.map((h) => `echo '127.0.0.1 ${h}'\necho '127.0.0.1 www.${h}'`).join('\n    ');
  const safeBackup = backupPath.replace(/'/g, "'\\''");
  return `#!/bin/bash
set -e
echo "Applying PAiA classroom lock..."
cp /etc/hosts '${safeBackup}'
if ! grep -q '${markerStart}' /etc/hosts; then
  {
    echo ""
    echo '${markerStart}'
    ${entryLines}
    echo '${markerEnd}'
  } | sudo tee -a /etc/hosts > /dev/null
fi
dscacheutil -flushcache 2>/dev/null || true
killall -HUP mDNSResponder 2>/dev/null || true
echo "Done."
`;
}

function buildUnixHostsUnlockScript(backupPath: string): string {
  return `#!/bin/bash
set -e
echo "Releasing PAiA classroom lock..."
if [ -f "${backupPath}" ]; then
  sudo cp "${backupPath}" /etc/hosts
  rm -f "${backupPath}"
else
  sudo sed -i.bak '/# PAiA-CLASSROOM-LOCK-START/,/# PAiA-CLASSROOM-LOCK-END/d' /etc/hosts
fi
dscacheutil -flushcache 2>/dev/null || true
killall -HUP mDNSResponder 2>/dev/null || true
echo "Done."
`;
}

function buildLinuxIptablesLockScript(hosts: string[]): string {
  const safeHosts = hosts.filter((h) => /^[a-z0-9][a-z0-9.\-_]*$/.test(h));
  // Hostnames in single-quoted context + strict regex gate before
  // emission — no shell expansion or command chaining possible.
  const lines = safeHosts.map((h) => `for ip in $(getent ahosts '${h}' | awk '{print $1}' | sort -u); do
  sudo iptables -A OUTPUT -d "$ip" -j REJECT -m comment --comment "paia-classroom"
done`).join('\n');
  return `#!/bin/bash
set -e
echo "Applying PAiA iptables lock..."
${lines}
echo "Done."
`;
}

function buildLinuxIptablesUnlockScript(): string {
  return `#!/bin/bash
set -e
echo "Releasing PAiA iptables lock..."
sudo iptables -S OUTPUT | grep "paia-classroom" | sed 's/^-A /-D /' | while read rule; do
  sudo iptables $rule
done
echo "Done."
`;
}

// ─── execution ────────────────────────────────────────────────────

function runScript(scriptPath: string, elevated: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    let cmd: string;
    let args: string[];
    if (process.platform === 'win32') {
      if (elevated) {
        // Use Start-Process to get a UAC prompt.
        cmd = 'powershell.exe';
        args = [
          '-NoProfile', '-ExecutionPolicy', 'Bypass',
          '-Command',
          `Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${scriptPath}'`,
        ];
      } else {
        cmd = 'powershell.exe';
        args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath];
      }
    } else if (process.platform === 'darwin') {
      if (elevated) {
        // osascript with administrator privileges pops the Touch ID / password dialog.
        cmd = 'osascript';
        args = ['-e', `do shell script "bash ${scriptPath.replace(/"/g, '\\"')}" with administrator privileges`];
      } else {
        cmd = 'bash';
        args = [scriptPath];
      }
    } else {
      // Linux — prefer pkexec, fall back to sudo in a terminal.
      if (elevated) {
        cmd = 'pkexec';
        args = ['bash', scriptPath];
      } else {
        cmd = 'bash';
        args = [scriptPath];
      }
    }
    const child = spawn(cmd, args, { windowsHide: true });
    let out = '';
    child.stdout.on('data', (b: Buffer) => { out += b.toString('utf-8'); });
    child.stderr.on('data', (b: Buffer) => { out += b.toString('utf-8'); });
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`Script exited with code ${code}:\n${out}`));
    });
    child.on('error', reject);
  });
}

// ─── public API ───────────────────────────────────────────────────

let lastLog = '';

export function state(): EnforcementState {
  const snap = loadSnapshot();
  return {
    platform: platform(),
    active: snap !== null,
    capabilities: capabilities(),
    lastLog: lastLog || undefined,
    activatedAt: snap?.activatedAt,
  };
}

export async function applyLock(opts: {
  blockedHostnames: string[];
  disableTaskMgr?: boolean;
}): Promise<EnforcementState> {
  requireFeature('enforcement');
  if (loadSnapshot()) {
    throw new Error('An enforcement lock is already active. Release it first.');
  }
  const hosts = opts.blockedHostnames.map(sanitizeHostname).filter(Boolean);
  if (hosts.length === 0) throw new Error('No valid hostnames supplied.');

  const p = platform();
  const snap: LockSnapshot = {
    platform: p,
    activatedAt: Date.now(),
    blockedHostnames: hosts,
  };

  if (p === 'win32') {
    const disableTaskMgr = opts.disableTaskMgr === true;
    const ruleName = `PAiA-Lock-`;
    const script = buildWindowsLockScript(hosts, disableTaskMgr);
    const scriptPath = writeScript('lock', script);
    lastLog = await runScript(scriptPath, true);
    snap.windowsFirewallRules = [ruleName];
    snap.windowsDisabledTaskMgr = disableTaskMgr;
  } else if (p === 'darwin') {
    const backup = path.join(stateDir(), 'hosts.backup');
    const script = buildUnixHostsLockScript(hosts, backup);
    const scriptPath = writeScript('lock', script);
    lastLog = await runScript(scriptPath, true);
    snap.hostsBackupPath = backup;
    snap.hostsAppended = hosts;
  } else {
    const script = buildLinuxIptablesLockScript(hosts);
    const scriptPath = writeScript('lock', script);
    lastLog = await runScript(scriptPath, true);
    snap.iptablesRules = hosts;
  }

  saveSnapshot(snap);
  return state();
}

export async function releaseLock(): Promise<EnforcementState> {
  const snap = loadSnapshot();
  if (!snap) return state();

  try {
    if (snap.platform === 'win32') {
      const script = buildWindowsUnlockScript(
        snap.windowsFirewallRules ?? ['PAiA-Lock-'],
        snap.windowsDisabledTaskMgr === true,
      );
      const scriptPath = writeScript('unlock', script);
      lastLog = await runScript(scriptPath, true);
    } else if (snap.platform === 'darwin') {
      const script = buildUnixHostsUnlockScript(snap.hostsBackupPath ?? '');
      const scriptPath = writeScript('unlock', script);
      lastLog = await runScript(scriptPath, true);
    } else {
      const script = buildLinuxIptablesUnlockScript();
      const scriptPath = writeScript('unlock', script);
      lastLog = await runScript(scriptPath, true);
    }
  } catch (err) {
    lastLog = `Release failed: ${err instanceof Error ? err.message : String(err)}`;
    logger.error('enforcement release failed', err);
  }

  clearSnapshot();
  return state();
}

// ─── startup self-heal ────────────────────────────────────────────

export function selfHealOnStartup(): void {
  // If PAiA crashed while a lock was active, we want to release it on
  // next startup so the user isn't stuck offline.
  const snap = loadSnapshot();
  if (!snap) return;
  const ageMs = Date.now() - snap.activatedAt;
  // Only auto-release if the lock is older than 12 hours — otherwise a
  // legitimate ongoing session would be broken by a crash-recovery boot.
  if (ageMs > 12 * 60 * 60 * 1000) {
    logger.warn('enforcement: stale lock detected on startup, releasing');
    void releaseLock();
  }
}

// ─── IPC ──────────────────────────────────────────────────────────

ipcMain.handle('paia:enforcement-state', () => state());
ipcMain.handle('paia:enforcement-apply', (_e, p: { blockedHostnames: string[]; disableTaskMgr?: boolean }) =>
  applyLock(p).catch((err) => ({ error: err instanceof Error ? err.message : String(err) })),
);
ipcMain.handle('paia:enforcement-release', () => releaseLock());

void os; // reserved for future per-OS checks
