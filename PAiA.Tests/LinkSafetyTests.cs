using PAiA.WinUI.Services.Safety;
using Xunit;

namespace PAiA.Tests;

public class LinkSafetyServiceTests
{
    private readonly LinkSafetyService _svc = new();

    // ═══ URL EXTRACTION ════════════════════════════════════════════

    [Fact]
    public void ExtractsUrls_FromText()
    {
        var text = "Visit https://example.com and http://test.org for details";
        var urls = LinkSafetyService.ExtractUrls(text);
        Assert.Equal(2, urls.Count);
    }

    [Fact]
    public void ExtractsUrls_None_InCleanText()
    {
        var urls = LinkSafetyService.ExtractUrls("No links here, just text.");
        Assert.Empty(urls);
    }

    [Fact]
    public void ExtractsUrls_HandlesEmpty()
    {
        Assert.Empty(LinkSafetyService.ExtractUrls(""));
        Assert.Empty(LinkSafetyService.ExtractUrls(null!));
    }

    // ═══ LOOKALIKE DOMAINS ═════════════════════════════════════════

    [Theory]
    [InlineData("https://g00gle.com/login")]
    [InlineData("https://paypa1.com/signin")]
    [InlineData("https://arnazon.com/order")]
    [InlineData("https://micros0ft.com/update")]
    [InlineData("https://app1e.com/verify")]
    [InlineData("https://faceb00k.com/login")]
    public void Flags_LookalikeDomains(string url)
    {
        var warnings = _svc.AnalyzeUrl(url);
        Assert.Contains(warnings, w => w.Type == WarningType.LookalikeDomain);
    }

    [Theory]
    [InlineData("https://google.com")]
    [InlineData("https://amazon.com")]
    [InlineData("https://microsoft.com")]
    public void NoWarning_ForRealDomains(string url)
    {
        var warnings = _svc.AnalyzeUrl(url);
        Assert.DoesNotContain(warnings, w => w.Type == WarningType.LookalikeDomain);
    }

    // ═══ DANGEROUS DOWNLOADS ═══════════════════════════════════════

    [Theory]
    [InlineData("https://evil.com/update.exe")]
    [InlineData("https://evil.com/install.msi")]
    [InlineData("https://evil.com/script.bat")]
    [InlineData("https://evil.com/payload.scr")]
    [InlineData("https://evil.com/macro.vbs")]
    [InlineData("https://evil.com/app.ps1")]
    public void Flags_DangerousDownloads(string url)
    {
        var warnings = _svc.AnalyzeUrl(url);
        Assert.Contains(warnings, w => w.Type == WarningType.DangerousDownload);
        Assert.Contains(warnings, w => w.Severity == RiskLevel.Critical);
    }

    [Theory]
    [InlineData("https://example.com/document.pdf")]
    [InlineData("https://example.com/image.png")]
    [InlineData("https://example.com/report.docx")]
    public void NoWarning_ForSafeFiles(string url)
    {
        var warnings = _svc.AnalyzeUrl(url);
        Assert.DoesNotContain(warnings, w => w.Type == WarningType.DangerousDownload);
    }

    // ═══ URL SHORTENERS ════════════════════════════════════════════

    [Theory]
    [InlineData("https://bit.ly/abc123")]
    [InlineData("https://tinyurl.com/xyz")]
    [InlineData("https://t.co/short")]
    public void Flags_UrlShorteners(string url)
    {
        var warnings = _svc.AnalyzeUrl(url);
        Assert.Contains(warnings, w => w.Type == WarningType.UrlShortener);
    }

    // ═══ PHISHING KEYWORDS ═════════════════════════════════════════

    [Theory]
    [InlineData("https://evil.com/verify-your-account")]
    [InlineData("https://evil.com/account-locked")]
    [InlineData("https://evil.com/urgent-action-required")]
    [InlineData("https://evil.com/security-alert")]
    [InlineData("https://evil.com/update-payment")]
    public void Flags_PhishingKeywords(string url)
    {
        var warnings = _svc.AnalyzeUrl(url);
        Assert.Contains(warnings, w => w.Type == WarningType.PhishingKeyword);
    }

    // ═══ IP ADDRESS LINKS ══════════════════════════════════════════

    [Theory]
    [InlineData("http://192.168.1.100/login")]
    [InlineData("http://45.33.22.11/panel")]
    public void Flags_IpAddresses(string url)
    {
        var warnings = _svc.AnalyzeUrl(url);
        Assert.Contains(warnings, w => w.Type == WarningType.IpAddress);
    }

    // ═══ EXCESSIVE SUBDOMAINS ══════════════════════════════════════

    [Fact]
    public void Flags_ExcessiveSubdomains()
    {
        var warnings = _svc.AnalyzeUrl("https://login.secure.verify.bank.evil.com/signin");
        Assert.Contains(warnings, w => w.Type == WarningType.ExcessiveSubdomains);
    }

    // ═══ INSECURE LOGIN ════════════════════════════════════════════

    [Theory]
    [InlineData("http://mybank.com/login")]
    [InlineData("http://store.com/checkout")]
    [InlineData("http://example.com/payment")]
    public void Flags_HttpLogin(string url)
    {
        var warnings = _svc.AnalyzeUrl(url);
        Assert.Contains(warnings, w => w.Type == WarningType.InsecureLogin);
    }

    [Fact]
    public void NoWarning_HttpsLogin()
    {
        var warnings = _svc.AnalyzeUrl("https://mybank.com/login");
        Assert.DoesNotContain(warnings, w => w.Type == WarningType.InsecureLogin);
    }

    // ═══ SUSPICIOUS TLDs ═══════════════════════════════════════════

    [Theory]
    [InlineData("https://freeprize.xyz")]
    [InlineData("https://login-verify.click")]
    [InlineData("https://download.top")]
    [InlineData("https://freegift.buzz")]
    public void Flags_SuspiciousTlds(string url)
    {
        var warnings = _svc.AnalyzeUrl(url);
        Assert.Contains(warnings, w => w.Type == WarningType.SuspiciousTld);
    }

    // ═══ FULL TEXT ANALYSIS ════════════════════════════════════════

    [Fact]
    public void AnalyzeText_CatchesPhishingEmail()
    {
        var emailText = """
            From: security@paypa1.com
            Subject: Your account has been limited

            Dear customer, we noticed unusual activity on your account.
            Please verify your identity immediately:

            https://paypa1.com/verify-your-account

            If you do not verify within 24 hours, your account will be suspended.
            Click here: https://bit.ly/paypalsecure
            """;

        var report = _svc.AnalyzeText(emailText);
        Assert.True(report.HasDangerousLinks, "Should detect phishing links");
        Assert.True(report.FlaggedLinks.Count >= 2, $"Expected 2+ flagged, got {report.FlaggedLinks.Count}");
    }

    [Fact]
    public void AnalyzeText_SafeEmail()
    {
        var emailText = """
            Hi team,

            Here's the report: https://docs.google.com/spreadsheets/d/abc123
            Meeting link: https://meet.google.com/xyz-abc-def

            Thanks,
            John
            """;

        var report = _svc.AnalyzeText(emailText);
        Assert.False(report.HasDangerousLinks);
    }

    [Fact]
    public void AnalyzeText_MultipleThreats()
    {
        var text = "Download: http://192.168.1.5/update.exe and visit https://g00gle.com/security-alert";
        var report = _svc.AnalyzeText(text);
        Assert.True(report.FlaggedLinks.Count >= 2);
        Assert.Contains(report.FlaggedLinks, f => f.RiskLevel == RiskLevel.Critical);
    }

    // ═══ SUMMARY TEXT ══════════════════════════════════════════════

    [Fact]
    public void GetSummary_NoLinks()
    {
        var report = new LinkSafetyReport { TotalLinksScanned = 0 };
        Assert.Equal("", LinkSafetyService.GetSummaryText(report));
    }

    [Fact]
    public void GetSummary_AllSafe()
    {
        var report = new LinkSafetyReport
        {
            TotalLinksScanned = 3,
            SafeLinks = ["a", "b", "c"]
        };
        var summary = LinkSafetyService.GetSummaryText(report);
        Assert.Contains("safe", summary);
    }

    [Fact]
    public void GetSummary_CriticalFound()
    {
        var report = new LinkSafetyReport
        {
            TotalLinksScanned = 1,
            FlaggedLinks = [new FlaggedLink { RiskLevel = RiskLevel.Critical }]
        };
        var summary = LinkSafetyService.GetSummaryText(report);
        Assert.Contains("DANGEROUS", summary);
    }
}
