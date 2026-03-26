# PAiA — Getting Started Guide

## Step 1: Prerequisites (one-time setup)

### Install .NET 8 SDK
Download from: https://dotnet.microsoft.com/download/dotnet/8.0
- Choose "SDK" (not Runtime)
- Choose Windows x64
- Run the installer

Verify:
```powershell
dotnet --version
# Should show 8.x.x
```

### Install Ollama
Download from: https://ollama.com/download
- Choose Windows
- Run the installer
- Ollama runs as a background service automatically

Verify:
```powershell
ollama --version
# Should show version number
```

### Pull a Model
Open PowerShell and run:
```powershell
# Recommended: good balance of speed and quality
ollama pull llama3.2:latest

# Alternative: smaller, faster (for weaker hardware)
ollama pull phi3:mini

# Alternative: larger, smarter (needs 16GB+ RAM)
ollama pull llama3.1:8b
```

Wait for the download to complete (1-5 GB depending on model).

Verify:
```powershell
ollama list
# Should show your downloaded model(s)
```

---

## Step 2: Build PAiA

### Extract the ZIP
1. Download `PAiA.zip`
2. Extract to a folder (e.g., `C:\Projects\PAiA`)

### Open in Visual Studio
1. Open `PAiA.sln` in Visual Studio 2022
2. Set platform to `x64`
3. Set startup project to `PAiA.WinUI`
4. Press F5 (or Ctrl+F5 for without debugger)

### Or build from command line:
```powershell
cd C:\Projects\PAiA
dotnet restore
dotnet build --configuration Release
dotnet run --project PAiA.WinUI
```

### Run tests:
```powershell
dotnet test PAiA.Tests
# Should show 94 tests passed
```

---

## Step 3: First Launch

### Consent Dialog
On first launch, PAiA shows a privacy disclosure:
- Read what PAiA does and doesn't do
- Click **"I Agree"** to continue
- Or click **"Decline"** and the app closes
- Your consent is timestamped and stored locally

### Ollama Connection
PAiA automatically:
- Connects to Ollama on localhost:11434
- Shows green dot = connected
- Loads available models into the dropdown
- If red dot: make sure Ollama is running (`ollama serve`)

### Model Selection
- Pick your model from the dropdown (top bar)
- Recommended: `llama3.2:latest` for general use

---

## Step 4: Daily Usage

### Basic Flow: Capture → Ask → Get Help

#### 1. Capture a Screen
- Click **"Capture Screen"** (or press **Ctrl+Shift+P** from anywhere)
- Windows shows the system picker — select a window or draw a region
- PAiA runs OCR, redacts PII, detects the context

#### 2. See What PAiA Detected
The **context bar** appears showing:
- **Context type**: Code, Terminal, Error, Form, Browser, Email, etc.
- **App name**: The window you captured
- **Redaction count**: "🔒 3 items redacted: 1 email, 1 credit card, 1 phone"
- **Quick actions**: Context-specific buttons

#### 3. Use Quick Actions (one-click)
Click any quick action button for instant help:
- **Code detected?** → "Explain code", "Find bugs", "Improve it", "Write tests"
- **Error detected?** → "Fix this error", "Explain", "Prevent recurrence"
- **Email detected?** → "Draft reply", "Summarize thread", "Extract tasks"
- **Terminal detected?** → "Explain output", "Fix error", "Next command"
- **Form detected?** → "Help fill this", "Explain fields", "Check entries"

#### 4. Or Type Your Own Question
Type anything in the input box and press Enter:
- "What does this function do?"
- "How do I fix the error on line 42?"
- "Rewrite this email more professionally"
- "What formula would calculate the total in column D?"

#### 5. Get Streaming Response
PAiA streams the answer token-by-token. When done:
- **Copy button** appears on each response
- **Code blocks auto-queue** to clipboard (paste in order with Ctrl+V)
- Response is saved to **searchable history**

---

## Step 5: Power Features

### Pin Response (Always on Top)
1. Get a helpful response
2. Click the **📌 Pin** button (input bar)
3. A compact floating window stays on top while you work in another app
4. Copy from it, close when done

### Global Hotkey
- **Ctrl+Shift+P** captures from anywhere — no need to switch to PAiA
- Works system-wide, even when PAiA is minimized

### Smart Clipboard Queue
When PAiA's response contains code blocks:
- They automatically queue up
- You see: "📋 3 code blocks queued — paste with Ctrl+V in order"
- Switch to your terminal/IDE and paste them one at a time
- Each Ctrl+V gives the next block in sequence

### Search History
1. Click the **🕐 History** button (top bar)
2. See your recent questions and answers
3. Search by keyword across all past sessions
4. Bookmark useful responses

### Form Helper Overlay
When PAiA detects a form:
1. Click "Help fill this" quick action
2. A separate overlay window opens
3. Each form field shown as a card with:
   - Field label + required/type badges
   - Suggested input with Copy button
   - Confidence indicator (green/amber/red)
4. Copy individual suggestions or "Copy All"

---

## Step 6: Privacy & Security

### Privacy Pulse Bar (always visible)
Bottom of the window shows real-time status:
- **Network: isolated ✓** — no outbound connections
- **Memory: clean ✓** — no screenshots in RAM
- **Disk: no images ✓** — no screenshots on disk
- **Score: 100/100** — overall privacy health

### Security Dashboard
1. Click the **🛡️ Security** button (top bar)
2. See threat intelligence summary (18+ known threats cataloged)
3. Click **"Run Full Security Audit"** to:
   - Simulate 50+ attack patterns
   - Auto-apply fixes for any failures
   - Get a score and detailed report
4. Click **"View Privacy Report"** for full transparency

### Settings
1. Click the **⚙️ Settings** button
2. See privacy guarantees and consent date
3. **"Manage Redaction Rules"** → add custom patterns
4. **"Revoke Consent & Delete All Data"** → nuclear option

### Custom Redaction Rules
Add patterns for things PAiA should always scrub:
- Company project codenames: "Project Falcon" → [PROJECT-REDACTED]
- Internal IPs: `10.x.x.x` patterns
- Employee names
- JIRA ticket numbers (PROJ-1234)
- Slack channel names

Templates are available — click "Add All Templates" in the redaction editor.

---

## Step 7: Troubleshooting

### "Ollama not found"
```powershell
# Check if Ollama is running
ollama list

# If not, start it manually
ollama serve

# Check the port
netstat -an | findstr 11434
```

### "No models available"
```powershell
# Pull a model
ollama pull llama3.2:latest

# Verify
ollama list
```

### "Capture failed"
- Make sure you're selecting a window in the system picker
- Some apps block screen capture (DRM-protected content)
- Try capturing a different window

### "Responses are slow"
- Use a smaller model: `ollama pull phi3:mini`
- Close other GPU-intensive apps
- Check RAM usage (LLMs need 4-16 GB)

### "Build errors"
- Ensure Windows 10 SDK 10.0.19041.0 or later is installed
- Ensure WinUI 3 workload is installed in Visual Studio
- Run `dotnet restore` before building
- Set platform to x64 (not AnyCPU)

---

## Architecture Quick Reference

```
User clicks "Capture" or Ctrl+Shift+P
    │
    ├─ SensitiveAppFilter: warns if banking/password app
    ├─ GraphicsCapturePicker: OS-level consent dialog
    ├─ MemorySafeBitmap: RAM only, 30s auto-expire
    ├─ OcrService: Windows OCR API (local)
    ├─ CustomRedactionRules: your custom patterns first
    ├─ RedactionService: built-in PII patterns (cards, SSN, email...)
    ├─ RedactionDiffView: shows what was scrubbed
    ├─ SmartContextService: detects Code/Terminal/Error/Form/etc.
    │
    ▼
User asks a question (or clicks quick action)
    │
    ├─ SecureOllamaClient: validates localhost + double-checks redaction
    ├─ ChatService: manages conversation with screen context
    ├─ SmartClipboardQueue: auto-queues code blocks
    ├─ ResponseHistory: saves for search later
    │
    ▼
Privacy runs continuously:
    ├─ LivePrivacyPulse: visible status bar
    ├─ RuntimeSecurityMonitor: checks every 5 seconds
    ├─ PrivacyGuard: network isolation + transparency report
    └─ AuditLogService: SHA-256 hashed, redacted-only logs
```

---

## File Locations

| What | Where |
|------|-------|
| App data | `%LOCALAPPDATA%\PAiA\` |
| Audit logs | `%LOCALAPPDATA%\PAiA\AuditLogs\` |
| Response history | `%LOCALAPPDATA%\PAiA\History\` |
| Custom redaction rules | `%LOCALAPPDATA%\PAiA\custom-redaction.json` |
| Consent record | `%LOCALAPPDATA%\PAiA\consent.json` |
| Security threat DB | `%LOCALAPPDATA%\PAiA\SecurityLab\threat-db.json` |
| Task packs | `<install>\Services\Packs\packs.json` |

All data is local. Delete the `PAiA` folder to remove everything.
