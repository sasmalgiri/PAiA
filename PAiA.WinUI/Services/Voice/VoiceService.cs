using System.Globalization;

namespace PAiA.WinUI.Services.Voice;

/// <summary>
/// Voice input/output for PAiA using Windows Speech APIs.
/// 
/// WHAT THIS GIVES YOU:
/// - "Hey PAiA, what's on my screen?" → captures + analyzes + speaks the answer
/// - "PAiA, search for React hooks tutorial" → web search + reads results
/// - "Read that back to me" → speaks the last AI response aloud
/// - "Open Chrome" → launches the browser
/// - Push-to-talk (hold Ctrl+Shift+V) as alternative to wake word
///
/// PRIVACY:
/// - Uses Windows.Media.SpeechRecognition (LOCAL, built into Windows)
/// - Uses Windows.Media.SpeechSynthesis (LOCAL, built into Windows)
/// - NO audio is recorded, stored, or sent anywhere
/// - NO cloud speech services (no Whisper API, no Google, no Alexa)
/// - Wake word detection runs entirely on-device
///
/// LIMITATIONS (honest):
/// - Windows speech recognition is less accurate than cloud services
/// - Limited language support compared to Whisper/Google
/// - Wake word "Hey PAiA" may have false positives in noisy environments
/// - Push-to-talk is more reliable for noisy offices
/// - Voice output uses Windows TTS — functional, not human-sounding
/// - Cannot do real-time continuous transcription (meeting notes need Whisper)
///
/// TARGET PERSONAS:
/// - Developers coding hands-free ("what does this error mean?")
/// - Professionals multitasking ("read me that email summary")
/// - Accessibility users who need voice control
/// - Privacy-conscious users who refuse cloud voice assistants
/// </summary>
public sealed class VoiceService : IDisposable
{
    private Windows.Media.SpeechRecognition.SpeechRecognizer? _recognizer;
    private Windows.Media.SpeechSynthesis.SpeechSynthesizer? _synthesizer;
    private bool _isListening;
    private bool _disposed;

    /// <summary>Master switch — disabled by default.</summary>
    public bool IsEnabled { get; set; }

    /// <summary>Wake word mode vs push-to-talk.</summary>
    public VoiceMode Mode { get; set; } = VoiceMode.PushToTalk;

    /// <summary>Current speech recognition state.</summary>
    public bool IsListening => _isListening;

    /// <summary>Is the synthesizer currently speaking?</summary>
    public bool IsSpeaking { get; private set; }

    /// <summary>Selected voice for TTS output.</summary>
    public string? SelectedVoice { get; set; }

    /// <summary>Speech volume (0.0 to 1.0).</summary>
    public double Volume { get; set; } = 0.8;

    /// <summary>Speech rate (-10 to 10, 0 is normal).</summary>
    public int Rate { get; set; } = 1;

    /// <summary>Fires when speech is recognized.</summary>
    public event Action<string>? SpeechRecognized;

    /// <summary>Fires when a structured command is detected.</summary>
    public event Action<VoiceCommand>? CommandRecognized;

    /// <summary>Fires when listening state changes.</summary>
    public event Action<bool>? ListeningChanged;

    // ═══ INITIALIZATION ════════════════════════════════════════════

    /// <summary>
    /// Initializes Windows Speech APIs.
    /// Call once at startup if voice is enabled.
    /// </summary>
    public async Task InitializeAsync()
    {
        if (!IsEnabled) return;

        try
        {
            // Initialize speech recognizer (local, offline)
            _recognizer = new Windows.Media.SpeechRecognition.SpeechRecognizer(
                new Windows.Globalization.Language("en-US"));

            // Add PAiA-specific grammar for better recognition
            var commands = new Windows.Media.SpeechRecognition.SpeechRecognitionListConstraint(
                new[]
                {
                    "hey paia", "paia",
                    "capture screen", "capture this", "what's on my screen",
                    "search for", "look up", "find",
                    "read that", "read it back", "say that again",
                    "open chrome", "open edge", "open browser",
                    "copy that", "paste", "copy code",
                    "new chat", "clear", "reset",
                    "stop", "cancel", "never mind",
                    "settings", "security check", "privacy status",
                    "help", "what can you do"
                },
                "PAiA Commands");

            _recognizer.Constraints.Add(commands);

            // Also allow free-form dictation for questions
            _recognizer.Constraints.Add(
                new Windows.Media.SpeechRecognition.SpeechRecognitionTopicConstraint(
                    Windows.Media.SpeechRecognition.SpeechRecognitionScenario.Dictation,
                    "Questions"));

            await _recognizer.CompileConstraintsAsync();

            // Wire up recognition events
            _recognizer.ContinuousRecognitionSession.ResultGenerated += (_, args) =>
            {
                if (args.Result.Confidence >=
                    Windows.Media.SpeechRecognition.SpeechRecognitionConfidence.Medium)
                {
                    var text = args.Result.Text.ToLowerInvariant().Trim();
                    ProcessSpeech(text);
                }
            };

            // Initialize TTS
            _synthesizer = new Windows.Media.SpeechSynthesis.SpeechSynthesizer();

            // Set voice if specified
            if (!string.IsNullOrEmpty(SelectedVoice))
            {
                var voice = Windows.Media.SpeechSynthesis.SpeechSynthesizer.AllVoices
                    .FirstOrDefault(v => v.DisplayName.Contains(SelectedVoice,
                        StringComparison.OrdinalIgnoreCase));
                if (voice is not null)
                    _synthesizer.Voice = voice;
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Voice init failed: {ex.Message}");
        }
    }

    // ═══ LISTENING ═════════════════════════════════════════════════

    /// <summary>
    /// Starts listening for voice input.
    /// In PushToTalk mode, call this when hotkey is pressed.
    /// In WakeWord mode, this runs continuously.
    /// </summary>
    public async Task StartListeningAsync()
    {
        if (!IsEnabled || _recognizer is null || _isListening) return;

        try
        {
            await _recognizer.ContinuousRecognitionSession.StartAsync();
            _isListening = true;
            ListeningChanged?.Invoke(true);
        }
        catch { }
    }

    /// <summary>
    /// Stops listening.
    /// </summary>
    public async Task StopListeningAsync()
    {
        if (!_isListening || _recognizer is null) return;

        try
        {
            await _recognizer.ContinuousRecognitionSession.StopAsync();
            _isListening = false;
            ListeningChanged?.Invoke(false);
        }
        catch { }
    }

    /// <summary>
    /// One-shot recognition — listens for a single utterance and returns it.
    /// Used for push-to-talk mode.
    /// </summary>
    public async Task<string?> ListenOnceAsync()
    {
        if (!IsEnabled || _recognizer is null) return null;

        try
        {
            var result = await _recognizer.RecognizeAsync();
            if (result.Status == Windows.Media.SpeechRecognition.SpeechRecognitionResultStatus.Success &&
                result.Confidence >= Windows.Media.SpeechRecognition.SpeechRecognitionConfidence.Medium)
            {
                return result.Text;
            }
        }
        catch { }
        return null;
    }

    // ═══ SPEAKING ══════════════════════════════════════════════════

    /// <summary>
    /// Speaks text aloud using Windows TTS.
    /// Returns a SpeechSynthesisStream that can be played via MediaPlayer in WinUI 3.
    /// </summary>
    public async Task<Windows.Media.SpeechSynthesis.SpeechSynthesisStream?> SpeakAsync(string text)
    {
        if (!IsEnabled || _synthesizer is null || string.IsNullOrEmpty(text)) return null;

        try
        {
            IsSpeaking = true;

            // Clean text for speech (remove code blocks, markdown)
            var cleanText = CleanForSpeech(text);

            // Generate speech
            var stream = await _synthesizer.SynthesizeTextToStreamAsync(cleanText);
            return stream;
        }
        catch
        {
            return null;
        }
        finally
        {
            IsSpeaking = false;
        }
    }

    /// <summary>
    /// Speaks a short confirmation/status message.
    /// </summary>
    public async Task<Windows.Media.SpeechSynthesis.SpeechSynthesisStream?> SayAsync(string shortText)
    {
        return await SpeakAsync(shortText);
    }

    /// <summary>
    /// Gets available TTS voices installed on Windows.
    /// </summary>
    public static List<VoiceInfo> GetAvailableVoices()
    {
        return Windows.Media.SpeechSynthesis.SpeechSynthesizer.AllVoices
            .Select(v => new VoiceInfo
            {
                Name = v.DisplayName,
                Language = v.Language,
                Gender = v.Gender.ToString()
            })
            .ToList();
    }

    // ═══ COMMAND PROCESSING ════════════════════════════════════════

    /// <summary>
    /// Parses recognized speech into structured commands or free-form questions.
    /// </summary>
    private void ProcessSpeech(string text)
    {
        // Fire raw speech event
        SpeechRecognized?.Invoke(text);

        // Parse into commands
        var command = ParseCommand(text);
        if (command.Type != CommandType.Unknown)
        {
            CommandRecognized?.Invoke(command);
        }
    }

    /// <summary>
    /// Parses text into a VoiceCommand.
    /// </summary>
    public static VoiceCommand ParseCommand(string text)
    {
        var lower = text.ToLowerInvariant().Trim();

        // Remove wake word prefix
        if (lower.StartsWith("hey paia"))
            lower = lower["hey paia".Length..].Trim().TrimStart(',').Trim();
        else if (lower.StartsWith("paia"))
            lower = lower["paia".Length..].Trim().TrimStart(',').Trim();

        // ── Capture commands ──
        if (lower is "capture screen" or "capture this" or "take a screenshot" or
            "what's on my screen" or "whats on my screen" or "look at my screen" or
            "what do you see" or "analyze this" or "screen capture")
            return new VoiceCommand { Type = CommandType.CaptureScreen, Raw = text };

        // ── Search commands ──
        if (lower.StartsWith("search for ") || lower.StartsWith("look up ") ||
            lower.StartsWith("find ") || lower.StartsWith("google ") ||
            lower.StartsWith("search "))
        {
            var query = lower
                .Replace("search for ", "").Replace("look up ", "")
                .Replace("find ", "").Replace("google ", "")
                .Replace("search ", "").Trim();
            return new VoiceCommand { Type = CommandType.WebSearch, Argument = query, Raw = text };
        }

        // ── Read commands ──
        if (lower is "read that" or "read it back" or "say that again" or
            "read the response" or "read it" or "what did you say" or
            "repeat that")
            return new VoiceCommand { Type = CommandType.ReadResponse, Raw = text };

        // ── Browser commands ──
        if (lower is "open chrome" or "open google chrome")
            return new VoiceCommand { Type = CommandType.OpenBrowser, Argument = "chrome", Raw = text };
        if (lower is "open edge" or "open microsoft edge")
            return new VoiceCommand { Type = CommandType.OpenBrowser, Argument = "edge", Raw = text };
        if (lower is "open firefox")
            return new VoiceCommand { Type = CommandType.OpenBrowser, Argument = "firefox", Raw = text };
        if (lower is "open browser")
            return new VoiceCommand { Type = CommandType.OpenBrowser, Raw = text };

        // ── Clipboard commands ──
        if (lower is "copy that" or "copy the response" or "copy it" or "copy code" or
            "copy to clipboard")
            return new VoiceCommand { Type = CommandType.CopyResponse, Raw = text };
        if (lower is "paste" or "paste next" or "paste code")
            return new VoiceCommand { Type = CommandType.PasteNext, Raw = text };

        // ── Session commands ──
        if (lower is "new chat" or "new conversation" or "start over" or
            "clear chat" or "reset")
            return new VoiceCommand { Type = CommandType.NewChat, Raw = text };

        // ── Control commands ──
        if (lower is "stop" or "cancel" or "shut up" or "be quiet" or
            "stop talking" or "never mind")
            return new VoiceCommand { Type = CommandType.Stop, Raw = text };

        // ── Status commands ──
        if (lower is "privacy status" or "privacy check" or "am i safe" or
            "privacy report")
            return new VoiceCommand { Type = CommandType.PrivacyStatus, Raw = text };
        if (lower is "security check" or "run security" or "security audit" or
            "security status")
            return new VoiceCommand { Type = CommandType.SecurityCheck, Raw = text };
        if (lower is "settings" or "open settings" or "preferences")
            return new VoiceCommand { Type = CommandType.OpenSettings, Raw = text };

        // ── Help ──
        if (lower is "help" or "what can you do" or "what are your commands" or
            "how do i use you")
            return new VoiceCommand { Type = CommandType.Help, Raw = text };

        // ── Free-form question (anything else is sent to the LLM) ──
        if (lower.Length > 3)
            return new VoiceCommand { Type = CommandType.AskQuestion, Argument = text, Raw = text };

        return new VoiceCommand { Type = CommandType.Unknown, Raw = text };
    }

    // ═══ TEXT CLEANING ═════════════════════════════════════════════

    /// <summary>
    /// Cleans LLM response text for speech output.
    /// Removes code blocks, markdown, URLs, etc.
    /// </summary>
    private static string CleanForSpeech(string text)
    {
        if (string.IsNullOrEmpty(text)) return "";

        var clean = text;

        // Remove code blocks
        clean = System.Text.RegularExpressions.Regex.Replace(
            clean, @"```[\s\S]*?```", "I've included a code block. ");

        // Remove inline code
        clean = System.Text.RegularExpressions.Regex.Replace(
            clean, @"`([^`]+)`", "$1");

        // Remove URLs
        clean = System.Text.RegularExpressions.Regex.Replace(
            clean, @"https?://\S+", "a link");

        // Remove markdown headers
        clean = System.Text.RegularExpressions.Regex.Replace(
            clean, @"#{1,6}\s*", "");

        // Remove bold/italic markers
        clean = clean.Replace("**", "").Replace("__", "").Replace("*", "").Replace("_", "");

        // Remove bullet points
        clean = System.Text.RegularExpressions.Regex.Replace(
            clean, @"^[\s]*[-•]\s*", "", System.Text.RegularExpressions.RegexOptions.Multiline);

        // Collapse whitespace
        clean = System.Text.RegularExpressions.Regex.Replace(clean, @"\s+", " ").Trim();

        // Truncate for speech (don't read 5000 words)
        if (clean.Length > 1500)
        {
            var cutoff = clean.LastIndexOf('.', 1400);
            if (cutoff > 500) clean = clean[..(cutoff + 1)] + " There's more in the response if you'd like to read it.";
            else clean = clean[..1500] + "... and there's more in the text response.";
        }

        return clean;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _recognizer?.Dispose();
        _synthesizer?.Dispose();
    }
}

// ═══ Models ═══════════════════════════════════════════════════════

public sealed class VoiceCommand
{
    public CommandType Type { get; set; }
    public string? Argument { get; set; }
    public string Raw { get; set; } = "";
}

public enum CommandType
{
    Unknown,
    CaptureScreen,      // "capture this", "what's on my screen"
    AskQuestion,        // free-form question sent to LLM
    WebSearch,          // "search for React hooks"
    ReadResponse,       // "read that back"
    OpenBrowser,        // "open Chrome"
    CopyResponse,       // "copy that"
    PasteNext,          // "paste next code block"
    NewChat,            // "new conversation"
    Stop,               // "stop", "cancel"
    PrivacyStatus,      // "am I safe?"
    SecurityCheck,      // "run security audit"
    OpenSettings,       // "settings"
    Help                // "what can you do"
}

public enum VoiceMode
{
    PushToTalk,         // Hold Ctrl+Shift+V to speak (default, most reliable)
    WakeWord,           // Always listening for "Hey PAiA" (more convenient, less private)
    Disabled            // No voice features
}

public sealed class VoiceInfo
{
    public string Name { get; set; } = "";
    public string Language { get; set; } = "";
    public string Gender { get; set; } = "";
}
