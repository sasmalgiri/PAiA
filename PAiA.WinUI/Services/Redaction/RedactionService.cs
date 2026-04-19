using System.Text.RegularExpressions;

namespace PAiA.WinUI.Services.Redaction;

/// <summary>
/// Redacts personally identifiable information from OCR text before
/// it reaches the LLM. All patterns run locally — nothing is transmitted.
/// </summary>
public sealed partial class RedactionService
{
    private static readonly (Regex pattern, string replacement)[] Patterns =
    [
        (CreditCard(),      "[CARD-REDACTED]"),
        (Ssn(),             "[SSN-REDACTED]"),
        (Email(),           "[EMAIL-REDACTED]"),
        (Phone(),           "[PHONE-REDACTED]"),
        (IpAddress(),       "[IP-REDACTED]"),
        (AwsKey(),          "[AWS-KEY-REDACTED]"),
        (GithubToken(),     "[GITHUB-TOKEN-REDACTED]"),
        (GenericApiKey(),   "[API-KEY-REDACTED]"),
        (JwtToken(),        "[JWT-REDACTED]"),
        (PrivateKey(),      "[PRIVATE-KEY-REDACTED]"),
        (ConnectionString(),"[CONN-STRING-REDACTED]"),
    ];

    /// <summary>
    /// Returns a redacted copy of the input text.
    /// </summary>
    public string Redact(string text)
    {
        if (string.IsNullOrEmpty(text)) return text ?? "";
        var result = text;
        foreach (var (pattern, replacement) in Patterns)
            result = pattern.Replace(result, replacement);
        return result;
    }

    /// <summary>
    /// Returns the count of PII matches found (before redaction).
    /// </summary>
    public int CountMatches(string text)
    {
        if (string.IsNullOrEmpty(text)) return 0;
        return Patterns.Sum(p => p.pattern.Matches(text).Count);
    }

    // ─── Compiled regex patterns ───────────────────────────────────

    [GeneratedRegex(@"\b(?:\d[ -]*?){13,19}\b")]
    private static partial Regex CreditCard();

    [GeneratedRegex(@"\b\d{3}-\d{2}-\d{4}\b")]
    private static partial Regex Ssn();

    [GeneratedRegex(@"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b")]
    private static partial Regex Email();

    [GeneratedRegex(@"\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b")]
    private static partial Regex Phone();

    [GeneratedRegex(@"\b(?:\d{1,3}\.){3}\d{1,3}\b")]
    private static partial Regex IpAddress();

    [GeneratedRegex(@"\bAKIA[0-9A-Z]{16}\b")]
    private static partial Regex AwsKey();

    [GeneratedRegex(@"\bgh[ps]_[A-Za-z0-9_]{36,255}\b")]
    private static partial Regex GithubToken();

    [GeneratedRegex(@"(?i)(?:api[_-]?key|apikey|secret[_-]?key|access[_-]?token)\s*[:=]\s*[""']?[\w\-]{20,}[""']?")]
    private static partial Regex GenericApiKey();

    [GeneratedRegex(@"\beyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_.+/=]+\b")]
    private static partial Regex JwtToken();

    [GeneratedRegex(@"-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA )?PRIVATE KEY-----")]
    private static partial Regex PrivateKey();

    [GeneratedRegex(@"(?i)(?:server|data source|host)=[^;]+;.*(?:password|pwd)=[^;]+", RegexOptions.Singleline)]
    private static partial Regex ConnectionString();
}
