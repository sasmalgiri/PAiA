// PAiA reference plugin — Home Assistant.
//
// Registers a family of `home.*` tools the Agent can call. HA speaks a
// simple REST API authenticated with a Long-Lived Access Token, so
// everything here is plain fetch() with no extra dependencies.
//
// Setup (one-time, per user):
//   1. In HA: Profile → Long-Lived Access Tokens → Create. Copy the token.
//   2. Drop this plugin folder into `<paia userData>/plugins/home-assistant/`.
//   3. Create `<paia userData>/plugins/home-assistant/config.json` with:
//        { "baseUrl": "http://homeassistant.local:8123", "token": "<long-lived-token>" }
//   4. Enable the plugin in Settings → Plugins.
//
// Safety notes:
//   - Every tool is marked at its proper risk tier. Lighting is 'low';
//     service-calls and locks are 'high'. Agent autonomy settings apply.
//   - Classroom policy's allowAgent gate still wraps everything; a
//     locked-down student won't accidentally unlock the front door via
//     PAiA.
//   - The plugin does NOT hold the token in memory any longer than
//     necessary — each call reads from disk so rotating the token works
//     without restart.

const fs = require('node:fs');
const path = require('node:path');

function configPath() {
  return path.join(__dirname, 'config.json');
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(configPath(), 'utf-8');
    const cfg = JSON.parse(raw);
    if (!cfg.baseUrl || !cfg.token) throw new Error('config.json must include baseUrl and token');
    return cfg;
  } catch (err) {
    throw new Error(
      `home-assistant plugin: cannot read config.json at ${configPath()} — ${err.message}. ` +
      `Create it with { "baseUrl": "http://homeassistant.local:8123", "token": "<long-lived-token>" }`,
    );
  }
}

async function haFetch(pathAndQuery, init = {}) {
  const cfg = loadConfig();
  const url = `${cfg.baseUrl.replace(/\/$/, '')}${pathAndQuery}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HA ${init.method ?? 'GET'} ${pathAndQuery} → HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  const ctype = res.headers.get('content-type') || '';
  return ctype.includes('application/json') ? res.json() : res.text();
}

function asString(v, name) {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Missing string argument "${name}"`);
  return v;
}

// ─── tool implementations ─────────────────────────────────────────

async function listEntities(args) {
  const domain = typeof args.domain === 'string' ? args.domain : '';
  const states = await haFetch('/api/states');
  const filtered = states
    .filter((s) => !domain || s.entity_id.startsWith(domain + '.'))
    .map((s) => ({
      entity_id: s.entity_id,
      state: s.state,
      friendly_name: (s.attributes && s.attributes.friendly_name) ?? s.entity_id,
      area: (s.attributes && s.attributes.area_id) ?? null,
    }));
  return JSON.stringify(filtered.slice(0, 200), null, 2);
}

async function getState(args) {
  const id = asString(args.entity_id, 'entity_id');
  const s = await haFetch(`/api/states/${encodeURIComponent(id)}`);
  return JSON.stringify(
    { entity_id: s.entity_id, state: s.state, attributes: s.attributes },
    null, 2,
  );
}

async function callService(args) {
  const domain = asString(args.domain, 'domain');
  const service = asString(args.service, 'service');
  const data = typeof args.data === 'object' && args.data !== null ? args.data : {};
  const result = await haFetch(`/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return JSON.stringify(result, null, 2);
}

async function turnOn(args) {
  const id = asString(args.entity_id, 'entity_id');
  const domain = id.split('.')[0];
  return callService({ domain, service: 'turn_on', data: { entity_id: id, ...(args.extra ?? {}) } });
}

async function turnOff(args) {
  const id = asString(args.entity_id, 'entity_id');
  const domain = id.split('.')[0];
  return callService({ domain, service: 'turn_off', data: { entity_id: id } });
}

async function toggle(args) {
  const id = asString(args.entity_id, 'entity_id');
  const domain = id.split('.')[0];
  return callService({ domain, service: 'toggle', data: { entity_id: id } });
}

async function setBrightness(args) {
  const id = asString(args.entity_id, 'entity_id');
  const pct = typeof args.brightness_pct === 'number' ? args.brightness_pct : 50;
  return callService({ domain: 'light', service: 'turn_on', data: { entity_id: id, brightness_pct: Math.max(0, Math.min(100, pct)) } });
}

async function setTemperature(args) {
  const id = asString(args.entity_id, 'entity_id');
  const t = typeof args.temperature === 'number' ? args.temperature : 21;
  return callService({ domain: 'climate', service: 'set_temperature', data: { entity_id: id, temperature: t } });
}

async function runAutomation(args) {
  const id = asString(args.automation_id, 'automation_id');
  return callService({ domain: 'automation', service: 'trigger', data: { entity_id: id } });
}

// ─── registration ─────────────────────────────────────────────────

function register(ctx) {
  const tool = (name, description, risk, schema, execute) => ctx.registerTool({
    definition: { name, description, risk, category: 'connector', inputSchema: schema },
    execute,
  });

  tool(
    'home.listEntities',
    'List Home Assistant entities. Optional `domain` filters by entity domain (light, switch, sensor, climate, lock, cover, media_player, …).',
    'safe',
    { type: 'object', properties: { domain: { type: 'string' } } },
    listEntities,
  );

  tool(
    'home.getState',
    'Read the current state + attributes of a Home Assistant entity.',
    'safe',
    { type: 'object', properties: { entity_id: { type: 'string' } }, required: ['entity_id'] },
    getState,
  );

  tool(
    'home.turnOn',
    'Turn an entity on (lights, switches, scenes, scripts, etc).',
    'low',
    { type: 'object', properties: { entity_id: { type: 'string' }, extra: { type: 'object' } }, required: ['entity_id'] },
    turnOn,
  );

  tool(
    'home.turnOff',
    'Turn an entity off.',
    'low',
    { type: 'object', properties: { entity_id: { type: 'string' } }, required: ['entity_id'] },
    turnOff,
  );

  tool(
    'home.toggle',
    'Toggle an entity between on and off.',
    'low',
    { type: 'object', properties: { entity_id: { type: 'string' } }, required: ['entity_id'] },
    toggle,
  );

  tool(
    'home.setBrightness',
    'Set a light\'s brightness by percentage (0-100).',
    'low',
    { type: 'object', properties: { entity_id: { type: 'string' }, brightness_pct: { type: 'number' } }, required: ['entity_id', 'brightness_pct'] },
    setBrightness,
  );

  tool(
    'home.setTemperature',
    'Set a thermostat target temperature.',
    'medium',
    { type: 'object', properties: { entity_id: { type: 'string' }, temperature: { type: 'number' } }, required: ['entity_id', 'temperature'] },
    setTemperature,
  );

  tool(
    'home.callService',
    'Call any Home Assistant service. Escape hatch for domains / services not covered by the dedicated tools (locks, covers, media players, custom integrations).',
    'high',
    {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'e.g. light, switch, lock, cover, climate' },
        service: { type: 'string', description: 'e.g. turn_on, lock, set_cover_position' },
        data: { type: 'object', description: 'Service data, including entity_id' },
      },
      required: ['domain', 'service'],
    },
    callService,
  );

  tool(
    'home.runAutomation',
    'Trigger an existing Home Assistant automation by its entity id.',
    'medium',
    { type: 'object', properties: { automation_id: { type: 'string' } }, required: ['automation_id'] },
    runAutomation,
  );

  ctx.log('Home Assistant plugin registered — 9 tools');
}

module.exports = { register };
