// MCP (Model Context Protocol) client.
//
// Spawns one or more MCP servers from a JSON config file in userData,
// connects to each over stdio, lists their tools, and exposes a unified
// "call any tool" surface to the rest of the app.
//
// Security model: every tool call goes through requestApproval(), which
// pops a confirmation in the renderer unless the tool name is in the
// server's autoApprove list. The renderer must respond with approve()
// or deny() before the call proceeds.

import { app, ipcMain, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type {
  McpServerConfig,
  McpServerState,
  McpServerStatus,
  McpToolCallResult,
  McpToolInfo,
} from '../shared/types';
import { isFeatureEnabled } from './license';
import { logger } from './logger';

// We import the SDK lazily — its TypeScript types are deep and we only
// want the cost paid when the user actually configures servers.
type McpClient = {
  connect(transport: unknown): Promise<void>;
  close(): Promise<void>;
  listTools(): Promise<{ tools: { name: string; description?: string; inputSchema?: unknown }[] }>;
  callTool(args: { name: string; arguments?: unknown }): Promise<{ content?: { type: string; text?: string }[]; isError?: boolean }>;
};

const states = new Map<string, { state: McpServerState; client?: McpClient }>();
const pendingApprovals = new Map<
  string,
  { resolve: (allowed: boolean) => void; serverId: string; toolName: string }
>();

let activeWindow: BrowserWindow | null = null;
export function setActiveWindow(win: BrowserWindow): void {
  activeWindow = win;
}

function configPath(): string {
  return path.join(app.getPath('userData'), 'mcp.json');
}

export function loadConfigs(): McpServerConfig[] {
  try {
    const raw = fs.readFileSync(configPath(), 'utf-8');
    return JSON.parse(raw) as McpServerConfig[];
  } catch {
    return [];
  }
}

export function saveConfigs(list: McpServerConfig[]): void {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(list, null, 2));
}

export function listStates(): McpServerState[] {
  return Array.from(states.values()).map((s) => s.state);
}

export function listAllTools(): McpToolInfo[] {
  return Array.from(states.values()).flatMap((s) => s.state.tools);
}

function setStatus(id: string, status: McpServerStatus, error?: string): void {
  const slot = states.get(id);
  if (!slot) return;
  slot.state.status = status;
  slot.state.error = error;
  activeWindow?.webContents.send('paia:mcp-state', slot.state);
}

export async function startServer(config: McpServerConfig): Promise<void> {
  if (!config.enabled) return;
  if (states.has(config.id)) {
    await stopServer(config.id);
  }
  states.set(config.id, {
    state: { config, status: 'starting', tools: [] },
    client: undefined,
  });
  setStatus(config.id, 'starting');

  try {
    const sdkClient = await import('@modelcontextprotocol/sdk/client/index.js');
    const sdkStdio = await import('@modelcontextprotocol/sdk/client/stdio.js');

    // Strip any undefined values from process.env so the transport gets
    // a clean Record<string, string>.
    const cleanEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === 'string') cleanEnv[k] = v;
    }
    const transport = new sdkStdio.StdioClientTransport({
      command: config.command,
      args: config.args,
      env: { ...cleanEnv, ...config.env },
    });

    const client = new sdkClient.Client(
      { name: 'paia', version: '0.2.0' },
      { capabilities: {} },
    ) as unknown as McpClient;

    await client.connect(transport);
    const tools = await client.listTools();

    const toolInfo: McpToolInfo[] = tools.tools.map((t) => ({
      serverId: config.id,
      serverName: config.name,
      name: t.name,
      description: t.description ?? '',
      inputSchema: t.inputSchema,
    }));

    const slot = states.get(config.id);
    if (slot) {
      slot.state.tools = toolInfo;
      slot.client = client;
    }
    setStatus(config.id, 'running');
    logger.info(`MCP server "${config.name}" running with ${toolInfo.length} tool(s)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`MCP server "${config.name}" failed:`, message);
    setStatus(config.id, 'error', message);
  }
}

export async function stopServer(id: string): Promise<void> {
  const slot = states.get(id);
  if (!slot) return;
  try {
    await slot.client?.close();
  } catch {
    /* ignore */
  }
  setStatus(id, 'stopped');
  states.delete(id);
}

export async function startAllConfigured(): Promise<void> {
  const configs = loadConfigs();
  for (const c of configs) {
    if (c.enabled) {
      void startServer(c);
    }
  }
}

export async function stopAll(): Promise<void> {
  for (const id of Array.from(states.keys())) {
    await stopServer(id);
  }
}

// ─── tool calls (with approval) ────────────────────────────────────

function requestApproval(serverId: string, serverName: string, toolName: string, args: unknown): Promise<boolean> {
  const slot = states.get(serverId);
  // Auto-approve if the user has whitelisted this tool name.
  if (slot?.state.config.autoApprove.includes(toolName)) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const requestId = randomUUID();
    pendingApprovals.set(requestId, { resolve, serverId, toolName });
    activeWindow?.webContents.send('paia:mcp-tool-approval', {
      requestId,
      serverId,
      serverName,
      toolName,
      args,
    });
  });
}

ipcMain.handle('paia:mcp-approve', (_e, p: { requestId: string; allow: boolean }) => {
  const pending = pendingApprovals.get(p.requestId);
  if (!pending) return;
  pendingApprovals.delete(p.requestId);
  pending.resolve(p.allow);
});

export async function callTool(serverId: string, toolName: string, args: unknown): Promise<McpToolCallResult> {
  if (!isFeatureEnabled('mcp')) {
    return { ok: false, error: 'MCP requires PAiA Pro. Start a trial or activate a license.' };
  }
  const slot = states.get(serverId);
  if (!slot || !slot.client) {
    return { ok: false, error: `Server ${serverId} not connected` };
  }

  const allowed = await requestApproval(serverId, slot.state.config.name, toolName, args);
  if (!allowed) {
    return { ok: false, error: 'User denied tool call' };
  }

  try {
    const result = await slot.client.callTool({ name: toolName, arguments: args });
    if (result.isError) {
      return { ok: false, error: 'tool returned error' };
    }
    const text = (result.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n');
    return { ok: true, content: text };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

// ─── IPC for the renderer ──────────────────────────────────────────

ipcMain.handle('paia:mcp-list', () => listStates());
ipcMain.handle('paia:mcp-list-configs', () => loadConfigs());

ipcMain.handle('paia:mcp-save-configs', async (_e, list: McpServerConfig[]) => {
  saveConfigs(list);
  // Restart everything so changes take effect immediately.
  await stopAll();
  await startAllConfigured();
  return list;
});

ipcMain.handle('paia:mcp-call-tool', (_e, p: { serverId: string; toolName: string; args: unknown }) =>
  callTool(p.serverId, p.toolName, p.args),
);

ipcMain.handle('paia:mcp-list-tools', () => listAllTools());
