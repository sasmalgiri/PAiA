// Plugin SDK loader.
//
// Users can drop folders into `userData/plugins/` with a structure like:
//
//   userData/plugins/my-plugin/
//     paia-plugin.json   — manifest (see PluginManifest in shared/types.ts)
//     index.js           — commonjs entry; exports `register(context)`
//
// On startup (when `settings.pluginsEnabled`), we scan that directory,
// read each manifest, and if the plugin is marked enabled in our registry
// file, we require() its entry point and call `register(ctx)` exactly once.
//
// The context exposes a narrow, stable API so plugins don't depend on the
// full main-process module graph:
//
//   ctx.registerTool(toolHandler)             — contributes to the Agent tool registry
//   ctx.registerAmbientTrigger(triggerFn)      — fires on every ambient tick
//   ctx.registerSlashCommand({ name, handler }) — shows up in the composer
//
// Plugins run in the main process with full Node capabilities — this is
// intentional (the Agent already runs arbitrary shell commands when
// allowed), but plugins are disabled by default and the UI surfaces each
// plugin's declared `contributes` block so users can audit what a plugin
// adds before enabling it.

import { app, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type {
  AmbientSuggestion,
  PluginManifest,
  PluginState,
} from '../shared/types';
import type { ToolHandler } from './tools';
import { isFeatureEnabled } from './license';
import { logger } from './logger';

export interface PluginContext {
  /** Add a new Agent tool. */
  registerTool: (handler: ToolHandler) => void;
  /** Ambient trigger: called on each tick; return a suggestion or null. */
  registerAmbientTrigger: (name: string, fn: (ctx: AmbientTriggerContext) => AmbientSuggestion | null) => void;
  /** Slash command that shows up in the composer popup. */
  registerSlashCommand: (spec: { name: string; description: string; handler: (rest: string) => Promise<string> }) => void;
  /** Plain logger the plugin can call (prefix is enforced so logs are attributable). */
  log: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
}

export interface AmbientTriggerContext {
  clipboardText: string;
  activeTitle: string;
  activeApp: string;
}

interface LoadedPlugin {
  manifest: PluginManifest;
  path: string;
  enabled: boolean;
  error?: string;
  loaded: boolean;
  /** What this plugin actually registered on load. */
  contributedTools: ToolHandler[];
  contributedAmbientTriggers: { name: string; fn: (ctx: AmbientTriggerContext) => AmbientSuggestion | null }[];
  contributedSlashCommands: { name: string; description: string; handler: (rest: string) => Promise<string> }[];
}

const plugins: LoadedPlugin[] = [];

function pluginsDir(): string {
  return path.join(app.getPath('userData'), 'plugins');
}

function registryPath(): string {
  return path.join(pluginsDir(), 'registry.json');
}

function loadEnabledSet(): Set<string> {
  try {
    const raw = fs.readFileSync(registryPath(), 'utf-8');
    const parsed = JSON.parse(raw) as { enabled: string[] };
    return new Set(parsed.enabled ?? []);
  } catch {
    return new Set();
  }
}

function saveEnabledSet(set: Set<string>): void {
  fs.mkdirSync(pluginsDir(), { recursive: true });
  fs.writeFileSync(registryPath(), JSON.stringify({ enabled: Array.from(set) }, null, 2));
}

function manifestIsValid(raw: unknown): raw is PluginManifest {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.name === 'string' &&
    typeof r.version === 'string' &&
    typeof r.main === 'string' &&
    (!r.contributes || typeof r.contributes === 'object')
  );
}

// ─── load / unload ────────────────────────────────────────────────

export function scan(): void {
  plugins.length = 0;
  const root = pluginsDir();
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
    return;
  }
  const enabled = loadEnabledSet();
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    const manifestPath = path.join(dir, 'paia-plugin.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as unknown;
      if (!manifestIsValid(raw)) throw new Error('Invalid manifest');
      plugins.push({
        manifest: raw,
        path: dir,
        enabled: enabled.has(raw.id),
        loaded: false,
        contributedTools: [],
        contributedAmbientTriggers: [],
        contributedSlashCommands: [],
      });
    } catch (err) {
      logger.warn(`plugin manifest at ${dir} is invalid`, err);
    }
  }
}

export function loadAllEnabled(): void {
  scan();
  for (const p of plugins) {
    if (p.enabled && !p.loaded) {
      try {
        loadPlugin(p);
      } catch (err) {
        p.error = err instanceof Error ? err.message : String(err);
        logger.warn(`plugin "${p.manifest.id}" failed to load:`, p.error);
      }
    }
  }
}

function loadPlugin(p: LoadedPlugin): void {
  const entry = path.resolve(p.path, p.manifest.main);
  // Paranoia: make sure the resolved file stays inside the plugin dir so
  // a malicious manifest can't cause us to require something arbitrary.
  // Use fs.realpathSync on both sides to defeat symlink-based escapes
  // ("main": "subdir/../evil.js" where subdir is symlinked to /etc).
  // If realpath fails (target doesn't exist), err on the side of refusal.
  let realEntry: string;
  let realRoot: string;
  try {
    realEntry = fs.realpathSync(entry);
    realRoot = fs.realpathSync(p.path);
  } catch (err) {
    throw new Error(`Plugin entry cannot be resolved: ${err instanceof Error ? err.message : String(err)}`);
  }
  const rel = path.relative(realRoot, realEntry);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Plugin entry escapes plugin directory: ${entry}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const dynRequire = eval('require') as NodeRequire;
  const mod = dynRequire(entry) as { register?: (ctx: PluginContext) => void };
  if (typeof mod.register !== 'function') throw new Error('Plugin does not export register(context)');

  const ctx: PluginContext = {
    registerTool: (h) => { p.contributedTools.push(h); },
    registerAmbientTrigger: (name, fn) => { p.contributedAmbientTriggers.push({ name, fn }); },
    registerSlashCommand: (s) => { p.contributedSlashCommands.push(s); },
    log: (msg, ...args) => logger.info(`[plugin:${p.manifest.id}] ${msg}`, ...args),
    warn: (msg, ...args) => logger.warn(`[plugin:${p.manifest.id}] ${msg}`, ...args),
  };
  mod.register(ctx);
  p.loaded = true;
  logger.info(`plugin loaded: ${p.manifest.id} (${p.contributedTools.length} tools, ${p.contributedAmbientTriggers.length} ambient, ${p.contributedSlashCommands.length} slash)`);
}

// ─── contributions accessors (called by other subsystems) ─────────

export function contributedTools(): ToolHandler[] {
  return plugins.filter((p) => p.enabled && p.loaded).flatMap((p) => p.contributedTools);
}

export function contributedAmbientTriggers(): { name: string; fn: (ctx: AmbientTriggerContext) => AmbientSuggestion | null }[] {
  return plugins.filter((p) => p.enabled && p.loaded).flatMap((p) => p.contributedAmbientTriggers);
}

export function contributedSlashCommands(): { name: string; description: string; handler: (rest: string) => Promise<string> }[] {
  return plugins.filter((p) => p.enabled && p.loaded).flatMap((p) => p.contributedSlashCommands);
}

// ─── enable / disable ─────────────────────────────────────────────

export function setEnabled(id: string, enabled: boolean): PluginState | null {
  if (enabled && !isFeatureEnabled('plugins')) {
    throw new Error('Plugins require PAiA Pro. Start a trial or activate a license in Settings → License.');
  }
  const p = plugins.find((x) => x.manifest.id === id);
  if (!p) return null;
  const set = loadEnabledSet();
  if (enabled) set.add(id); else set.delete(id);
  saveEnabledSet(set);
  p.enabled = enabled;
  if (enabled && !p.loaded) {
    try { loadPlugin(p); } catch (err) { p.error = err instanceof Error ? err.message : String(err); }
  }
  return stateFor(p);
}

function stateFor(p: LoadedPlugin): PluginState {
  return {
    manifest: p.manifest,
    path: p.path,
    enabled: p.enabled,
    loaded: p.loaded,
    error: p.error,
  };
}

export function list(): PluginState[] {
  return plugins.map(stateFor);
}

// ─── IPC ──────────────────────────────────────────────────────────

ipcMain.handle('paia:plugins-list', () => list());
ipcMain.handle('paia:plugins-rescan', () => { scan(); return list(); });
ipcMain.handle('paia:plugins-set-enabled', (_e, p: { id: string; enabled: boolean }) => setEnabled(p.id, p.enabled));
ipcMain.handle('paia:plugins-dir', () => pluginsDir());
