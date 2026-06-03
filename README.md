<div align="center">

# PAiA

### A floating ball that lives in your screen corner. Click it to chat, talk, capture your screen — all locally.

**Privacy-first AI desktop assistant. Cross-platform. Built for the long haul.**

[Website](https://paia.app) · [Download](https://paia.app/download.html) · [Pricing](https://paia.app/pricing.html) · [Docs](https://paia.app/docs.html) · [Changelog](https://paia.app/changelog.html)

</div>

---

## Quick orientation

This repository contains **two products** that share a name. If you're new here, you almost certainly want the second one:

| | What it is | Status | Where it lives |
|---|---|---|---|
| **PAiA WinUI** | The original Windows-only prototype, .NET 8 + WinUI 3 | **Legacy** — kept for reference, no longer the active project | [`PAiA.WinUI/`](PAiA.WinUI/), [`PAiA.Tests/`](PAiA.Tests/), [`PAiA.sln`](PAiA.sln), [`README.legacy.md`](README.legacy.md) |
| **PAiA Electron** | The current cross-platform product. Electron 33 + React 18 + sql.js. Ships on Windows, macOS, and Linux. | **Active** — this is what's on the website. | [`paia-electron/`](paia-electron/) |

The Electron version is a complete rewrite that incorporates everything from the WinUI prototype (the redaction engine, the privacy posture, the screen-intel ideas) plus a much wider feature set (RAG, MCP, vision, voice, multi-thread chat, cloud opt-in, license + trial system).

**If you're shipping the product:** work in `paia-electron/`. Read [paia-electron/README.md](paia-electron/README.md) and [paia-electron/OPERATIONS.md](paia-electron/OPERATIONS.md).

**If you're researching how it used to work:** the WinUI prototype is preserved in [PAiA.WinUI/](PAiA.WinUI/) and documented in [README.legacy.md](README.legacy.md).

## What PAiA actually is (the active version)

PAiA is a small floating ball that lives in your screen corner. Click it for the chat panel. Talk to it, type to it, drop files on it, point it at your screen.

- **Local by default.** Your conversations, voice, screen captures, and documents stay on your machine. No telemetry, no analytics, no crash reports unless you opt in.
- **Hardware-aware Model Store** — detects your RAM/CPU/GPU and recommends models sized for your machine (Lightweight / Comfortable / Strong / MoE-class). >10 GB downloads are gated behind a confirm.
- **Mixture of Experts** — every persona in the 56-strong pool can be bound to its own knowledge stack. A two-stage router (semantic pre-filter + LLM rerank) picks the best 1–N for each query.
- **Council mode** — `/council <question>` or auto-route fires parallel expert calls and streams a synthesised reply that flags disagreements.
- **Long-read map-reduce** — `/longread <question>` on an attached PDF processes chunks in parallel waves and synthesises with chunk-level provenance.
- **Cloud escalation** — when the router classifies a query as hard for your local model, an inline banner offers one-click promotion to a configured cloud model (PII still redacted locally first).
- **Multi-thread chat** with sql.js persistence, markdown rendering, syntax highlighting.
- **Voice in and out** — offline Whisper STT, system or neural Piper TTS, optional wake word.
- **Screen awareness** — full-screen capture, drag-region capture, local Tesseract OCR, vision-model integration.
- **RAG knowledge stacks** — drop PDFs / Markdown / code, get cited answers from your own documents.
- **MCP tool servers** with explicit per-call approval.
- **Cloud providers** (OpenAI, Anthropic, OpenAI-compatible) gated by an explicit opt-in.
- **PII redaction** — 11 categories scrubbed before any prompt leaves the renderer.
- **Observability inspector** — every assistant message has a 🔍 pane showing per-phase timing, RAG citations, persona/model used, and redaction count. Local-only; opt-out in Settings → Privacy.
- **Accessibility** — focus trap on every modal, `forced-colors` (High Contrast) coverage, `prefers-reduced-motion`, documented keyboard contract in [paia-electron/ACCESSIBILITY.md](paia-electron/ACCESSIBILITY.md).

## Getting started (active version)

```bash
# Run from source
cd paia-electron
npm install
npm run dev
```

A small glowing ball appears in your screen corner. Click it.

On first launch, onboarding probes your hardware and recommends a model sized for it — install with one click. If you'd rather pick a model yourself, the existing presets are behind the "Or pick a fixed starter preset" expander in step 2 of onboarding.

For parallel council / long-read speed, set `OLLAMA_NUM_PARALLEL=4` on Ollama before launching. Settings → Personas surfaces the platform-specific command when the smart router is enabled.

For installer downloads (when available): [paia.app/download.html](https://paia.app/download.html)

For the developer / operator playbook (how to ship this thing):
- [paia-electron/README.md](paia-electron/README.md) — full feature reference, architecture
- [paia-electron/OPERATIONS.md](paia-electron/OPERATIONS.md) — phased launch checklist
- [paia-electron/DISTRIBUTION.md](paia-electron/DISTRIBUTION.md) — code signing, license keys, payments
- [paia-electron/ROADMAP.md](paia-electron/ROADMAP.md) — what's done, what's next
- [paia-electron/CHANGELOG.md](paia-electron/CHANGELOG.md) — release notes
- [paia-electron/SUPPORT.md](paia-electron/SUPPORT.md) — customer support runbook

## Repository layout

See [REPO_LAYOUT.md](REPO_LAYOUT.md) for a complete map of every directory and what it does.

## License

The active Electron product (`paia-electron/`) is **proprietary** with a [generous EULA](paia-electron/LICENSE) — free for personal use, paid Pro tier for commercial features.

The legacy WinUI prototype (`PAiA.WinUI/`) is **MIT-licensed** for historical reasons. See [LICENSE](LICENSE) and [README.legacy.md](README.legacy.md).

The shared redaction library (under [paia-electron/src/shared/redaction.ts](paia-electron/src/shared/redaction.ts)) may be open-sourced separately under MIT in a future release.
