# PAiA v1.0 — Technical Architecture

## The Evolution: From OCR Tool to Screen Intelligence Platform

### Before (v0.x — OCR-only):
```
Screenshot → OCR → Regex redact → Send text to LLM → Response
```
**Problems**: Misses layout, can't see icons, no control types, bad with 
non-text content, regex misses contextual PII, no structured data.

### After (v1.0 — Multi-Signal Intelligence):
```
Screenshot → [4 Parallel Signals] → Fusion → Multi-Layer Redaction → LLM
                │
                ├─ Signal 1: OCR (text from pixels — universal fallback)
                ├─ Signal 2: UI Automation (structured controls from accessibility API)
                ├─ Signal 3: Vision Model (visual understanding via multimodal LLM)
                └─ Signal 4: Active Window (app name, process, URL, file path)
                                │
                                ▼
                        Signal Fusion
                        (combine all signals into rich context)
                                │
                                ▼
                    Multi-Layer Redaction
                        ├─ Layer 1: Custom rules (company-specific)
                        ├─ Layer 2: Regex patterns (SSN, cards, emails...)
                        └─ Layer 3: NER engine (names, addresses, medical...)
                                │
                                ▼
                    Smart Context Detection
                        (14 built-in types + plugins)
                                │
                                ▼
                    LLM with full context
                        (via SecureOllamaClient)
```

## Service Architecture (28 services)

### Screen Intelligence (NEW — the fundamental upgrade)
| Service | Purpose |
|---------|---------|
| `ScreenIntelPipeline` | Orchestrates all 4 signals into unified analysis |
| `UIAutomationService` | Extracts structured UI tree via Windows Accessibility API |
| `VisionService` | Sends screenshots to vision-capable LLMs (qwen-vl, llava) |
| `NerService` | Named Entity Recognition for contextual PII (names, addresses) |
| `ActiveWindowMonitor` | Tracks foreground app for proactive context (opt-in) |
| `PluginManager` | Extensible plugin system for custom contexts and actions |

### Core Services
| Service | Purpose |
|---------|---------|
| `ScreenCaptureService` | User-consented capture via GraphicsCapturePicker |
| `OcrService` | Windows OCR API wrapper |
| `OllamaClient` | Local LLM communication (chat + streaming) |
| `SecureOllamaClient` | Privacy-enforced LLM wrapper (endpoint validation + double-redact) |
| `ChatService` | Multi-turn conversation with screen context |
| `SmartContextService` | Detects 14 context types with heuristics |
| `OllamaBootstrapper` | Auto-detect, auto-start Ollama on app launch |
| `ModelRecommender` | Hardware detection + model recommendations |

### Privacy & Security
| Service | Purpose |
|---------|---------|
| `PrivacyGuard` | Central enforcement: network isolation, image leak detection |
| `RedactionService` | Compiled regex PII scrubber (11 pattern types) |
| `CustomRedactionRules` | User-defined redaction patterns |
| `ConsentManager` | First-run consent, versioned terms, one-click revoke |
| `MemorySafeBitmap` | RAM-only screenshots with 30s auto-expire |
| `SensitiveAppFilter` | Warns before processing banking/password apps |
| `RedactionDiffView` | Shows exactly what was redacted |
| `DataWiper` | Secure deletion with zero-overwrite |

### SecurityLab (self-testing immune system)
| Service | Purpose |
|---------|---------|
| `ThreatKnowledgeBase` | 18+ cataloged threats from real CVEs |
| `AttackSimulator` | 50+ automated security tests + mutation engine |
| `HardeningEngine` | Auto-applies fixes, generates recommendations |
| `RuntimeSecurityMonitor` | Continuous background security checks |
| `SecurityLabOrchestrator` | Ties it all together with health score |

### UX
| Service | Purpose |
|---------|---------|
| `GlobalHotkeyService` | Ctrl+Shift+P capture from anywhere |
| `SmartClipboardQueue` | Multi-copy queue for code blocks |
| `ResponseHistory` | Searchable, bookmarkable past responses |
| `LivePrivacyPulse` | Always-visible privacy status bar |
| `SystemTrayService` | Minimize to tray, context menu |
| `PinOverlay` | Always-on-top response window |

## Why Each Signal Matters

### Signal 1: OCR
- **Works on**: Everything — any pixel on screen
- **Good at**: Reading text in any app, any language
- **Bad at**: Understanding layout, control types, disabled states
- **Fallback**: Never fails (worst case: returns empty string)

### Signal 2: UI Automation
- **Works on**: Native Windows apps (WPF, WinForms, UWP, WinUI)
- **Good at**: Exact control types, values, states, hierarchy
- **Bad at**: Games, remote desktop, custom-rendered UIs, some Electron apps
- **Fallback**: OCR covers what UIA misses

### Signal 3: Vision Model
- **Works on**: Everything visual
- **Good at**: Layout understanding, charts, icons, error states, visual context
- **Bad at**: Requires a vision model installed (optional)
- **Fallback**: Pipeline works without it — OCR + UIA still provide context

### Signal 4: Active Window
- **Works on**: Always (just reads window title + process name)
- **Good at**: App identification, URL extraction from browsers, file paths
- **Bad at**: Nothing — it's always available
- **Privacy**: Only reads what's visible in the taskbar

## Redaction: Three Layers Deep

### Layer 1: Custom Rules (user-defined)
- Company project names, internal IPs, employee names
- JIRA tickets, Slack channels, internal URLs
- Applied first so user patterns take priority

### Layer 2: Regex Patterns (built-in)
- Credit cards, SSNs, emails, phones, IPs
- AWS keys, GitHub tokens, JWTs, API keys
- Private keys, connection strings
- 11 compiled regex patterns, runs in microseconds

### Layer 3: NER Engine (contextual)
- Person names after "from:", "employee:", "Dr."
- Street addresses
- Financial figures in context ("salary: $85k")
- Medical terms after "diagnosis:", "medication:"
- Dates of birth
- Catches what regex structurally cannot

## Plugin System

Plugins are JSON files in `%LOCALAPPDATA%\PAiA\Plugins\`. Example:

```json
{
  "name": "JIRA Helper",
  "detectionKeywords": ["jira", "sprint", "backlog", "story points"],
  "minKeywordMatches": 2,
  "systemPrompt": "You are a JIRA project management assistant...",
  "quickActions": [
    { "label": "Summarize ticket", "prompt": "Summarize this JIRA ticket..." },
    { "label": "Write acceptance criteria", "prompt": "Write AC for..." }
  ],
  "redactionPatterns": [
    { "name": "JIRA Tickets", "pattern": "\\b[A-Z]{2,10}-\\d{1,6}\\b", "isRegex": true }
  ]
}
```

No code changes needed. Drop a JSON file, restart PAiA, done.
