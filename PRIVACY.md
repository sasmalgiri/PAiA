# PAiA Privacy Architecture

## Design Principle

> **Privacy is enforced by CODE, not by policy.**
> Even if a developer makes a mistake, the runtime safety layers catch it.

---

## The 7 Privacy Guarantees

### 1. No Outbound Network Connections

**How:** `PrivacyGuard.IsAllowedEndpoint()` validates every URL before any HTTP request. Only `localhost:11434` (Ollama) is whitelisted.

**Verification:** The transparency report shows active outbound connections and any blocked attempts. Users can check this at any time from the Settings menu.

**What if it fails?** The `SecureOllamaClient` throws a `SecurityException` and refuses to send the request. The blocked attempt is logged.

### 2. No Background Monitoring

**How:** Screen capture is triggered ONLY by the user clicking "Capture Screen". This opens the Windows `GraphicsCapturePicker` — a system-level UI that requires the user to select a window or region. PAiA cannot bypass this.

**Verification:** The `PrivacyGuard` tracks total capture count. If it's higher than expected, something is wrong.

**Why GraphicsCapturePicker?** It's a Windows API that PAiA cannot control. The OS itself asks the user what to share. PAiA never sees anything the user didn't explicitly select.

### 3. No Screenshots on Disk

**How:** `MemorySafeBitmap` wraps every captured bitmap with:
- Auto-disposal after OCR completes (using `using` statement)
- 30-second maximum lifetime timeout
- Forced garbage collection on disposal
- `FindLeakedImages()` scans the data directory for any image files

**Verification:** The transparency report includes an "Image Leaks" check. If any `.png/.jpg/.bmp` files are found in the PAiA directory, the privacy score drops.

### 4. PII Redacted Before AI Processing

**How:** Two layers of redaction:
1. `RedactionService.Redact()` — primary redaction with compiled regex patterns
2. `SecureOllamaClient.EnsureRedacted()` — secondary verification before any LLM call

**Patterns detected:** Credit cards, SSNs, emails, phone numbers, IP addresses, AWS keys, GitHub tokens, API keys, JWTs, private keys, connection strings.

**What if redaction misses something?** The `SecureOllamaClient` runs `PrivacyGuard.VerifyRedaction()` as a safety net. If PII is found, it re-redacts before sending.

### 5. Explicit User Consent

**How:** `ConsentManager` enforces:
- First-run consent dialog with full disclosure
- Consent versioning (users re-prompted if terms change)
- One-click consent revocation (deletes all data)
- Consent record stored locally for audit trail

**For payment processors:** The consent record includes timestamp, consent version, and app version — proving the user opted in before any data processing.

### 6. Sensitive App Warning

**How:** `SensitiveAppFilter` checks captured window titles against known patterns (banking apps, password managers, crypto wallets, healthcare portals, tax software). If detected, the user sees a warning before processing continues.

**User stays in control:** The user can still proceed — it's their machine. But they're warned that automatic redaction may not catch everything in sensitive contexts.

### 7. Secure Data Deletion

**How:** `DataWiper` provides:
- Full wipe (all data including consent)
- Audit log wipe only
- Zero-overwrite before file deletion
- Verification that wipe was complete
- Wipe report showing what was deleted

---

## Data Flow Diagram

```
User clicks "Capture"
    │
    ▼
┌─────────────────────────────┐
│ Windows GraphicsCapturePicker│  ← OS-level consent (not our code)
│ User selects window/region  │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ MemorySafeBitmap            │  ← RAM only, 30s timeout, auto-dispose
│ (bitmap never touches disk) │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ Windows OCR Engine          │  ← Local OS API, no cloud
│ Extracts text from bitmap   │
└──────────────┬──────────────┘
               │
               ▼ (bitmap disposed here)
┌─────────────────────────────┐
│ RedactionService            │  ← Layer 1: Primary PII scrub
│ Removes cards, SSNs, emails,│
│ tokens, keys, IPs, etc.     │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ SensitiveAppFilter          │  ← Warns if banking/password app
│ (optional user override)    │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ SecureOllamaClient          │  ← Layer 2: Re-verify redaction
│ - Validates localhost only   │     + enforce network isolation
│ - Double-checks PII removal │
│ - Records in PrivacyGuard   │
└──────────────┬──────────────┘
               │
               ▼ (localhost:11434 ONLY)
┌─────────────────────────────┐
│ Local Ollama LLM            │  ← Runs on user's machine
│ (never touches internet)    │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ AuditLogService             │  ← Stores redacted text only
│ SHA-256 hashed entries      │     No screenshots, no raw PII
└─────────────────────────────┘
```

---

## Privacy Services Summary

| Service | Purpose | Location |
|---------|---------|----------|
| `PrivacyGuard` | Central enforcement: network isolation, file safety, image leak detection, transparency reporting | `Services/Privacy/` |
| `SecureOllamaClient` | Wraps LLM client with endpoint validation + double-redaction | `Services/Privacy/` |
| `ConsentManager` | First-run consent, versioned terms, one-click revocation | `Services/Privacy/` |
| `MemorySafeBitmap` | RAM-only screenshots with auto-expiry | `Services/Privacy/` |
| `SensitiveAppFilter` | Warns before processing banking/password/healthcare apps | `Services/Privacy/` |
| `DataWiper` | Secure deletion with zero-overwrite and verification | `Services/Privacy/` |
| `RedactionService` | Compiled regex PII scrubber (primary layer) | `Services/Redaction/` |
| `AuditLogService` | Tamper-evident local logs (redacted data only) | `Services/Audit/` |

---

## For Payment Processor Auditors

PAiA is designed to pass Paddle, Stripe, and similar payment processor compliance reviews:

1. **No spyware** — Zero background monitoring. No keystroke logging. No stealth capture.
2. **Explicit consent** — `ConsentManager` records user opt-in with timestamp and version.
3. **Local only** — `PrivacyGuard` enforces localhost-only network access at runtime.
4. **PII protection** — Two-layer redaction with verification before any AI processing.
5. **Audit trail** — Every operation logged with SHA-256 hashes. Only redacted text stored.
6. **Data deletion** — Users can wipe all data at any time with verification.
7. **Transparency** — Real-time privacy report showing exactly what PAiA has done.
8. **No cloud dependency** — Works 100% offline once Ollama is installed.

---

## What PAiA Does NOT Do

- ❌ No background screen recording
- ❌ No keystroke or input logging
- ❌ No clipboard monitoring
- ❌ No process enumeration beyond the captured window
- ❌ No file system scanning
- ❌ No analytics or telemetry
- ❌ No crash reporting to external services
- ❌ No automatic updates that phone home
- ❌ No data shared with Anthropic, OpenAI, or any third party
- ❌ No cloud storage of any kind
