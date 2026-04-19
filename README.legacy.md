<div align="center">

# PAiA

### Privacy-first AI screen assistant for Windows

**Your screen. Your AI. Your machine.**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Windows](https://img.shields.io/badge/Platform-Windows%2010%2F11-blue.svg)]()
[![.NET 8](https://img.shields.io/badge/.NET-8.0-purple.svg)]()
[![Ollama](https://img.shields.io/badge/AI-Ollama%20(Local)-orange.svg)](https://ollama.com)

**On-demand AI screen assistant that captures only when you ask,**
**processes everything locally, and never sends a byte to the cloud.**

[Download](https://github.com/sasmalgiri/PAiA/releases) · [Getting Started](GETTING_STARTED.md) · [Architecture](ARCHITECTURE.md) · [FAQ](FAQ.md)

</div>

---

## What is PAiA?

PAiA is a Windows desktop app that helps you with anything on your screen — code errors, form filling, email drafting, debugging, spreadsheets — using AI that runs entirely on your machine via [Ollama](https://ollama.com).

Press **Ctrl+Shift+P** from anywhere → select a window → get instant AI help. That's it.

**Zero cloud. Zero background monitoring. Zero data collection.**

## Why PAiA?

Microsoft's Recall screenshots everything 24/7 and stores it in a database. Copilot sends your data to the cloud. Users pushed back hard — and Microsoft is now [retreating from these features](https://techcrunch.com/2026/03/20/microsoft-rolls-back-some-of-its-copilot-ai-bloat-on-windows/).

PAiA is the opposite:

| | Microsoft Recall | Copilot | **PAiA** |
|---|---|---|---|
| **Captures** | Every few seconds, always | On interaction | **Only when you click** |
| **Data goes to** | Local database | Microsoft cloud | **RAM only, 30s auto-delete** |
| **Can disable?** | Complicated | Registry hacks | **One-click delete all** |
| **Open source** | No | No | **Yes (MIT)** |
| **Needs special HW** | NPU / Copilot+ PC | Internet | **Any Windows PC** |
| **PII protection** | Opt-in exclusion list | None | **3-layer auto-redaction** |

## Features

**Screen Intelligence** — 4 signals working together:
- **OCR** reads text from any screen
- **UI Automation** reads actual control types, states, values via Windows Accessibility API
- **Vision model** understands layout, charts, icons (if qwen-vl/llava installed)
- **Active window** knows the app, process, and browser URL

**3-Layer PII Redaction** — before AI sees anything:
- Custom rules (your company patterns — project names, ticket IDs)
- Regex patterns (credit cards, SSNs, emails, API keys, JWTs, private keys)
- NER engine (person names, addresses, medical terms, financial figures)

**14 Context Types** — auto-detected with context-specific quick actions:
Code · Terminal · Error · Form · Browser · Email · Settings · Installer · Spreadsheet · Document · Chat · Image · Video · General

**SecurityLab** — self-testing immune system:
- 18+ cataloged threats from real CVEs
- 50+ automated attack simulations
- Auto-hardening engine with real-time monitoring

**Desktop App:**
- System tray with minimize-to-tray
- Global hotkey (Ctrl+Shift+P)
- Smart clipboard queue (code blocks auto-queue)
- Searchable response history with bookmarks
- Pin response as always-on-top window
- JSON plugin system (extensible without code changes)
- Form helper overlay
- Hardware-aware model recommender
- Ollama auto-detection and auto-start

## Quick Start

```powershell
# 1. Install Ollama
winget install Ollama

# 2. Pull a model
ollama pull qwen3.5:9b

# 3. Download PAiA from Releases, extract, and run
paia.exe
```

See [GETTING_STARTED.md](GETTING_STARTED.md) for the full guide.

## Hardware Guide

| Setup | Model | Speed |
|-------|-------|-------|
| **24GB+ VRAM** | `qwen3.5:27b` | Excellent — rivals cloud AI |
| **16GB RAM + GPU** | `qwen3.5:9b` | Great — fast and smart |
| **8GB RAM + GPU** | `qwen3:7b` | Good — responsive |
| **CPU only** | `phi4-mini` | Usable — slower but works |

No GPU? PAiA still works. See [FAQ.md](FAQ.md#will-paia-work-without-a-gpu).

## Building from Source

```powershell
git clone https://github.com/sasmalgiri/PAiA.git
cd PAiA
dotnet restore
dotnet build --configuration Release
dotnet run --project PAiA.WinUI

# Run tests (120 test methods)
dotnet test PAiA.Tests
```

Requires: Visual Studio 2022, .NET 8 SDK, WinUI 3 workload.

## Privacy Architecture

```
Capture (user-initiated only)
    → SensitiveAppFilter (warns for banking/password apps)
    → GraphicsCapturePicker (OS-level consent)
    → MemorySafeBitmap (RAM only, 30s auto-expire)
    → ScreenIntelPipeline (OCR + UIAutomation + Vision + ActiveWindow)
    → 3-Layer Redaction (custom → regex → NER)
    → SecureOllamaClient (localhost-only, double-redacted)
    → Response (clipboard queue → history → audit log)
```

See [ARCHITECTURE.md](ARCHITECTURE.md) and [PRIVACY.md](PRIVACY.md) for details.

## Contributing

PRs welcome. Please read [ARCHITECTURE.md](ARCHITECTURE.md) first.

## License

[MIT](LICENSE) — use it however you want.
