using PAiA.WinUI.Models;

namespace PAiA.WinUI.Services.Context;

/// <summary>
/// Analyses OCR text to detect what the user is looking at and generates
/// context-appropriate system prompts + quick actions.
/// This is the core of PAiA's "all-rounder" ability — it adapts to ANY app.
/// </summary>
public sealed class SmartContextService
{
    /// <summary>
    /// Fast, local heuristic detection — no LLM call needed.
    /// Scans OCR text for patterns that reveal the application context.
    /// </summary>
    public ScreenContext Detect(string redactedOcr, string windowTitle = "")
    {
        var lower = redactedOcr.ToLowerInvariant();
        var titleLower = windowTitle.ToLowerInvariant();

        var ctx = new ScreenContext
        {
            RedactedOcr = redactedOcr,
            CapturedAt = DateTimeOffset.Now,
            AppName = windowTitle
        };

        // --- Detect context type by strongest signal ---

        if (IsError(lower, titleLower))
        {
            ctx.Type = ContextType.Error;
            ctx.Summary = "Error or warning detected";
            ctx.QuickActions = ErrorActions();
        }
        else if (IsCode(lower, titleLower))
        {
            ctx.Type = ContextType.Code;
            ctx.Summary = "Code or IDE detected";
            ctx.QuickActions = CodeActions();
        }
        else if (IsTerminal(lower, titleLower))
        {
            ctx.Type = ContextType.Terminal;
            ctx.Summary = "Terminal or command line detected";
            ctx.QuickActions = TerminalActions();
        }
        else if (IsForm(lower))
        {
            ctx.Type = ContextType.Form;
            ctx.Summary = "Form or input fields detected";
            ctx.QuickActions = FormActions();
        }
        else if (IsSpreadsheet(lower, titleLower))
        {
            ctx.Type = ContextType.Spreadsheet;
            ctx.Summary = "Spreadsheet detected";
            ctx.QuickActions = SpreadsheetActions();
        }
        else if (IsEmail(lower, titleLower))
        {
            ctx.Type = ContextType.Email;
            ctx.Summary = "Email detected";
            ctx.QuickActions = EmailActions();
        }
        else if (IsSettings(lower, titleLower))
        {
            ctx.Type = ContextType.Settings;
            ctx.Summary = "Settings or configuration detected";
            ctx.QuickActions = SettingsActions();
        }
        else if (IsInstaller(lower, titleLower))
        {
            ctx.Type = ContextType.Installer;
            ctx.Summary = "Installer or setup wizard detected";
            ctx.QuickActions = InstallerActions();
        }
        else if (IsDocument(lower, titleLower))
        {
            ctx.Type = ContextType.Document;
            ctx.Summary = "Document or text content detected";
            ctx.QuickActions = DocumentActions();
        }
        else if (IsBrowser(lower, titleLower))
        {
            ctx.Type = ContextType.Browser;
            ctx.Summary = "Web browser content detected";
            ctx.QuickActions = BrowserActions();
        }
        else if (IsFileManager(lower, titleLower))
        {
            ctx.Type = ContextType.FileManager;
            ctx.Summary = "File manager detected";
            ctx.QuickActions = FileManagerActions();
        }
        else
        {
            ctx.Type = ContextType.General;
            ctx.Summary = "Screen captured";
            ctx.QuickActions = GeneralActions();
        }

        return ctx;
    }

    /// <summary>
    /// Returns the system prompt tailored to the detected context.
    /// This is what makes PAiA useful for ANY scenario.
    /// </summary>
    public static string GetSystemPrompt(ContextType type)
    {
        return type switch
        {
            ContextType.Code => """
                You are PAiA, an expert programming assistant. The user captured their screen showing code.
                You can: explain code, find bugs, suggest improvements, write new code, explain errors,
                help with refactoring, suggest design patterns, and answer any programming question.
                Format code blocks with language tags. Be specific and actionable.
                Never invent file paths or project structures you can't see.
                """,

            ContextType.Terminal => """
                You are PAiA, a command-line expert. The user captured a terminal/console.
                You can: explain commands and output, debug errors, suggest next commands,
                write scripts, explain exit codes, help with package managers, and troubleshoot issues.
                Always explain what a command does before suggesting it. Prefer safe, reversible operations.
                """,

            ContextType.Error => """
                You are PAiA, a troubleshooting expert. The user captured an error, warning, or crash.
                You can: diagnose the error, explain what went wrong, provide step-by-step fixes,
                suggest preventive measures, and help recover lost work.
                Start with the most likely cause. Prefer safe, reversible fixes. Never ask for passwords.
                """,

            ContextType.Form => """
                You are PAiA, a form-filling assistant. The user captured a form.
                You can: identify fields, explain what's needed, suggest valid input formats,
                flag required fields, and help with complex forms (tax, registration, etc.).
                NEVER invent personal data. Instead, describe what each field expects.
                """,

            ContextType.Browser => """
                You are PAiA, a web browsing assistant. The user captured a web page.
                You can: summarize page content, explain UI elements, help navigate,
                extract key information, compare products, explain terms, and answer questions about what's shown.
                Reference specific text you can see. Don't speculate about pages you can't see.
                """,

            ContextType.Document => """
                You are PAiA, a writing and document assistant. The user captured a document.
                You can: summarize content, suggest edits, improve writing, check grammar,
                restructure text, explain complex passages, translate, and help with formatting.
                Be specific about what you'd change and why.
                """,

            ContextType.Spreadsheet => """
                You are PAiA, a spreadsheet and data assistant. The user captured a spreadsheet.
                You can: explain formulas, suggest calculations, help with data analysis,
                create charts, clean data, write formulas, explain pivot tables, and troubleshoot errors.
                Reference specific cells and ranges when possible.
                """,

            ContextType.Email => """
                You are PAiA, an email and communication assistant. The user captured an email.
                You can: draft replies, summarize threads, suggest professional responses,
                help set the right tone, extract action items, and flag important details.
                Match the formality level of the original email. Never invent sender details.
                """,

            ContextType.Settings => """
                You are PAiA, a system/app configuration assistant. The user captured a settings screen.
                You can: explain what each setting does, recommend configurations, warn about risky changes,
                troubleshoot configuration issues, and guide through setup processes.
                Always explain the impact of a change before recommending it. Prefer safe defaults.
                """,

            ContextType.Installer => """
                You are PAiA, an installation guide assistant. The user captured an installer or setup wizard.
                You can: explain installation options, recommend settings, warn about bundled software,
                explain license terms in plain language, and guide through the process.
                Flag anything suspicious (adware, unwanted toolbars, opt-out checkboxes).
                """,

            ContextType.FileManager => """
                You are PAiA, a file management assistant. The user captured a file manager.
                You can: explain file types, suggest organization, help find files,
                explain folder structures, help with permissions, and guide disk cleanup.
                Never suggest deleting system files. Recommend backing up before bulk operations.
                """,

            ContextType.Media => """
                You are PAiA, a media and creative assistant. The user captured a media application.
                You can: explain tools and features, suggest techniques, help with editing workflows,
                explain file formats, and guide through creative processes.
                Reference specific tools or panels you can see in the interface.
                """,

            ContextType.Chat => """
                You are PAiA, a communication assistant. The user captured a chat or messaging app.
                You can: help draft messages, suggest responses, summarize conversations,
                translate messages, and help set the right tone.
                Match the conversation's formality and tone. Never fabricate message history.
                """,

            _ => """
                You are PAiA, a helpful all-purpose screen assistant running locally on the user's machine.
                The user captured their screen and needs help. You can see the OCR text from the capture.
                Help with whatever they need — explain what's on screen, troubleshoot problems,
                write content, answer questions, guide through steps, or anything else.
                Be concise and actionable. Reference specific things you can see in the OCR text.
                """
        };
    }

    // ─── Heuristic detectors ───────────────────────────────────────

    private static bool IsError(string text, string title) =>
        text.Contains("exception") || text.Contains("error:") || text.Contains("failed to") ||
        text.Contains("access denied") || text.Contains("crash") || text.Contains("fatal") ||
        text.Contains("0x") && text.Contains("error") || text.Contains("stack trace") ||
        text.Contains("unhandled") || text.Contains("blue screen") ||
        title.Contains("error") || title.Contains("warning");

    private static bool IsCode(string text, string title) =>
        text.Contains("public class") || text.Contains("def ") || text.Contains("function ") ||
        text.Contains("import ") || text.Contains("using ") || text.Contains("#include") ||
        text.Contains("const ") || text.Contains("=> {") || text.Contains("namespace ") ||
        title.Contains("visual studio") || title.Contains("vs code") || title.Contains("vscode") ||
        title.Contains("intellij") || title.Contains("pycharm") || title.Contains("sublime") ||
        title.Contains(".cs") || title.Contains(".py") || title.Contains(".js") ||
        title.Contains(".ts") || title.Contains(".cpp") || title.Contains(".java");

    private static bool IsTerminal(string text, string title) =>
        text.Contains("c:\\>") || text.Contains("ps ") || text.Contains("$ ") ||
        text.Contains("~/") || text.Contains("cmd.exe") || text.Contains("powershell") ||
        text.Contains("npm ") || text.Contains("pip ") || text.Contains("git ") ||
        title.Contains("command prompt") || title.Contains("powershell") ||
        title.Contains("terminal") || title.Contains("bash") || title.Contains("cmd");

    private static bool IsForm(string text) =>
        CountOccurrences(text, "enter your") +
        CountOccurrences(text, "please provide") +
        CountOccurrences(text, "required") +
        CountOccurrences(text, "submit") +
        CountOccurrences(text, "sign up") +
        CountOccurrences(text, "register") +
        CountOccurrences(text, "first name") +
        CountOccurrences(text, "last name") +
        CountOccurrences(text, "email address") +
        CountOccurrences(text, "password") >= 3;

    private static bool IsSpreadsheet(string text, string title) =>
        title.Contains("excel") || title.Contains(".xlsx") || title.Contains(".csv") ||
        title.Contains("sheets") || title.Contains("calc") ||
        (text.Contains("sum(") || text.Contains("vlookup") || text.Contains("=if("));

    private static bool IsEmail(string text, string title) =>
        title.Contains("outlook") || title.Contains("gmail") || title.Contains("mail") ||
        title.Contains("thunderbird") ||
        (text.Contains("from:") && text.Contains("subject:")) ||
        (text.Contains("reply") && text.Contains("forward") && text.Contains("inbox"));

    private static bool IsSettings(string text, string title) =>
        title.Contains("settings") || title.Contains("preferences") || title.Contains("options") ||
        title.Contains("configuration") || title.Contains("control panel") ||
        (text.Contains("toggle") || text.Contains("enable") || text.Contains("disable")) &&
        (text.Contains("on") && text.Contains("off"));

    private static bool IsInstaller(string text, string title) =>
        title.Contains("setup") || title.Contains("install") ||
        text.Contains("i accept") || text.Contains("license agreement") ||
        text.Contains("destination folder") || text.Contains("install now") ||
        (text.Contains("next") && text.Contains("cancel") && text.Contains("back"));

    private static bool IsDocument(string text, string title) =>
        title.Contains("word") || title.Contains(".docx") || title.Contains(".pdf") ||
        title.Contains("notepad") || title.Contains("docs") || title.Contains(".txt") ||
        title.Contains("notion") || title.Contains("google docs");

    private static bool IsBrowser(string text, string title) =>
        title.Contains("chrome") || title.Contains("firefox") || title.Contains("edge") ||
        title.Contains("safari") || title.Contains("brave") || title.Contains("opera") ||
        text.Contains("https://") || text.Contains("http://") ||
        (text.Contains("bookmark") && text.Contains("tab"));

    private static bool IsFileManager(string text, string title) =>
        title.Contains("explorer") || title.Contains("file manager") || title.Contains("finder") ||
        (text.Contains("documents") && text.Contains("downloads") && text.Contains("desktop"));

    private static int CountOccurrences(string text, string pattern)
    {
        int count = 0, idx = 0;
        while ((idx = text.IndexOf(pattern, idx, StringComparison.Ordinal)) != -1)
        { count++; idx += pattern.Length; }
        return count;
    }

    // ─── Quick action sets per context ─────────────────────────────

    private static List<QuickAction> GeneralActions() =>
    [
        new() { Label = "Explain this", Prompt = "Explain what's shown on my screen in plain language.", Icon = "\uE946" },
        new() { Label = "Summarize", Prompt = "Summarize the key information visible on screen.", Icon = "\uE8C8" },
        new() { Label = "What should I do?", Prompt = "Based on what's on screen, what should I do next?", Icon = "\uE8FB" },
        new() { Label = "Help me write", Prompt = "Help me write or improve the text I see on screen.", Icon = "\uE70F" }
    ];

    private static List<QuickAction> CodeActions() =>
    [
        new() { Label = "Explain code", Prompt = "Explain this code — what does it do, line by line?", Icon = "\uE946" },
        new() { Label = "Find bugs", Prompt = "Review this code for bugs, edge cases, and potential issues.", Icon = "\uEBE8" },
        new() { Label = "Improve it", Prompt = "Suggest improvements: cleaner code, better patterns, performance.", Icon = "\uE8FB" },
        new() { Label = "Write tests", Prompt = "Write unit tests for the code shown on screen.", Icon = "\uE9D9" }
    ];

    private static List<QuickAction> TerminalActions() =>
    [
        new() { Label = "Explain output", Prompt = "Explain the terminal output. What happened?", Icon = "\uE946" },
        new() { Label = "Fix the error", Prompt = "There's an error in the terminal. How do I fix it?", Icon = "\uE90F" },
        new() { Label = "Next command", Prompt = "What command should I run next?", Icon = "\uE8FB" },
        new() { Label = "Write a script", Prompt = "Write a script that automates what I'm doing in the terminal.", Icon = "\uE70F" }
    ];

    private static List<QuickAction> ErrorActions() =>
    [
        new() { Label = "Fix this error", Prompt = "Diagnose this error and give me step-by-step fixes.", Icon = "\uE90F" },
        new() { Label = "Explain error", Prompt = "Explain this error in plain language. What went wrong?", Icon = "\uE946" },
        new() { Label = "Prevent recurrence", Prompt = "How do I prevent this error from happening again?", Icon = "\uE8FB" },
        new() { Label = "Recover data", Prompt = "Can I recover any lost work or data from this error?", Icon = "\uE74E" }
    ];

    private static List<QuickAction> FormActions() =>
    [
        new() { Label = "Help fill this", Prompt = "Identify form fields and tell me what each one needs.", Icon = "\uE8A5" },
        new() { Label = "Explain fields", Prompt = "Explain what each field means and any requirements.", Icon = "\uE946" },
        new() { Label = "Check my entries", Prompt = "Review my form entries for errors or missing info.", Icon = "\uE9D9" },
        new() { Label = "Is this legit?", Prompt = "Does this form look legitimate? Any red flags?", Icon = "\uEBE8" }
    ];

    private static List<QuickAction> BrowserActions() =>
    [
        new() { Label = "Summarize page", Prompt = "Summarize the key content on this web page.", Icon = "\uE8C8" },
        new() { Label = "Explain this", Prompt = "Explain what I'm looking at on this web page.", Icon = "\uE946" },
        new() { Label = "Extract info", Prompt = "Extract the most important facts and data from this page.", Icon = "\uE8FB" },
        new() { Label = "Is this safe?", Prompt = "Does this website or page look safe and legitimate?", Icon = "\uEBE8" }
    ];

    private static List<QuickAction> DocumentActions() =>
    [
        new() { Label = "Summarize", Prompt = "Summarize this document's key points.", Icon = "\uE8C8" },
        new() { Label = "Improve writing", Prompt = "Suggest improvements to the writing: clarity, grammar, tone.", Icon = "\uE70F" },
        new() { Label = "Simplify", Prompt = "Rewrite the visible text in simpler, clearer language.", Icon = "\uE946" },
        new() { Label = "Extract action items", Prompt = "Extract any tasks, deadlines, or action items from this document.", Icon = "\uE8FB" }
    ];

    private static List<QuickAction> SpreadsheetActions() =>
    [
        new() { Label = "Explain data", Prompt = "Explain the data and structure of this spreadsheet.", Icon = "\uE946" },
        new() { Label = "Write formula", Prompt = "Help me write a formula for what I need to calculate.", Icon = "\uE8EF" },
        new() { Label = "Find issues", Prompt = "Check this spreadsheet for errors, inconsistencies, or bad data.", Icon = "\uEBE8" },
        new() { Label = "Analyse trends", Prompt = "Analyse the data trends and provide insights.", Icon = "\uE8FB" }
    ];

    private static List<QuickAction> EmailActions() =>
    [
        new() { Label = "Draft reply", Prompt = "Draft a professional reply to this email.", Icon = "\uE8C8" },
        new() { Label = "Summarize thread", Prompt = "Summarize this email conversation and key action items.", Icon = "\uE946" },
        new() { Label = "Improve tone", Prompt = "Help me adjust the tone of my reply — more professional / friendly / firm.", Icon = "\uE70F" },
        new() { Label = "Extract tasks", Prompt = "Extract all tasks, deadlines, and commitments from this email.", Icon = "\uE8FB" }
    ];

    private static List<QuickAction> SettingsActions() =>
    [
        new() { Label = "Explain settings", Prompt = "Explain what each visible setting does in plain language.", Icon = "\uE946" },
        new() { Label = "Recommended config", Prompt = "What are the recommended values for these settings?", Icon = "\uE8FB" },
        new() { Label = "Security check", Prompt = "Review these settings for security or privacy concerns.", Icon = "\uEBE8" },
        new() { Label = "Reset guidance", Prompt = "How do I safely reset these settings to defaults?", Icon = "\uE74E" }
    ];

    private static List<QuickAction> InstallerActions() =>
    [
        new() { Label = "Guide me", Prompt = "Walk me through this installer step by step. What should I choose?", Icon = "\uE8FB" },
        new() { Label = "Explain options", Prompt = "Explain each installation option and what it means.", Icon = "\uE946" },
        new() { Label = "Red flags?", Prompt = "Are there any suspicious options, bundled software, or things I should uncheck?", Icon = "\uEBE8" },
        new() { Label = "Summarize license", Prompt = "Summarize the license agreement in plain language.", Icon = "\uE8C8" }
    ];

    private static List<QuickAction> FileManagerActions() =>
    [
        new() { Label = "Explain files", Prompt = "Explain what these files and folders are for.", Icon = "\uE946" },
        new() { Label = "Organize", Prompt = "Suggest a better way to organize these files.", Icon = "\uE8FB" },
        new() { Label = "Safe to delete?", Prompt = "Which of these files are safe to delete to free space?", Icon = "\uEBE8" },
        new() { Label = "Find duplicates", Prompt = "Help me identify duplicate or unnecessary files.", Icon = "\uE74E" }
    ];
}
