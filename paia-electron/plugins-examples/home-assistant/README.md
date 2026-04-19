# PAiA plugin — Home Assistant

A reference plugin that lets the Agent control anything exposed through
your Home Assistant instance: lights, switches, sensors, thermostats,
locks, media players, covers, custom integrations. Because Home
Assistant already bridges **HomeKit**, **Matter**, **Zigbee**, and
**Z-Wave**, this one plugin covers virtually every smart-home device
you might want to drive from PAiA.

## What the Agent gains

After enabling this plugin, the Agent can reason about and call:

| Tool | Risk | Typical use |
|---|---|---|
| `home.listEntities` | safe | "what lights do I have?" |
| `home.getState` | safe | "is the front door locked?" |
| `home.turnOn` / `home.turnOff` | low | "turn on the bedroom lamp" |
| `home.toggle` | low | "flip the porch light" |
| `home.setBrightness` | low | "dim the kitchen to 40%" |
| `home.setTemperature` | medium | "set the thermostat to 22" |
| `home.runAutomation` | medium | "fire the 'leaving home' automation" |
| `home.callService` | high | anything exotic (locks, covers, scene.activate) |

Each tool still goes through PAiA's autonomy + approval model — on the
default "assisted" autonomy level, `home.turnOn` auto-fires but
`home.callService` and lock operations prompt you.

## Install

### 1. Make the plugin folder

On your PAiA install:

```
<userData>/plugins/home-assistant/
  paia-plugin.json        ← copy from this repo
  index.js                ← copy from this repo
  config.json             ← you create this (see below)
```

On macOS `<userData>` is `~/Library/Application Support/paia`. On
Linux it's `~/.config/paia`. On Windows it's `%APPDATA%\paia`. The
exact path is shown in Settings → About → Data.

### 2. Create a Home Assistant long-lived access token

In your HA UI: **Profile → Long-Lived Access Tokens → Create Token**.
Copy the opaque string once — HA won't show it again.

### 3. Write `config.json`

```json
{
  "baseUrl": "http://homeassistant.local:8123",
  "token": "<paste the long-lived token here>"
}
```

Use `https://` if you've set up TLS; use the LAN IP
(`http://192.168.1.42:8123`) if the `.local` address doesn't resolve
from your desktop.

### 4. Enable in PAiA

Settings → Plugins → enable **Home Assistant**. The log will show
`plugin loaded: home-assistant (9 tools, 0 ambient, 0 slash)`.

## Try it

Ask the agent (Ctrl+K → Start agent run):

- "What lights are on?"
- "Turn the living room off."
- "Dim the bedroom lamp to 20%."
- "Set the thermostat to 21 then tell me the current temperature."
- "List every lock and its state."

Or combine with autopilot — make a rule like:

| Setting | Value |
|---|---|
| Trigger kind | URL copied to clipboard |
| Detail regex | (leave empty) |
| Action | Agent run |
| Prompt | If anyone says "I'm leaving for the day" in the clipboard, run the 'leaving_home' automation via home.runAutomation — otherwise, ignore. |

(A better use of autopilot would be a plugin-contributed ambient
trigger that fires on a specific HA event, but that's out of scope
for the reference plugin.)

## Security

- The token sits in `config.json` on your filesystem, readable only by
  your user. Treat it like an API key.
- HA tokens grant full control of your home. If you lose the machine,
  revoke the token in HA (Profile → Long-Lived Access Tokens → delete).
- `home.callService` and `home.runAutomation` are marked **high** risk.
  On PAiA's default "assisted" autonomy, the agent must get explicit
  approval for each call. Leave it at assisted unless you really want
  hands-free.

## Troubleshooting

- **"config.json must include baseUrl and token"** — create the file
  as above. The plugin reads it on every call, so you can edit it
  without restarting PAiA.
- **"HTTP 401"** — token wrong or revoked. Regenerate in HA.
- **"fetch failed"** — HA unreachable. Check the URL resolves from the
  desktop, not just from your phone; Bonjour/mDNS is flaky over some
  networks.
- **Tool doesn't show up in the agent's tool list** — verify the
  plugin is *enabled* in Settings → Plugins (scanning alone isn't
  enough). Also confirm `pluginsEnabled` at the top of Settings →
  Plugins is ticked.

## Extending

Copy this folder, change the `id` and `name` in `paia-plugin.json`,
and register tools that speak to whatever local API you care about.
Anything addressable over HTTP from the main process works. No bundle
step, no build — `index.js` is loaded by Node at runtime.

For more ambitious plugins that want to surface UI panels of their
own, watch this space: Plugin SDK v2 will expose renderer-side
contributions too.
