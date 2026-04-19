using PAiA.WinUI.Services.Assistant;
using PAiA.WinUI.Services.Voice;
using Xunit;

namespace PAiA.Tests;

public class VoiceServiceTests
{
    // ═══ COMMAND PARSING ═══════════════════════════════════════════

    [Theory]
    [InlineData("capture screen", CommandType.CaptureScreen)]
    [InlineData("capture this", CommandType.CaptureScreen)]
    [InlineData("what's on my screen", CommandType.CaptureScreen)]
    [InlineData("whats on my screen", CommandType.CaptureScreen)]
    [InlineData("take a screenshot", CommandType.CaptureScreen)]
    public void Parses_CaptureCommands(string input, CommandType expected)
    {
        var cmd = VoiceService.ParseCommand(input);
        Assert.Equal(expected, cmd.Type);
    }

    [Theory]
    [InlineData("search for React hooks", CommandType.WebSearch)]
    [InlineData("look up Python decorators", CommandType.WebSearch)]
    [InlineData("find VLOOKUP syntax", CommandType.WebSearch)]
    public void Parses_SearchCommands(string input, CommandType expected)
    {
        var cmd = VoiceService.ParseCommand(input);
        Assert.Equal(expected, cmd.Type);
        Assert.NotEmpty(cmd.Argument!);
    }

    [Fact]
    public void Search_ExtractsQuery()
    {
        var cmd = VoiceService.ParseCommand("search for React hooks tutorial");
        Assert.Equal("react hooks tutorial", cmd.Argument);
    }

    [Theory]
    [InlineData("read that", CommandType.ReadResponse)]
    [InlineData("read it back", CommandType.ReadResponse)]
    [InlineData("say that again", CommandType.ReadResponse)]
    public void Parses_ReadCommands(string input, CommandType expected)
    {
        var cmd = VoiceService.ParseCommand(input);
        Assert.Equal(expected, cmd.Type);
    }

    [Theory]
    [InlineData("open chrome", CommandType.OpenBrowser)]
    [InlineData("open edge", CommandType.OpenBrowser)]
    [InlineData("open microsoft edge", CommandType.OpenBrowser)]
    [InlineData("open firefox", CommandType.OpenBrowser)]
    public void Parses_BrowserCommands(string input, CommandType expected)
    {
        var cmd = VoiceService.ParseCommand(input);
        Assert.Equal(expected, cmd.Type);
    }

    [Theory]
    [InlineData("copy that", CommandType.CopyResponse)]
    [InlineData("copy to clipboard", CommandType.CopyResponse)]
    [InlineData("paste next", CommandType.PasteNext)]
    public void Parses_ClipboardCommands(string input, CommandType expected)
    {
        var cmd = VoiceService.ParseCommand(input);
        Assert.Equal(expected, cmd.Type);
    }

    [Theory]
    [InlineData("new chat", CommandType.NewChat)]
    [InlineData("start over", CommandType.NewChat)]
    [InlineData("reset", CommandType.NewChat)]
    public void Parses_SessionCommands(string input, CommandType expected)
    {
        var cmd = VoiceService.ParseCommand(input);
        Assert.Equal(expected, cmd.Type);
    }

    [Theory]
    [InlineData("stop", CommandType.Stop)]
    [InlineData("cancel", CommandType.Stop)]
    [InlineData("never mind", CommandType.Stop)]
    public void Parses_StopCommands(string input, CommandType expected)
    {
        var cmd = VoiceService.ParseCommand(input);
        Assert.Equal(expected, cmd.Type);
    }

    [Theory]
    [InlineData("privacy status", CommandType.PrivacyStatus)]
    [InlineData("am i safe", CommandType.PrivacyStatus)]
    [InlineData("security check", CommandType.SecurityCheck)]
    public void Parses_StatusCommands(string input, CommandType expected)
    {
        var cmd = VoiceService.ParseCommand(input);
        Assert.Equal(expected, cmd.Type);
    }

    [Theory]
    [InlineData("help", CommandType.Help)]
    [InlineData("what can you do", CommandType.Help)]
    public void Parses_HelpCommands(string input, CommandType expected)
    {
        var cmd = VoiceService.ParseCommand(input);
        Assert.Equal(expected, cmd.Type);
    }

    // ═══ WAKE WORD STRIPPING ═══════════════════════════════════════

    [Theory]
    [InlineData("hey paia capture screen", CommandType.CaptureScreen)]
    [InlineData("hey paia, what's on my screen", CommandType.CaptureScreen)]
    [InlineData("paia search for Python", CommandType.WebSearch)]
    [InlineData("paia, help", CommandType.Help)]
    public void Strips_WakeWord(string input, CommandType expected)
    {
        var cmd = VoiceService.ParseCommand(input);
        Assert.Equal(expected, cmd.Type);
    }

    // ═══ FREE-FORM QUESTIONS ═══════════════════════════════════════

    [Fact]
    public void FreeForm_BecomesAskQuestion()
    {
        var cmd = VoiceService.ParseCommand("what does this error mean");
        Assert.Equal(CommandType.AskQuestion, cmd.Type);
        Assert.NotEmpty(cmd.Argument!);
    }

    [Fact]
    public void TooShort_BecomesUnknown()
    {
        var cmd = VoiceService.ParseCommand("hi");
        Assert.Equal(CommandType.Unknown, cmd.Type);
    }

    // ═══ VOICE SERVICE DEFAULTS ════════════════════════════════════

    [Fact]
    public void Defaults_Disabled()
    {
        var svc = new VoiceService();
        Assert.False(svc.IsEnabled);
        Assert.False(svc.IsListening);
        Assert.Equal(VoiceMode.PushToTalk, svc.Mode);
    }

    [Fact]
    public void Dispose_DoesNotThrow()
    {
        var svc = new VoiceService();
        svc.Dispose();
    }

    [Fact]
    public void GetAvailableVoices_DoesNotThrow()
    {
        // May return empty in test environment, but shouldn't crash
        var voices = VoiceService.GetAvailableVoices();
        Assert.NotNull(voices);
    }
}

// ═══ ASSISTANT ORCHESTRATOR ════════════════════════════════════════

public class AssistantOrchestratorTests
{
    [Fact]
    public void TryProcessCommand_SlashCapture()
    {
        var voice = new VoiceService();
        var assistant = new AssistantOrchestrator(voice);

        AssistantAction? fired = null;
        assistant.ActionRequested += a => fired = a;

        var handled = assistant.TryProcessCommand("/capture screen");
        Assert.True(handled);
    }

    [Fact]
    public void TryProcessCommand_SlashHelp()
    {
        var voice = new VoiceService();
        var assistant = new AssistantOrchestrator(voice);
        var handled = assistant.TryProcessCommand("/help");
        Assert.True(handled);
    }

    [Fact]
    public void TryProcessCommand_NotSlash_ReturnsFalse()
    {
        var voice = new VoiceService();
        var assistant = new AssistantOrchestrator(voice);
        var handled = assistant.TryProcessCommand("normal message");
        Assert.False(handled);
    }

    [Fact]
    public void TryProcessCommand_UnknownSlash_ReturnsFalse()
    {
        var voice = new VoiceService();
        var assistant = new AssistantOrchestrator(voice);
        var handled = assistant.TryProcessCommand("/xyz");
        Assert.False(handled);
    }

    [Fact]
    public void GetHelpText_HasCommands()
    {
        var help = AssistantOrchestrator.GetHelpText();
        Assert.Contains("Capture", help);
        Assert.Contains("Search", help);
        Assert.Contains("Privacy", help);
        Assert.Contains("/help", help);
    }

    [Fact]
    public void GetRecentActions_EmptyByDefault()
    {
        var voice = new VoiceService();
        var assistant = new AssistantOrchestrator(voice);
        Assert.Empty(assistant.GetRecentActions());
    }
}
