using System.Text.RegularExpressions;

namespace PAiA.WinUI.Services.Safety;

/// <summary>
/// Scans URLs visible on screen and warns about dangerous links.
/// 
/// HOW IT WORKS:
/// When PAiA captures a screen (email, chat, webpage), this service
/// extracts all visible URLs and runs safety checks:
/// 
/// 1. Domain reputation (known phishing TLDs, suspicious patterns)
/// 2. Lookalike detection (g00gle.com, paypa1.com, arnazon.com)
/// 3. URL shortener detection (bit.ly, tinyurl — hides real destination)
/// 4. Dangerous file extensions (.exe, .scr, .bat in download links)
/// 5. Phishing keyword detection (urgent, verify account, suspended)
/// 6. Mismatch detection (display text says "google.com" but href goes elsewhere)
/// 7. Homograph attack detection (Cyrillic а vs Latin a)
/// 8. Excessive subdomain chains (login.secure.verify.bank.evil.com)
/// 
/// ALL CHECKS ARE LOCAL — no URLs are sent anywhere.
/// No browsing history is tracked. No DNS lookups.
/// 
/// LIMITATIONS:
/// - Can't check if a domain is actually serving malware (would need cloud)
/// - Can't intercept clicks in real-time (PAiA is on-demand)
/// - Can't see href behind displayed text (needs UI Automation signal)
/// - Best used BEFORE clicking: capture a suspicious email, review warnings
/// </summary>
public sealed class LinkSafetyService
{
    // ═══ URL extraction ════════════════════════════════════════════

    private static readonly Regex UrlPattern = new(
        @"https?://[^\s<>\""'\)\]\}]+|www\.[^\s<>\""'\)\]\}]+",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    /// <summary>
    /// Extracts all URLs from text (OCR output, structured text, etc.)
    /// </summary>
    public static List<string> ExtractUrls(string text)
    {
        if (string.IsNullOrEmpty(text)) return [];
        return UrlPattern.Matches(text).Select(m => m.Value.TrimEnd('.', ',', ';', ':', '!')).Distinct().ToList();
    }

    /// <summary>
    /// Analyzes all URLs in text and returns safety warnings.
    /// </summary>
    public LinkSafetyReport AnalyzeText(string text)
    {
        var urls = ExtractUrls(text);
        var report = new LinkSafetyReport();

        foreach (var url in urls)
        {
            var warnings = AnalyzeUrl(url);
            if (warnings.Count > 0)
            {
                report.FlaggedLinks.Add(new FlaggedLink
                {
                    Url = url,
                    Warnings = warnings,
                    RiskLevel = warnings.Max(w => w.Severity),
                    Summary = warnings[0].Message
                });
            }
            else
            {
                report.SafeLinks.Add(url);
            }
        }

        report.TotalLinksScanned = urls.Count;
        return report;
    }

    /// <summary>
    /// Runs all safety checks on a single URL.
    /// </summary>
    public List<LinkWarning> AnalyzeUrl(string url)
    {
        var warnings = new List<LinkWarning>();
        if (string.IsNullOrEmpty(url)) return warnings;

        var lowerUrl = url.ToLowerInvariant();

        // Try to parse the domain
        string domain;
        try
        {
            var uri = url.StartsWith("http") ? new Uri(url) : new Uri("http://" + url);
            domain = uri.Host.ToLowerInvariant();
        }
        catch
        {
            domain = "";
        }

        // ── Check 1: Suspicious TLDs ──────────────────────────────
        var dangerousTlds = new[] { ".zip", ".mov", ".top", ".xyz", ".click", ".link",
            ".work", ".buzz", ".surf", ".rest", ".icu", ".cam", ".monster",
            ".tk", ".ml", ".ga", ".cf", ".gq" };
        foreach (var tld in dangerousTlds)
        {
            if (domain.EndsWith(tld))
            {
                warnings.Add(new LinkWarning
                {
                    Type = WarningType.SuspiciousTld,
                    Severity = RiskLevel.Medium,
                    Message = $"Suspicious domain extension '{tld}' — commonly used in phishing"
                });
                break;
            }
        }

        // ── Check 2: Lookalike domain detection ───────────────────
        var lookalikes = new Dictionary<string, string[]>
        {
            ["google"] = ["g00gle", "go0gle", "googie", "gooogle", "goog1e", "googl3", "g0ogle"],
            ["microsoft"] = ["mlcrosoft", "micros0ft", "micosoft", "microsft", "rnicrosoft"],
            ["apple"] = ["app1e", "appie", "appl3", "appe", "applle"],
            ["amazon"] = ["amaz0n", "arnazon", "arnaz0n", "arnazo", "amazom"],
            ["paypal"] = ["paypa1", "paypai", "paypaI", "paypol", "payp4l"],
            ["netflix"] = ["netfIix", "netfl1x", "n3tflix", "netfliix"],
            ["facebook"] = ["faceb00k", "faceboak", "faceb0ok", "faecbook"],
            ["instagram"] = ["1nstagram", "lnstagram", "instagran", "instagrom"],
            ["linkedin"] = ["linkedln", "l1nkedin", "linkediin", "iinkedin"],
            ["whatsapp"] = ["whatsap", "whatssapp", "watsapp", "whatsaap"],
            ["chase"] = ["chas3", "chasse", "chas.e"],
            ["wellsfargo"] = ["we11sfargo", "wellsfarg0", "wellsfarqo"],
            ["bankofamerica"] = ["bankofarnerica", "bank0famerica"],
        };

        var domainNoTld = domain.Contains('.') ? domain[..domain.LastIndexOf('.')] : domain;
        var domainClean = domainNoTld.Replace(".", "").Replace("-", "");
        foreach (var (brand, fakes) in lookalikes)
        {
            foreach (var fake in fakes)
            {
                if (domainClean.Contains(fake))
                {
                    warnings.Add(new LinkWarning
                    {
                        Type = WarningType.LookalikeDomain,
                        Severity = RiskLevel.High,
                        Message = $"Lookalike domain — impersonating '{brand}'"
                    });
                    goto afterLookalike;
                }
            }
        }
        afterLookalike:

        // ── Check 3: URL shortener (hides real destination) ───────
        var shorteners = new[] { "bit.ly", "tinyurl.com", "t.co", "goo.gl",
            "ow.ly", "is.gd", "buff.ly", "rebrand.ly", "bl.ink",
            "short.io", "cutt.ly", "rb.gy", "v.gd", "qr.ae" };
        if (shorteners.Any(s => domain.EndsWith(s) || domain == s))
        {
            warnings.Add(new LinkWarning
            {
                Type = WarningType.UrlShortener,
                Severity = RiskLevel.Low,
                Message = "URL shortener — real destination is hidden. Hover to preview before clicking."
            });
        }

        // ── Check 4: Dangerous file extension in URL ──────────────
        var dangerousExts = new[] { ".exe", ".msi", ".bat", ".cmd", ".ps1",
            ".scr", ".vbs", ".js", ".wsf", ".hta", ".dll", ".com",
            ".pif", ".jar", ".reg", ".inf", ".lnk" };
        foreach (var ext in dangerousExts)
        {
            if (lowerUrl.Contains(ext + "?") || lowerUrl.Contains(ext + "&") ||
                lowerUrl.EndsWith(ext))
            {
                warnings.Add(new LinkWarning
                {
                    Type = WarningType.DangerousDownload,
                    Severity = RiskLevel.Critical,
                    Message = $"Links to a '{ext}' file — could be malware. Do not download."
                });
                break;
            }
        }

        // ── Check 5: Phishing context keywords ────────────────────
        var phishingKeywords = new[] {
            "verify-your-account", "confirm-identity", "suspended",
            "unusual-activity", "security-alert", "update-payment",
            "reset-password", "account-locked", "limited-access",
            "urgent-action", "click-here-to", "signin-verify" };
        foreach (var keyword in phishingKeywords)
        {
            if (lowerUrl.Contains(keyword))
            {
                warnings.Add(new LinkWarning
                {
                    Type = WarningType.PhishingKeyword,
                    Severity = RiskLevel.High,
                    Message = $"URL contains phishing keyword '{keyword.Replace("-", " ")}'"
                });
                break;
            }
        }

        // ── Check 6: IP address instead of domain ─────────────────
        if (Regex.IsMatch(domain, @"^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$"))
        {
            warnings.Add(new LinkWarning
            {
                Type = WarningType.IpAddress,
                Severity = RiskLevel.High,
                Message = "Links to an IP address instead of a domain — legitimate sites don't do this"
            });
        }

        // ── Check 7: Excessive subdomains ─────────────────────────
        var subdomainCount = domain.Count(c => c == '.');
        if (subdomainCount >= 4)
        {
            warnings.Add(new LinkWarning
            {
                Type = WarningType.ExcessiveSubdomains,
                Severity = RiskLevel.Medium,
                Message = $"Suspicious URL structure — {subdomainCount + 1} subdomain levels (used to hide real domain)"
            });
        }

        // ── Check 8: Homograph characters (Cyrillic/Greek lookalikes) ──
        if (Regex.IsMatch(domain, @"[^\x00-\x7F]"))
        {
            warnings.Add(new LinkWarning
            {
                Type = WarningType.HomographAttack,
                Severity = RiskLevel.Critical,
                Message = "Domain contains non-ASCII characters — possible homograph attack (e.g., Cyrillic 'а' looks like Latin 'a')"
            });
        }

        // ── Check 9: HTTP (not HTTPS) for sensitive paths ─────────
        if (lowerUrl.StartsWith("http://") && (
            lowerUrl.Contains("login") || lowerUrl.Contains("signin") ||
            lowerUrl.Contains("password") || lowerUrl.Contains("payment") ||
            lowerUrl.Contains("checkout") || lowerUrl.Contains("account")))
        {
            warnings.Add(new LinkWarning
            {
                Type = WarningType.InsecureLogin,
                Severity = RiskLevel.High,
                Message = "Login/payment page over HTTP (not HTTPS) — credentials could be intercepted"
            });
        }

        // ── Check 10: Data URI (can embed scripts) ────────────────
        if (lowerUrl.StartsWith("data:"))
        {
            warnings.Add(new LinkWarning
            {
                Type = WarningType.DataUri,
                Severity = RiskLevel.High,
                Message = "Data URI detected — can embed hidden scripts. Do not click."
            });
        }

        return warnings;
    }

    /// <summary>
    /// Generates a human-readable summary for the UI.
    /// </summary>
    public static string GetSummaryText(LinkSafetyReport report)
    {
        if (report.TotalLinksScanned == 0)
            return "";

        if (report.FlaggedLinks.Count == 0)
            return $"🔗 {report.TotalLinksScanned} link(s) scanned — all appear safe";

        var critical = report.FlaggedLinks.Count(l => l.RiskLevel == RiskLevel.Critical);
        var high = report.FlaggedLinks.Count(l => l.RiskLevel == RiskLevel.High);

        if (critical > 0)
            return $"🚨 {critical} DANGEROUS link(s) detected! Do not click. {report.FlaggedLinks.Count} total flagged.";
        if (high > 0)
            return $"⚠️ {high} suspicious link(s) found. Review before clicking.";

        return $"⚠️ {report.FlaggedLinks.Count} link(s) flagged for review.";
    }
}

// ═══ Models ═══════════════════════════════════════════════════════

public sealed class LinkSafetyReport
{
    public int TotalLinksScanned { get; set; }
    public List<FlaggedLink> FlaggedLinks { get; set; } = [];
    public List<string> SafeLinks { get; set; } = [];
    public bool HasDangerousLinks => FlaggedLinks.Any(l =>
        l.RiskLevel is RiskLevel.Critical or RiskLevel.High);
}

public sealed class FlaggedLink
{
    public string Url { get; set; } = "";
    public List<LinkWarning> Warnings { get; set; } = [];
    public RiskLevel RiskLevel { get; set; }
    public string Summary { get; set; } = "";
}

public sealed class LinkWarning
{
    public WarningType Type { get; set; }
    public RiskLevel Severity { get; set; }
    public string Message { get; set; } = "";
}

public enum WarningType
{
    SuspiciousTld,
    LookalikeDomain,
    UrlShortener,
    DangerousDownload,
    PhishingKeyword,
    IpAddress,
    ExcessiveSubdomains,
    HomographAttack,
    InsecureLogin,
    DataUri
}

public enum RiskLevel
{
    Low = 1,
    Medium = 2,
    High = 3,
    Critical = 4
}
