namespace PAiA.WinUI.Models;

/// <summary>
/// Describes what PAiA detected on the user's screen — used to adapt
/// the assistant's behaviour to any application or scenario.
/// </summary>
public sealed class ScreenContext
{
    /// <summary>Detected context category.</summary>
    public ContextType Type { get; set; } = ContextType.General;

    /// <summary>Name of the application / window captured.</summary>
    public string AppName { get; set; } = string.Empty;

    /// <summary>Short one-line summary of what's on screen.</summary>
    public string Summary { get; set; } = string.Empty;

    /// <summary>Suggested quick actions relevant to the context.</summary>
    public List<QuickAction> QuickActions { get; set; } = [];

    /// <summary>Raw redacted OCR text.</summary>
    public string RedactedOcr { get; set; } = string.Empty;

    /// <summary>Timestamp of capture.</summary>
    public DateTimeOffset CapturedAt { get; set; } = DateTimeOffset.Now;
}

/// <summary>
/// Broad category of what's on screen — drives the system prompt and quick actions.
/// </summary>
public enum ContextType
{
    General,        // Anything not specifically detected
    Code,           // IDE, terminal, code editor
    Browser,        // Web browser with page content
    Document,       // Word, PDF, text editor
    Spreadsheet,    // Excel, Google Sheets, CSV viewer
    Email,          // Mail client
    Settings,       // System or app settings/preferences
    Error,          // Error dialog, crash, BSOD
    Form,           // Input form (web or native)
    Terminal,       // Command prompt, PowerShell, bash
    Media,          // Image/video/audio editor
    FileManager,    // Explorer, file browser
    Installer,      // Setup wizard, installer
    Chat            // Messaging app
}

/// <summary>
/// A context-sensitive action the user can trigger with one click.
/// </summary>
public sealed class QuickAction
{
    /// <summary>Button label shown to user.</summary>
    public string Label { get; set; } = string.Empty;

    /// <summary>The prompt sent to the LLM when clicked.</summary>
    public string Prompt { get; set; } = string.Empty;

    /// <summary>Icon glyph (Segoe MDL2).</summary>
    public string Icon { get; set; } = "\uE946"; // default: lightbulb
}
