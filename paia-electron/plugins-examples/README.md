# PAiA plugin examples

Reference plugins that demonstrate the Plugin SDK (`src/main/plugins.ts`).
Copy any of these into `<userData>/plugins/<id>/`, then enable them
from Settings → Plugins.

## Index

| Folder | Gives the Agent | Notes |
|---|---|---|
| [home-assistant/](home-assistant/) | Smart-home control (lights, climate, locks, scenes, any HA service) | Bridges HomeKit / Matter / Zigbee / Z-Wave via HA |

## Writing your own

See [home-assistant/index.js](home-assistant/index.js) as a minimal
template. A plugin is:

1. A directory with `paia-plugin.json` declaring your id / name / main entry.
2. An `index.js` that exports `register(context)`.

Inside `register`, the three hooks you can contribute to are:

- `context.registerTool(handler)` — adds an Agent tool.
- `context.registerAmbientTrigger(name, fn)` — fires on every ambient
  tick; return a `AmbientSuggestion` or `null`.
- `context.registerSlashCommand({ name, description, handler })` — shows
  up in the composer popup.

Plugins run in the main process with full Node capabilities. Only
enable plugins you trust.
