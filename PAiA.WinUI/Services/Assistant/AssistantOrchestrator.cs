using PAiA.WinUI.Services.Voice;

namespace PAiA.WinUI.Services.Assistant;

/// <summary>
/// The brain of PAiA as an assistant.
/// 
/// Connects voice commands (and typed commands) to PAiA's services.
/// This is what turns PAiA from "screen tool" into "assistant."
///
/// WHAT MAKES THIS A PRIVACY ASSISTANT (not just another Alexa):
///
/// 1. A human assistant sees your screen → might gossip, screenshot, leak.
///    PAiA processes locally, redacts PII, forgets in 30 seconds.
///
/// 2. Alexa/Siri send EVERYTHING to the cloud — every word you say.
///    PAiA uses Windows local speech APIs. Zero audio leaves your machine.
///
/// 3. Copilot runs in Microsoft's cloud — your queries are their data.
///    PAiA runs on Ollama localhost. Your data is YOUR data.
///
/// 4. A human assistant has memory — they remember your salary, your medical info.
///    PAiA has no persistent memory. Each session starts clean.
///    (History is opt-in and stores only redacted text.)
///
/// TARGET PERSONAS (v1.0 — achievable):
///
/// • Developer: "PAiA, what's this error?" → captures screen, explains fix
///   Hands-free coding. Never leave the IDE. Voice in, answer on screen + spoken.
///
/// • Professional with sensitive data: "PAiA, help me reply to this email"
///   Lawyer/doctor/banker who can't use cloud AI. PAiA is their private assistant.
///
/// • Accessibility user: "PAiA, read what's on my screen"
///   Voice-controlled screen understanding for users who can't easily read screens.
///
/// • Privacy-conscious power user: "PAiA, am I safe?"
///   Runs security audit, privacy check, link scan — all by voice.
///
/// WHAT PAiA CAN DO (v1.0 — honest scope):
///
/// ✅ Voice-activated screen capture + analysis
/// ✅ Answer questions about what's on screen
/// ✅ Read responses aloud
/// ✅ Web search with PII protection
/// ✅ Open browsers (Chrome/Edge/Firefox/Brave)
/// ✅ Copy code blocks to clipboard
/// ✅ Privacy status + security audits by voice
/// ✅ Basic app launching
///
/// WHAT PAiA CANNOT DO (v1.0 — not pretending):
///
/// ❌ Control other apps (click buttons, fill forms automatically)
/// ❌ Continuous meeting transcription
/// ❌ Smart home control
/// ❌ Calendar/email integration
/// ❌ Multi-step autonomous workflows
/// ❌ Real-time screen monitoring
/// ❌ Phone calls or messaging
/// </summary>
public sealed class AssistantOrchestrator
{
    private readonly VoiceService _voice;
    private readonly List<AssistantAction> _actionLog = [];

    /// <summary>Fires when an action should be executed by MainWindow.</summary>
    public event Action<AssistantAction>? ActionRequested;

    /// <summary>Fires when PAiA wants to speak a response.</summary>
    public event Func<string, Task>? SpeakRequested;

    /// <summary>Fires when PAiA wants to show a status message.</summary>
    public event Action<string>? StatusChanged;

    public AssistantOrchestrator(VoiceService voice)
    {
        _voice = voice;

        // Wire voice commands to actions
        _voice.CommandRecognized += HandleCommand;
        _voice.SpeechRecognized += text =>
            StatusChanged?.Invoke($"🎤 Heard: \"{text}\"");
    }

    /// <summary>
    /// Processes a voice command and dispatches the appropriate action.
    /// </summary>
    private async void HandleCommand(VoiceCommand cmd)
    {
        var action = new AssistantAction
        {
            Timestamp = DateTimeOffset.Now,
            Command = cmd,
            Source = "voice"
        };

        switch (cmd.Type)
        {
            case CommandType.CaptureScreen:
                StatusChanged?.Invoke("📸 Capturing screen…");
                await Speak("Capturing your screen.");
                ActionRequested?.Invoke(action);
                break;

            case CommandType.AskQuestion:
                StatusChanged?.Invoke($"💬 Processing question…");
                ActionRequested?.Invoke(action);
                break;

            case CommandType.WebSearch:
                StatusChanged?.Invoke($"🌐 Searching: {cmd.Argument}");
                await Speak($"Searching for {cmd.Argument}");
                ActionRequested?.Invoke(action);
                break;

            case CommandType.ReadResponse:
                StatusChanged?.Invoke("🔊 Reading response…");
                ActionRequested?.Invoke(action);
                break;

            case CommandType.OpenBrowser:
                var browser = cmd.Argument ?? "your browser";
                StatusChanged?.Invoke($"🌐 Opening {browser}…");
                await Speak($"Opening {browser}");
                ActionRequested?.Invoke(action);
                break;

            case CommandType.CopyResponse:
                StatusChanged?.Invoke("📋 Copied to clipboard");
                await Speak("Copied.");
                ActionRequested?.Invoke(action);
                break;

            case CommandType.PasteNext:
                StatusChanged?.Invoke("📋 Pasting next code block");
                ActionRequested?.Invoke(action);
                break;

            case CommandType.NewChat:
                StatusChanged?.Invoke("🔄 Starting new conversation");
                await Speak("Starting fresh.");
                ActionRequested?.Invoke(action);
                break;

            case CommandType.Stop:
                StatusChanged?.Invoke("⏹ Stopped");
                ActionRequested?.Invoke(action);
                break;

            case CommandType.PrivacyStatus:
                StatusChanged?.Invoke("🔒 Checking privacy…");
                ActionRequested?.Invoke(action);
                break;

            case CommandType.SecurityCheck:
                StatusChanged?.Invoke("🛡 Running security audit…");
                await Speak("Running security audit. This may take a moment.");
                ActionRequested?.Invoke(action);
                break;

            case CommandType.OpenSettings:
                ActionRequested?.Invoke(action);
                break;

            case CommandType.Help:
                await SpeakHelp();
                break;

            default:
                StatusChanged?.Invoke($"❓ Didn't understand: \"{cmd.Raw}\"");
                await Speak("I didn't catch that. Try saying capture screen, or ask me a question.");
                break;
        }

        _actionLog.Add(action);
    }

    /// <summary>
    /// Processes a typed command (same logic as voice, for consistency).
    /// Users can type "/" commands in the input box.
    /// </summary>
    public bool TryProcessCommand(string input)
    {
        if (!input.StartsWith("/")) return false;

        var text = input[1..].Trim();
        var cmd = VoiceService.ParseCommand(text);

        if (cmd.Type == CommandType.Unknown) return false;

        HandleCommand(cmd);
        return true;
    }

    /// <summary>
    /// Speaks the help message — what PAiA can do.
    /// </summary>
    private async Task SpeakHelp()
    {
        var help = "Here's what I can do. " +
            "Say 'capture screen' to analyze what's on your screen. " +
            "Ask me any question about what you see. " +
            "Say 'search for' followed by a topic to look it up online. " +
            "Say 'read that' to hear the last response. " +
            "Say 'open Chrome' or 'open Edge' to launch a browser. " +
            "Say 'copy that' to copy the response. " +
            "Say 'privacy status' to check your privacy score. " +
            "Say 'new chat' to start over. " +
            "Or just ask me anything — I'll use the screen context to help.";

        await Speak(help);
    }

    /// <summary>
    /// Speaks text aloud through the voice service.
    /// </summary>
    private async Task Speak(string text)
    {
        if (SpeakRequested is not null)
            await SpeakRequested.Invoke(text);
    }

    /// <summary>
    /// Gets recent action log for transparency.
    /// </summary>
    public IReadOnlyList<AssistantAction> GetRecentActions(int count = 20)
        => _actionLog.TakeLast(count).Reverse().ToList();

    /// <summary>
    /// Gets the help text (for UI display).
    /// </summary>
    public static string GetHelpText() => """
        Voice commands (say "Hey PAiA" or hold Ctrl+Shift+V):
        
        📸 "Capture screen" / "What's on my screen?"
        💬 Ask any question about what you see
        🌐 "Search for [topic]"
        🔊 "Read that back"
        🌐 "Open Chrome" / "Open Edge" / "Open Firefox"
        📋 "Copy that" / "Paste next"
        🔒 "Privacy status" / "Am I safe?"
        🛡 "Security check"
        🔄 "New chat" / "Start over"
        ⏹ "Stop" / "Cancel"
        ❓ "Help" / "What can you do?"
        
        Typed commands (in the input box):
        /capture  /search [query]  /read  /privacy  /security  /help
        """;
}

// ═══ Models ═══════════════════════════════════════════════════════

public sealed class AssistantAction
{
    public DateTimeOffset Timestamp { get; set; }
    public VoiceCommand? Command { get; set; }
    public string Source { get; set; } = ""; // "voice" or "typed"
    public bool Completed { get; set; }
    public string? Result { get; set; }
}
