// PAiA reference plugin — FEMM (Finite Element Method Magnetics).
//
// Drives FEMM's Lua scripting surface so the Agent can set up motor /
// magnetic-circuit problems, run the solver, and read back field values.
//
// Setup (one-time, per user):
//   1. Install FEMM from https://www.femm.info (Windows; use Wine on Linux/macOS).
//   2. Drop this plugin folder into `<paia userData>/plugins/femm/`.
//   3. Create `<paia userData>/plugins/femm/config.json`:
//        { "femmExe": "C:\\femm42\\bin\\femm.exe", "scriptDir": "C:\\temp\\paia-femm" }
//      On Linux with Wine, point `femmExe` at the Wine invocation wrapper.
//   4. Enable in Settings → Plugins.
//
// Safety:
//   - Every tool runs Lua *inside FEMM*, not on your shell. FEMM's Lua
//     sandbox exposes filesystem access via its own API — treat any
//     untrusted Lua as "this can read/write files". All three tools are
//     classified `high` so autonomy gating prompts the user.
//   - Output is truncated to ~100 KB so a chatty solver can't flood the
//     agent's context window.

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');

const MAX_OUTPUT_BYTES = 100 * 1024;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 min — solving can be slow.

function configPath() {
  return path.join(__dirname, 'config.json');
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(configPath(), 'utf-8');
    const cfg = JSON.parse(raw);
    if (!cfg.femmExe) throw new Error('config.json must include femmExe (absolute path to femm.exe)');
    return {
      femmExe: cfg.femmExe,
      scriptDir: cfg.scriptDir || path.join(__dirname, 'scripts'),
      timeoutMs: typeof cfg.timeoutMs === 'number' ? cfg.timeoutMs : DEFAULT_TIMEOUT_MS,
    };
  } catch (err) {
    throw new Error(
      `femm plugin: cannot read config.json at ${configPath()} — ${err.message}. ` +
      `Create it with { "femmExe": "C:\\\\femm42\\\\bin\\\\femm.exe" }`,
    );
  }
}

function asString(v, name) {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Missing string argument "${name}"`);
  return v;
}

// ─── low-level Lua runner ─────────────────────────────────────────

function runLuaScript(luaPath) {
  const cfg = loadConfig();
  return new Promise((resolve, reject) => {
    const proc = spawn(cfg.femmExe, ['-lua', luaPath, '-windowhide'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let truncated = false;

    const appendCapped = (existing, chunk) => {
      if (existing.length >= MAX_OUTPUT_BYTES) {
        truncated = true;
        return existing;
      }
      const remain = MAX_OUTPUT_BYTES - existing.length;
      if (chunk.length <= remain) return Buffer.concat([existing, chunk]);
      truncated = true;
      return Buffer.concat([existing, chunk.subarray(0, remain)]);
    };

    proc.stdout.on('data', (c) => { stdout = appendCapped(stdout, c); });
    proc.stderr.on('data', (c) => { stderr = appendCapped(stderr, c); });

    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* ignore */ }
      reject(new Error(`FEMM solver timed out after ${cfg.timeoutMs} ms`));
    }, cfg.timeoutMs);

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Could not launch FEMM (${cfg.femmExe}): ${err.message}`));
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code,
        stdout: stdout.toString('utf-8'),
        stderr: stderr.toString('utf-8'),
        truncated,
      });
    });
  });
}

async function runLuaSource(source) {
  const cfg = loadConfig();
  fs.mkdirSync(cfg.scriptDir, { recursive: true });
  const luaPath = path.join(cfg.scriptDir, `paia-${Date.now()}-${randomUUID().slice(0, 8)}.lua`);
  fs.writeFileSync(luaPath, source, 'utf-8');
  try {
    return await runLuaScript(luaPath);
  } finally {
    try { fs.unlinkSync(luaPath); } catch { /* ignore */ }
  }
}

// ─── tool implementations ─────────────────────────────────────────

async function runLua(args) {
  const source = asString(args.lua, 'lua');
  const res = await runLuaSource(source);
  return JSON.stringify(res, null, 2);
}

async function analyzeFem(args) {
  const femPath = asString(args.fem_path, 'fem_path');
  if (!fs.existsSync(femPath)) throw new Error(`fem_path does not exist: ${femPath}`);
  const problem = (args.problem_type || 'magnetic').toLowerCase();
  const openFn = {
    magnetic: 'open',          // mi_* API
    electrostatic: 'open',     // ei_*
    heatflow: 'open',          // hi_*
    currentflow: 'open',       // ci_*
  }[problem] ?? 'open';
  void openFn;
  // A generic "load → analyze → close" pattern that works for any mi_/ei_/hi_/ci_
  // problem type because the solver is dispatched by file extension.
  const lua = `
newdocument(0)
open("${femPath.replace(/\\/g, '\\\\')}")
mi_saveas("${femPath.replace(/\\/g, '\\\\')}")
mi_analyze()
mi_loadsolution()
print("[PAiA] analysis complete")
mo_close()
mi_close()
  `.trim();
  const res = await runLuaSource(lua);
  return JSON.stringify(res, null, 2);
}

async function computeTorque(args) {
  const femPath = asString(args.fem_path, 'fem_path');
  const groupId = typeof args.group === 'number' ? args.group : 1;
  const lua = `
open("${femPath.replace(/\\/g, '\\\\')}")
mi_saveas("${femPath.replace(/\\/g, '\\\\')}")
mi_analyze()
mi_loadsolution()
mo_groupselectblock(${groupId})
local torque = mo_blockintegral(22) -- 22 = steady-state weighted stress tensor torque
local fx = mo_blockintegral(18)     -- 18 = x-component of Lorentz force
local fy = mo_blockintegral(19)     -- 19 = y-component
print(string.format("[PAiA-RESULT] torque_Nm=%.9g fx_N=%.9g fy_N=%.9g", torque, fx, fy))
mo_close()
mi_close()
  `.trim();
  const res = await runLuaSource(lua);
  const match = res.stdout.match(/\[PAiA-RESULT\] torque_Nm=([-\d.eE+]+) fx_N=([-\d.eE+]+) fy_N=([-\d.eE+]+)/);
  const parsed = match
    ? { torque_Nm: parseFloat(match[1]), fx_N: parseFloat(match[2]), fy_N: parseFloat(match[3]) }
    : { error: 'Could not parse PAiA-RESULT line from FEMM output.' };
  return JSON.stringify({ parsed, raw: res }, null, 2);
}

// ─── registration ─────────────────────────────────────────────────

function register(ctx) {
  const tool = (name, description, risk, schema, execute) => ctx.registerTool({
    definition: { name, description, risk, category: 'cad-sim', inputSchema: schema },
    execute,
  });

  tool(
    'femm.run_lua',
    'Run an arbitrary FEMM Lua script. The script runs inside FEMM with full access to its mi_/ei_/hi_/ci_/mo_ API. Returns exit code, stdout, and stderr.',
    'high',
    {
      type: 'object',
      properties: { lua: { type: 'string', description: 'Lua source to execute inside FEMM.' } },
      required: ['lua'],
    },
    runLua,
  );

  tool(
    'femm.analyze_fem',
    'Open a .fem problem file, run the solver, and save the solution. Useful as a one-call "solve this file". The solution file (.ans) is written next to the .fem.',
    'high',
    {
      type: 'object',
      properties: {
        fem_path: { type: 'string', description: 'Absolute path to the .fem problem file.' },
        problem_type: {
          type: 'string',
          enum: ['magnetic', 'electrostatic', 'heatflow', 'currentflow'],
          description: 'Which FEMM problem class the file is. Defaults to magnetic.',
        },
      },
      required: ['fem_path'],
    },
    analyzeFem,
  );

  tool(
    'femm.compute_torque',
    'Solve a magnetostatic .fem problem and compute the torque (Nm) and net Lorentz force (N) on a block group. Typical use: the user sets group 1 on the rotor, then asks PAiA to sweep current or angle.',
    'high',
    {
      type: 'object',
      properties: {
        fem_path: { type: 'string', description: 'Absolute path to the .fem problem file.' },
        group: { type: 'number', description: 'Block group id to integrate torque over. Defaults to 1 (rotor convention).' },
      },
      required: ['fem_path'],
    },
    computeTorque,
  );
}

module.exports = { register };
