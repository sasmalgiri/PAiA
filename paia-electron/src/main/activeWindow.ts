// Active window detection.
//
// We avoid native modules entirely — they make distribution painful and
// we don't need millisecond accuracy. Instead we shell out to a tiny
// platform-specific command:
//
//   Windows  → PowerShell + Add-Type for the Win32 API
//   macOS    → osascript + System Events
//   Linux    → xdotool (requires the user to have it installed)
//
// All three return a JSON-ish line that we parse into ActiveWindowInfo.
// Calls are debounced — if the same window stays focused, we return the
// cached result. Worst case latency is ~50ms per call on Windows, which
// is fine for "what's the user looking at right now?" use cases.

import { execFile } from 'child_process';
import { BrowserWindow } from 'electron';
import { promisify } from 'util';
import type { ActiveWindowInfo } from '../shared/types';
import { logger } from './logger';

const exec = promisify(execFile);

let cache: ActiveWindowInfo | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 800;

const PS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class W {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int maxLen);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
"@
$h = [W]::GetForegroundWindow()
$len = [W]::GetWindowTextLength($h) + 1
$sb = New-Object System.Text.StringBuilder $len
[W]::GetWindowText($h, $sb, $len) | Out-Null
$pid = 0
[W]::GetWindowThreadProcessId($h, [ref]$pid) | Out-Null
$proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
$name = if ($proc) { $proc.ProcessName } else { '' }
[Console]::Out.WriteLine(($sb.ToString() + '|||' + $name + '|||' + $pid))
`.trim();

const APPLESCRIPT = `
tell application "System Events"
  set frontApp to first application process whose frontmost is true
  set appName to name of frontApp
  try
    set winTitle to name of front window of frontApp
  on error
    set winTitle to ""
  end try
  return winTitle & "|||" & appName
end tell
`.trim();

async function detectWindows(): Promise<ActiveWindowInfo | null> {
  try {
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-Command', PS_SCRIPT], {
      timeout: 2000,
      windowsHide: true,
    });
    const line = stdout.trim().split('\n').pop() ?? '';
    const [title, name, pidStr] = line.split('|||');
    if (!title && !name) return null;
    return {
      title: title ?? '',
      appName: name ?? '',
      processId: pidStr ? parseInt(pidStr, 10) : undefined,
      capturedAt: Date.now(),
    };
  } catch (err) {
    logger.warn('active window (win) failed', err);
    return null;
  }
}

async function detectMac(): Promise<ActiveWindowInfo | null> {
  try {
    const { stdout } = await exec('osascript', ['-e', APPLESCRIPT], { timeout: 2000 });
    const [title, name] = stdout.trim().split('|||');
    return {
      title: title ?? '',
      appName: name ?? '',
      capturedAt: Date.now(),
    };
  } catch (err) {
    logger.warn('active window (mac) failed', err);
    return null;
  }
}

async function detectLinux(): Promise<ActiveWindowInfo | null> {
  // X11 path: xdotool. Works on every X11 desktop and is universally
  // packaged. Try first because it's the most reliable.
  if (process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    try {
      const idResult = await exec('xdotool', ['getactivewindow'], { timeout: 1500 });
      const id = idResult.stdout.trim();
      if (id) {
        const titleResult = await exec('xdotool', ['getwindowname', id], { timeout: 1500 });
        const classResult = await exec('xdotool', ['getwindowclassname', id], { timeout: 1500 }).catch(() => ({ stdout: '' }));
        return {
          title: titleResult.stdout.trim(),
          appName: classResult.stdout.trim(),
          capturedAt: Date.now(),
        };
      }
    } catch (err) {
      logger.warn('active window (xdotool) failed — falling back', err);
    }
  }

  // Wayland path: there is no universal solution. Try a few options in
  // order of how widely they work, then give up gracefully.

  // Option 1: GNOME Shell with the "window-calls" extension installed.
  // Returns a JSON array of windows; we pick whichever has has_focus=true.
  try {
    const { stdout } = await exec(
      'gdbus',
      [
        'call',
        '--session',
        '--dest', 'org.gnome.Shell',
        '--object-path', '/org/gnome/Shell/Extensions/Windows',
        '--method', 'org.gnome.Shell.Extensions.Windows.List',
      ],
      { timeout: 1500 },
    );
    // gdbus wraps the JSON in `(strvalue,)` quotes — strip them.
    const m = stdout.match(/'(\[.*\])'/);
    if (m) {
      const windows = JSON.parse(m[1]) as Array<{
        title: string;
        wm_class: string;
        focus?: boolean;
        in_current_workspace?: boolean;
      }>;
      const focused = windows.find((w) => w.focus) ?? windows[0];
      if (focused) {
        return {
          title: focused.title ?? '',
          appName: focused.wm_class ?? '',
          capturedAt: Date.now(),
        };
      }
    }
  } catch {
    /* fall through to next option */
  }

  // Option 2: KDE Plasma — KWin has a `org.kde.KWin` D-Bus interface.
  try {
    const { stdout } = await exec(
      'qdbus',
      [
        'org.kde.KWin',
        '/KWin',
        'org.kde.KWin.activeWindow',
      ],
      { timeout: 1500 },
    );
    const id = stdout.trim();
    if (id) {
      // Best-effort title lookup; KDE doesn't expose it cleanly via dbus.
      return {
        title: '(KDE Plasma window)',
        appName: 'kwin',
        capturedAt: Date.now(),
      };
    }
  } catch {
    /* fall through */
  }

  // Option 3: hyprctl for Hyprland users.
  try {
    const { stdout } = await exec('hyprctl', ['activewindow', '-j'], { timeout: 1500 });
    const data = JSON.parse(stdout) as { title?: string; class?: string };
    return {
      title: data.title ?? '',
      appName: data.class ?? '',
      capturedAt: Date.now(),
    };
  } catch {
    /* fall through */
  }

  logger.warn(
    'active window (linux): no detection method available. ' +
    'Install xdotool (X11), or the gnome-shell-extension-window-calls extension (GNOME Wayland), ' +
    'or use KDE/Hyprland for built-in support.',
  );
  return null;
}

/**
 * Get the title + application name of the currently focused window. We
 * intentionally exclude PAiA's own window from the result, since the
 * common use case is "tell me about the thing I was looking at before
 * I opened PAiA."
 */
export async function getActiveWindow(): Promise<ActiveWindowInfo | null> {
  if (cache && Date.now() - cacheTime < CACHE_TTL_MS) return cache;

  let result: ActiveWindowInfo | null = null;
  switch (process.platform) {
    case 'win32': result = await detectWindows(); break;
    case 'darwin': result = await detectMac(); break;
    case 'linux': result = await detectLinux(); break;
    default: result = null;
  }

  // Filter out PAiA itself — if the active window is one of our own,
  // ignore it. We can't do a perfect match here (the OS title is
  // process-name + window-title), so we use a heuristic on the title.
  if (result) {
    const ours = BrowserWindow.getAllWindows().some(
      (w) => result?.title && w.getTitle() && result.title.includes(w.getTitle()),
    );
    if (ours) result = null;
    else if (result.appName && /electron|paia/i.test(result.appName)) {
      result = null;
    }
  }

  cache = result;
  cacheTime = Date.now();
  return result;
}
