using PAiA.WinUI.Services.ActiveWindow;
using PAiA.WinUI.Services.Privacy;

namespace PAiA.WinUI.Services.Assistant;

/// <summary>
/// Watches the active window and proactively suggests actions.
/// 
/// WHAT THIS DOES:
/// When user is in VS Code → widget shows "Explain error", "Fix code"
/// When user is in Outlook → widget shows "Draft reply", "Scan links"
/// When user is in Excel → widget shows "Write formula", "Explain data"
/// When user is in Chrome → widget shows "Summarize page", "Scan links"
/// When user is in a banking app → widget shows "⚠️ Sensitive app"
///
/// All of this happens WITHOUT capturing the screen.
/// It only uses the window title and process name (same info as the taskbar).
///
/// WHY THIS MATTERS:
/// - User sees relevant actions BEFORE pressing Ctrl+Shift+P
/// - Reduces friction from "open PAiA → capture → wait → see actions"
///   to "glance at widget → click action → done"
/// - Sensitive app warnings appear the moment you switch to a banking app
/// </summary>
public sealed class ProactiveContextEngine
{
    private readonly ActiveWindowMonitor _monitor;
    private string _lastProcess = "";

    /// <summary>Fires when suggested actions change.</summary>
    public event Action<ProactiveContext>? ContextChanged;

    public ProactiveContextEngine(ActiveWindowMonitor monitor)
    {
        _monitor = monitor;
        _monitor.WindowChanged += OnWindowChanged;
    }

    private void OnWindowChanged(string title, string process)
    {
        // Don't re-fire for same process
        if (process == _lastProcess) return;
        _lastProcess = process;

        var ctx = AnalyzeWindow(title, process);
        ContextChanged?.Invoke(ctx);
    }

    /// <summary>
    /// Analyzes a window title + process and returns proactive suggestions.
    /// No screen capture needed — just metadata.
    /// </summary>
    public static ProactiveContext AnalyzeWindow(string title, string process)
    {
        var lower = process.ToLowerInvariant();
        var titleLower = title.ToLowerInvariant();

        // ── IDE / Code editors ──
        if (lower is "code" or "devenv" or "rider" or "idea64" or "sublime_text" or
            "notepad++" or "atom" or "fleet" or "cursor")
        {
            return new ProactiveContext
            {
                Category = "Code",
                Label = GetAppLabel(title, process),
                Icon = "\uE943",
                Actions =
                [
                    ("Explain error", "Explain the error shown on my screen and how to fix it", "\uE946"),
                    ("Fix code", "Find and fix bugs in the code visible on screen", "\uE90F"),
                    ("Write tests", "Write unit tests for the code on screen", "\uE9D5"),
                    ("Explain code", "Explain what this code does in plain English", "\uE8C8")
                ]
            };
        }

        // ── Terminal / PowerShell ──
        if (lower is "windowsterminal" or "cmd" or "powershell" or "pwsh" or
            "conhost" or "wt" or "git-bash")
        {
            return new ProactiveContext
            {
                Category = "Terminal",
                Label = "Terminal",
                Icon = "\uE756",
                Actions =
                [
                    ("Fix command", "Fix the error in my terminal output", "\uE90F"),
                    ("Explain output", "Explain what this terminal output means", "\uE946"),
                    ("Next step", "What command should I run next?", "\uE76C")
                ]
            };
        }

        // ── Email ──
        if (lower is "outlook" or "thunderbird" or "mailspring" ||
            titleLower.Contains("gmail") || titleLower.Contains("mail"))
        {
            return new ProactiveContext
            {
                Category = "Email",
                Label = GetAppLabel(title, process),
                Icon = "\uE715",
                Actions =
                [
                    ("Draft reply", "Help me draft a professional reply to this email", "\uE70F"),
                    ("Summarize", "Summarize the key points of this email thread", "\uE8C8"),
                    ("Scan links", "Check all links in this email for phishing", "\uE72E"),
                    ("Extract tasks", "Extract action items from this email", "\uE9D5")
                ],
                AutoSuggestion = "💡 Tip: Scan this email for phishing links before clicking anything"
            };
        }

        // ── Browser ──
        if (lower is "chrome" or "msedge" or "firefox" or "brave" or "opera" or "vivaldi")
        {
            var ctx = new ProactiveContext
            {
                Category = "Browser",
                Label = GetBrowserPageTitle(title),
                Icon = "\uE774",
                Actions =
                [
                    ("Summarize page", "Summarize the content of this web page", "\uE8C8"),
                    ("Scan links", "Check links on this page for phishing/malware", "\uE72E"),
                    ("Explain this", "Explain what I'm looking at on this page", "\uE946")
                ]
            };

            // If it looks like a login page, add warning
            if (titleLower.Contains("login") || titleLower.Contains("sign in") ||
                titleLower.Contains("signin") || titleLower.Contains("account"))
            {
                ctx.AutoSuggestion = "🔒 Login page detected — scan for phishing before entering credentials";
                ctx.SensitiveWarning = true;
            }

            return ctx;
        }

        // ── Spreadsheet ──
        if (lower is "excel" or "libreoffice" || titleLower.Contains(".xlsx") ||
            titleLower.Contains(".csv") || titleLower.Contains("sheets"))
        {
            return new ProactiveContext
            {
                Category = "Spreadsheet",
                Label = GetAppLabel(title, process),
                Icon = "\uE80A",
                Actions =
                [
                    ("Write formula", "Write a formula for what I need in this spreadsheet", "\uE8EF"),
                    ("Explain data", "Explain the data pattern I'm looking at", "\uE946"),
                    ("Clean data", "Help me clean and organize this data", "\uE90F")
                ]
            };
        }

        // ── Document editor ──
        if (lower is "winword" or "wordpad" || titleLower.Contains(".docx") ||
            titleLower.Contains(".pdf") || titleLower.Contains("google docs"))
        {
            return new ProactiveContext
            {
                Category = "Document",
                Label = GetAppLabel(title, process),
                Icon = "\uE8A5",
                Actions =
                [
                    ("Improve writing", "Improve the writing quality of this text", "\uE70F"),
                    ("Summarize", "Summarize this document", "\uE8C8"),
                    ("Fix grammar", "Find and fix grammar issues", "\uE90F")
                ]
            };
        }

        // ── Chat / Messaging ──
        if (lower is "slack" or "teams" or "discord" or "telegram" or "whatsapp" or
            "signal" || titleLower.Contains("microsoft teams"))
        {
            return new ProactiveContext
            {
                Category = "Chat",
                Label = GetAppLabel(title, process),
                Icon = "\uE8BD",
                Actions =
                [
                    ("Draft response", "Help me respond to this message professionally", "\uE70F"),
                    ("Summarize thread", "Summarize this conversation thread", "\uE8C8"),
                    ("Scan links", "Check links in this chat for safety", "\uE72E")
                ]
            };
        }

        // ── Settings / Control Panel ──
        if (lower is "systemsettings" or "control" || titleLower.Contains("settings"))
        {
            return new ProactiveContext
            {
                Category = "Settings",
                Label = "System Settings",
                Icon = "\uE713",
                Actions =
                [
                    ("Explain setting", "Explain what this setting does and what to choose", "\uE946"),
                    ("Security check", "Is this setting configured securely?", "\uE72E")
                ]
            };
        }

        // ── Banking / Sensitive apps ──
        var sensitiveWarning = SensitiveAppFilter.CheckWindowTitle(title);
        if (sensitiveWarning is not null)
        {
            return new ProactiveContext
            {
                Category = "Sensitive",
                Label = $"⚠ {GetAppLabel(title, process)}",
                Icon = "\uE72E",
                Actions =
                [
                    ("Scan for phishing", "Check if this is a legitimate site before entering data", "\uE72E")
                ],
                SensitiveWarning = true,
                AutoSuggestion = "⚠️ Sensitive app detected. PAiA will warn before processing any captures."
            };
        }

        // ── File Explorer ──
        if (lower is "explorer" && !titleLower.Contains("internet"))
        {
            return new ProactiveContext
            {
                Category = "Files",
                Label = "File Explorer",
                Icon = "\uE838",
                Actions =
                [
                    ("Explain files", "What files am I looking at?", "\uE946"),
                    ("Organize", "Suggest how to organize these files", "\uE8B7")
                ]
            };
        }

        // ── Default (unknown app) ──
        return new ProactiveContext
        {
            Category = "General",
            Label = GetAppLabel(title, process),
            Icon = "\uE946",
            Actions =
            [
                ("What's this?", "Explain what I'm looking at on my screen", "\uE946"),
                ("Help me", "Help me with what I'm currently doing", "\uE897")
            ]
        };
    }

    private static string GetAppLabel(string title, string process)
    {
        // Use window title, truncated and cleaned
        if (!string.IsNullOrEmpty(title))
        {
            // Remove common suffixes
            var clean = title
                .Replace(" - Google Chrome", "")
                .Replace(" - Microsoft Edge", "")
                .Replace(" - Firefox", "")
                .Replace(" - Visual Studio Code", "")
                .Replace(" - Visual Studio", "")
                .Replace(" - Microsoft Excel", "")
                .Replace(" - Microsoft Word", "")
                .Replace(" - Microsoft Outlook", "")
                .Trim();

            return clean.Length > 40 ? clean[..37] + "…" : clean;
        }

        return process;
    }

    private static string GetBrowserPageTitle(string title)
    {
        var clean = title
            .Replace(" - Google Chrome", "")
            .Replace(" - Microsoft Edge", "")
            .Replace(" - Firefox", "")
            .Replace(" - Brave", "")
            .Replace(" - Opera", "")
            .Trim();

        return clean.Length > 40 ? clean[..37] + "…" : clean;
    }
}

// ═══ Models ═══════════════════════════════════════════════════════

public sealed class ProactiveContext
{
    /// <summary>Category name (Code, Email, Browser, etc.)</summary>
    public string Category { get; set; } = "";

    /// <summary>Short label shown in widget (app/page name)</summary>
    public string Label { get; set; } = "";

    /// <summary>Segoe MDL2 icon glyph</summary>
    public string Icon { get; set; } = "\uE946";

    /// <summary>Quick action buttons: (label, prompt, icon)</summary>
    public List<(string label, string prompt, string icon)> Actions { get; set; } = [];

    /// <summary>Optional auto-suggestion text shown below actions</summary>
    public string? AutoSuggestion { get; set; }

    /// <summary>Whether this is a sensitive app (banking, passwords)</summary>
    public bool SensitiveWarning { get; set; }
}
