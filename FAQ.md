# PAiA — Frequently Asked Questions

## Will PAiA work without a GPU?

**Yes, but it will be slow.** Here's the honest breakdown:

| Setup | Speed | Experience |
|-------|-------|------------|
| **NVIDIA RTX 3060+ GPU** | 40-80 tok/s | Excellent — feels instant |
| **AMD RX 6000+ GPU** | 30-60 tok/s | Great — very usable |
| **Apple M-series (Mac)** | 20-50 tok/s | Good — PAiA is Windows-only though |
| **CPU only (modern i7/Ryzen)** | 5-15 tok/s | Usable with small models |
| **CPU only (older i5/Ryzen 5)** | 2-8 tok/s | Painful — long waits |
| **CPU only (4 cores or less)** | 1-3 tok/s | Barely functional |

### What "CPU-only" actually means:
- Ollama automatically falls back to CPU when no GPU is detected
- You don't need to configure anything — it just works, slowly
- Use smaller models: `phi4-mini` (3.8B) or `gemma3:1b` (1B) or `qwen3:0.6b`
- Expect 5-15 seconds for a short answer, 30-60 seconds for a detailed one
- Screen capture and OCR are unaffected (they don't use the GPU)
- Only the AI response generation is slow

### Recommended models for CPU-only:

```powershell
# Best quality you can get on CPU (3.8B params, ~3GB RAM)
ollama pull phi4-mini

# Faster but less capable (1B params, ~1.5GB RAM)
ollama pull gemma3:1b

# Absolute minimum — runs on anything (0.6B params, ~1GB RAM)
ollama pull qwen3:0.6b
```

### Tips to make CPU-only faster:
1. Close other apps to free RAM
2. Use the smallest model that gives acceptable answers
3. Keep your questions short and specific
4. Don't use models larger than 7B on CPU — they'll be unusable

---

## Will PAiA work on mobile?

**No.** PAiA is a **Windows desktop application only**. Here's why:

### Technical reasons:
- PAiA uses **WinUI 3** — Microsoft's Windows-only UI framework
- Screen capture uses **Windows Graphics Capture API** — no equivalent on mobile
- OCR uses **Windows.Media.Ocr** — a Windows-specific API
- The app requires **Direct3D11** interop for screen capture
- Ollama (the AI engine) doesn't run on mobile devices

### Could PAiA work on mobile in the future?

Theoretically, a different product could serve mobile:
- **Android**: Would need a completely different tech stack (Kotlin/Jetpack Compose), a mobile-friendly AI engine (like MLC-LLM or llama.cpp compiled for ARM), and would use Android's screenshot/accessibility APIs instead
- **iOS**: Same — Swift/SwiftUI, Core ML for inference, iOS screenshot APIs
- **Both**: Would be entirely separate codebases, not ports of the Windows app

The fundamental challenge on mobile is running the AI model. Even small models (1-3B) need 1-4 GB of RAM and significant CPU power. Modern phones have this, but battery drain and thermal throttling make it impractical for frequent use.

### What you CAN do on mobile:
- Use cloud-based AI assistants (ChatGPT, Claude, etc.) with screenshots
- These send your data to the cloud though — PAiA's entire point is avoiding that

---

## What are the minimum system requirements?

### Minimum (CPU-only, basic usage):
- Windows 10 version 1903+ or Windows 11
- 8 GB RAM
- Any modern x64 CPU (Intel i5/AMD Ryzen 5 or better)
- 2 GB free disk space (for app + one small model)
- No GPU required

### Recommended (smooth experience):
- Windows 11
- 16 GB RAM
- NVIDIA GTX 1650 / RTX 3060 or AMD RX 6600 (8GB+ VRAM)
- 10 GB free disk space
- .NET 8 SDK

### Optimal (best quality):
- Windows 11
- 32 GB RAM
- NVIDIA RTX 3090 / RTX 4090 (24GB VRAM) or AMD RX 7900 XTX
- 30 GB free disk space (for multiple models)

---

## Which model should I use?

PAiA includes a **Model Recommender** that auto-detects your hardware on first launch and suggests the best model. But here's the quick guide:

### If you have a GPU:

| Your VRAM | Best Model | Pull Command |
|-----------|-----------|--------------|
| 24 GB+ | Qwen 3.5 27B | `ollama pull qwen3.5:27b` |
| 16 GB | Qwen 3.5 9B | `ollama pull qwen3.5:9b` |
| 8 GB | Qwen 3 7B | `ollama pull qwen3:7b` |
| 4-6 GB | Phi-4 Mini | `ollama pull phi4-mini` |

### If you DON'T have a GPU:

| Your RAM | Best Model | Pull Command |
|----------|-----------|--------------|
| 16 GB+ | Qwen 3 7B (slow but smart) | `ollama pull qwen3:7b` |
| 8 GB | Phi-4 Mini (usable speed) | `ollama pull phi4-mini` |
| 4-8 GB | Gemma 3 1B (fast, basic) | `ollama pull gemma3:1b` |

### For specific tasks:

| Task | Best Model |
|------|-----------|
| Code / debugging | `qwen2.5-coder:14b` |
| Deep reasoning | `deepseek-r1:14b` |
| Email / writing | `qwen3.5:27b` or `llama4:8b` |
| Quick answers | `phi4-mini` or `gpt-oss:20b` |
| Forms / data | `qwen3:14b` |

### Can I use multiple models?
Yes! Install several and switch from the dropdown in PAiA:
```powershell
ollama pull qwen3.5:9b          # General use
ollama pull qwen2.5-coder:14b   # When working with code
ollama pull phi4-mini            # Quick questions
```

PAiA auto-detects all installed models and lists them in the model picker.

---

## What platforms does PAiA support?

| Platform | Supported | Notes |
|----------|-----------|-------|
| Windows 10 (1903+) | ✅ Yes | Full support |
| Windows 11 | ✅ Yes | Full support (recommended) |
| macOS | ❌ No | Would need different framework (SwiftUI) |
| Linux | ❌ No | Would need different framework (GTK/Qt) |
| Android | ❌ No | Completely different tech stack needed |
| iOS | ❌ No | Completely different tech stack needed |
| Web browser | ❌ No | PAiA needs OS-level screen capture APIs |

PAiA is Windows-only because it deeply integrates with Windows APIs for screen capture (GraphicsCapturePicker), OCR (Windows.Media.Ocr), and the UI framework (WinUI 3). These don't exist on other platforms.

---

## Is my data safe?

See [PRIVACY.md](PRIVACY.md) for the full architecture. Short answer:
- Everything runs locally — nothing leaves your machine
- PII is auto-redacted before the AI sees it
- Screenshots exist only in RAM (never on disk)
- You can delete all data at any time
- SecurityLab continuously tests the defenses
