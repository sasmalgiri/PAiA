using PAiA.WinUI.Services.Redaction;
using PAiA.WinUI.Services.ScreenIntel;

namespace PAiA.WinUI.Services.WebSearch;

/// <summary>
/// Strips PII from search queries BEFORE they go online.
/// 
/// This is the privacy gate between PAiA's local world and the internet.
/// The LLM generates a search query from screen context — that query
/// might contain names, emails, internal project names, etc.
/// This sanitizer scrubs everything sensitive before the query leaves.
/// 
/// WHAT GOES ONLINE: "fix error CS0246 WinUI 3 .NET 8"
/// WHAT NEVER GOES ONLINE: "John Smith's project Falcon got error CS0246"
/// </summary>
public sealed class SearchQuerySanitizer
{
    private readonly RedactionService _redact;
    private readonly CustomRedactionRules _customRedact;
    private readonly NerService _ner;

    public SearchQuerySanitizer(RedactionService redact, CustomRedactionRules customRedact, NerService ner)
    {
        _redact = redact;
        _customRedact = customRedact;
        _ner = ner;
    }

    /// <summary>
    /// Sanitizes a search query by running all 3 redaction layers,
    /// then removing redaction tags to produce a clean query.
    /// </summary>
    public SanitizedQuery Sanitize(string rawQuery)
    {
        if (string.IsNullOrWhiteSpace(rawQuery))
            return new SanitizedQuery { Original = rawQuery ?? "", Sanitized = "", WasModified = false };

        var result = new SanitizedQuery { Original = rawQuery };

        // Layer 1: Custom rules
        var step1 = _customRedact.Apply(rawQuery);

        // Layer 2: Regex patterns
        var step2 = _redact.Redact(step1);

        // Layer 3: NER
        var entities = _ner.DetectEntities(step2);
        var step3 = _ner.RedactEntities(step2, entities);

        // Remove redaction tags to make a clean search query
        // "[EMAIL-REDACTED]" → removed, not sent as search term
        var cleaned = System.Text.RegularExpressions.Regex.Replace(
            step3, @"\[[A-Z\-]+REDACTED\]", " ");

        // Collapse multiple spaces
        cleaned = System.Text.RegularExpressions.Regex.Replace(cleaned.Trim(), @"\s+", " ");

        result.Sanitized = cleaned;
        result.WasModified = cleaned != rawQuery;
        result.ItemsRemoved = _redact.CountMatches(rawQuery) + entities.Count;

        return result;
    }

    /// <summary>
    /// Asks the LLM to generate a search query from screen context.
    /// The LLM sees the redacted screen text and produces a focused query.
    /// </summary>
    public static string BuildSearchPrompt(string userQuestion, string contextType)
    {
        return $"""
            The user is looking at a {contextType} on their screen and asked: "{userQuestion}"
            
            Generate a SHORT web search query (5-10 words max) to find the answer.
            Return ONLY the search query, nothing else.
            Do NOT include any personal names, emails, company names, or sensitive data.
            Focus on the technical question, error code, or topic.
            """;
    }
}

public sealed class SanitizedQuery
{
    public string Original { get; set; } = "";
    public string Sanitized { get; set; } = "";
    public bool WasModified { get; set; }
    public int ItemsRemoved { get; set; }
}
