# FEMM plugin for PAiA

Drives [FEMM](https://www.femm.info) (David Meeker's Finite Element Method
Magnetics) from the Agent so the model can set up, solve, and post-process
magnetostatic / heat-flow / electrostatic / current-flow problems.

Intended for:
- Electric-motor design (BLDC / PMSM / SRM / induction) — flux paths,
  cogging torque, back-EMF, loss maps.
- Actuators, solenoids, magnetic bearings, magnetic couplings.
- Transformer and inductor design.
- Magnetic shielding studies.

## Install

1. Install FEMM 4.2 from <https://www.femm.info>. Windows is first-class;
   Linux/macOS works via Wine.
2. Copy this folder to `<paia userData>/plugins/femm/`.
   - Windows: `%APPDATA%\PAiA\plugins\femm\`
   - macOS: `~/Library/Application Support/PAiA/plugins/femm/`
   - Linux: `~/.config/PAiA/plugins/femm/`
3. Create `config.json` alongside `index.js`:

```json
{
  "femmExe": "C:\\femm42\\bin\\femm.exe",
  "scriptDir": "C:\\temp\\paia-femm",
  "timeoutMs": 300000
}
```

4. Enable the plugin in **Settings → Plugins**.

## Tools exposed to the Agent

| Tool | Risk | What it does |
|---|---|---|
| `femm.run_lua` | high | Runs any Lua script inside FEMM. Full `mi_*` / `mo_*` / etc. surface. |
| `femm.analyze_fem` | high | Opens a `.fem` file, runs the solver, saves `.ans`. |
| `femm.compute_torque` | high | Solves + returns `{ torque_Nm, fx_N, fy_N }` for a block group. |

All three are classified **high** risk because they can read and write
files from your disk via FEMM's Lua API. Autonomy gating will prompt you
before first execution unless you've set the persona's autonomy to
`auto-high`.

## Example usage from the Agent

```
User: "Using FEMM, compute the cogging torque of the motor in
       D:\designs\pmsm-v2.fem over one electrical period, in 5°
       steps. Plot torque vs. angle."

Agent (planner):
  1. femm.run_lua — loop over angle, rotate rotor group (1), solve, read torque
  2. Plot the array with a Mermaid or inline math table

Agent (tool call): femm.run_lua({
  lua: [the generated sweep script]
})
→ returns stdout with "[PAiA-RESULT] angle_deg=... torque_Nm=..." lines

Agent (final): reformats into a table + a quick peak-to-peak summary.
```

## Security notes

- The plugin spawns `femm.exe` with `windowsHide: true` and `-windowhide`
  so no GUI pops up. Output is captured on stdout/stderr and capped at
  100 KB to protect the model's context window.
- There's a 5-minute default timeout on the solver (configurable). The
  spawned process is SIGKILLed on timeout.
- Temporary Lua scripts are written to `scriptDir` with a random suffix
  and deleted after the run.
- The script source is **not sanitized** — it's executed verbatim by
  FEMM's Lua interpreter. Treat it exactly like you would any agent tool
  that runs code on your machine: review the autonomy prompt before
  approving.

## Adjacent plugins to consider

If this is useful, the same pattern wraps:
- **LTspice** (`LTspice.exe -b <.cir>`)
- **FreeCAD / Fusion360** (Python API)
- **KiCad** (`kicad-cli`)
- **OpenModelica** (`omc <.mos>`)
- **Ansys/Maxwell** (IronPython scripting)

Adapt this `index.js` as a template.
