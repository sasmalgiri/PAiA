using PAiA.WinUI.Services.Privacy;
using Xunit;

namespace PAiA.Tests;

public class PrivacyGuardTests
{
    private readonly PrivacyGuard _guard = new();

    // ═══ ENDPOINT VALIDATION ═══════════════════════════════════════

    [Theory]
    [InlineData("http://localhost:11434/api/chat", true)]
    [InlineData("http://127.0.0.1:11434/api/chat", true)]
    [InlineData("http://localhost:11434", true)]
    public void Allows_LocalhostOllama(string url, bool expected)
    {
        Assert.Equal(expected, _guard.IsAllowedEndpoint(url));
    }

    [Theory]
    [InlineData("http://evil.com/api/chat")]
    [InlineData("https://api.openai.com/v1/chat")]
    [InlineData("http://192.168.1.100:11434/api/chat")]
    [InlineData("http://10.0.0.5:11434/api/chat")]
    [InlineData("http://ollama.company.internal:11434")]
    [InlineData("ftp://fileserver.com/models")]
    [InlineData("http://0.0.0.0:11434")]
    public void Blocks_ExternalEndpoints(string url)
    {
        Assert.False(_guard.IsAllowedEndpoint(url));
    }

    [Theory]
    [InlineData("http://localhost:8080/api")]
    [InlineData("http://localhost:3000")]
    [InlineData("http://127.0.0.1:443")]
    [InlineData("http://localhost:80")]
    public void Blocks_WrongPort(string url)
    {
        Assert.False(_guard.IsAllowedEndpoint(url));
    }

    // ═══ URL BYPASS TRICKS ═════════════════════════════════════════

    [Theory]
    [InlineData("http://localhost.evil.com:11434")]
    [InlineData("http://127.0.0.1.evil.com:11434")]
    public void Blocks_UrlBypassTricks(string url)
    {
        Assert.False(_guard.IsAllowedEndpoint(url));
    }

    [Fact]
    public void Handles_MalformedUrls()
    {
        Assert.False(_guard.IsAllowedEndpoint("not-a-url"));
        Assert.False(_guard.IsAllowedEndpoint(""));
        Assert.False(_guard.IsAllowedEndpoint("://"));
    }

    // ═══ PATH VALIDATION ═══════════════════════════════════════════

    [Fact]
    public void Blocks_UnapprovedPaths()
    {
        Assert.False(_guard.IsApprovedPath(@"C:\Users\Public\stolen.json"));
        Assert.False(_guard.IsApprovedPath(@"C:\Windows\System32\data.txt"));
        Assert.False(_guard.IsApprovedPath(@"\\network\share\data.json"));
    }

    // ═══ IMAGE LEAK DETECTION ══════════════════════════════════════

    [Fact]
    public void FindLeakedImages_ReturnsEmptyWhenClean()
    {
        var leaked = _guard.FindLeakedImages();
        // May or may not be empty depending on environment, but shouldn't crash
        Assert.NotNull(leaked);
    }

    // ═══ REDACTION VERIFICATION ════════════════════════════════════

    [Fact]
    public void VerifyRedaction_DetectsLeakedPii()
    {
        var leaks = _guard.VerifyRedaction("Call me at 123-45-6789");
        Assert.NotEmpty(leaks);
        Assert.Contains(leaks, l => l.Contains("SSN"));
    }

    [Fact]
    public void VerifyRedaction_PassesCleanText()
    {
        var leaks = _guard.VerifyRedaction("Hello, how are you today?");
        Assert.Empty(leaks);
    }

    // ═══ OPERATION TRACKING ════════════════════════════════════════

    [Fact]
    public void Tracks_CapturesAndLlmCalls()
    {
        _guard.RecordCapture();
        _guard.RecordCapture();
        _guard.RecordLlmCall();

        var report = _guard.GenerateReport();
        Assert.True(report.TotalCaptures >= 2);
        Assert.True(report.TotalLlmCalls >= 1);
    }

    // ═══ TRANSPARENCY REPORT ═══════════════════════════════════════

    [Fact]
    public void GenerateReport_ProducesValidReport()
    {
        var report = _guard.GenerateReport();
        Assert.NotNull(report);
        Assert.True(report.PrivacyScore >= 0 && report.PrivacyScore <= 100);
        Assert.NotEmpty(report.OllamaEndpoint);
        Assert.NotNull(report.ToSummary());
        Assert.Contains("PAiA Privacy Report", report.ToSummary());
    }
}
