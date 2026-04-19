using System.Text.RegularExpressions;

namespace PAiA.WinUI.Services.ScreenIntel;

/// <summary>
/// Named Entity Recognition service for detecting contextual PII
/// that regex patterns miss.
/// 
/// WHAT REGEX MISSES:
/// - Person names ("John Smith sent you a message")
/// - Street addresses ("123 Main St, Apt 4B, New York, NY 10001")
/// - Medical terms ("diagnosed with diabetes type 2")
/// - Financial figures in context ("salary: $85,000/year")
/// - Company-specific identifiers
/// 
/// APPROACH:
/// Phase 1 (current): Heuristic NER using pattern matching + dictionaries
/// Phase 2 (future):  ONNX Runtime with a trained NER model (e.g., distilbert-NER)
/// 
/// All processing is LOCAL — no cloud NER APIs.
/// </summary>
public sealed class NerService
{
    // Common name prefixes/titles that indicate a person name follows
    private static readonly string[] NamePrefixes =
        ["Mr.", "Mrs.", "Ms.", "Dr.", "Prof.", "Sir", "Madam"];

    // Pre-compiled name prefix patterns
    private static readonly Regex[] NamePrefixRegexes = NamePrefixes
        .Select(p => new Regex($@"\b{Regex.Escape(p)}\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){{1,3}})", RegexOptions.Compiled))
        .ToArray();
    private static readonly Regex AddressRegex = new(
        @"\b\d{1,5}\s+(?:[A-Z][a-z]+\s+){1,3}(?:St|Ave|Blvd|Dr|Ln|Rd|Ct|Way|Pl|Cir)\.?\b",
        RegexOptions.Compiled);
    private static readonly Regex CurrencyRegex = new(
        @"[\$€£₹¥]\s*\d{1,3}(?:,\d{3})*(?:\.\d{2})?\b(?:\s*(?:/\s*(?:year|month|hr|hour|week|day)|per\s+(?:year|month|hour|day|annum)))?",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex DobRegex = new(
        @"\b(?:0[1-9]|1[0-2])[/-](?:0[1-9]|[12]\d|3[01])[/-](?:19|20)\d{2}\b",
        RegexOptions.Compiled);

    // Contextual keywords that indicate PII follows
    private static readonly (string keyword, string entityType)[] ContextualPatterns =
    [
        ("name:", "PERSON_NAME"),
        ("patient:", "PERSON_NAME"),
        ("employee:", "PERSON_NAME"),
        ("from:", "PERSON_NAME"),
        ("to:", "PERSON_NAME"),
        ("cc:", "PERSON_NAME"),
        ("assigned to", "PERSON_NAME"),
        ("created by", "PERSON_NAME"),

        ("address:", "ADDRESS"),
        ("street:", "ADDRESS"),
        ("location:", "ADDRESS"),
        ("ship to:", "ADDRESS"),
        ("billing address:", "ADDRESS"),

        ("salary:", "FINANCIAL"),
        ("income:", "FINANCIAL"),
        ("balance:", "FINANCIAL"),
        ("amount:", "FINANCIAL"),
        ("payment:", "FINANCIAL"),
        ("price:", "FINANCIAL"),
        ("total:", "FINANCIAL"),

        ("diagnosis:", "MEDICAL"),
        ("condition:", "MEDICAL"),
        ("prescription:", "MEDICAL"),
        ("medication:", "MEDICAL"),
        ("allergies:", "MEDICAL"),

        ("dob:", "DATE_OF_BIRTH"),
        ("date of birth:", "DATE_OF_BIRTH"),
        ("born:", "DATE_OF_BIRTH"),

        ("account:", "ACCOUNT_NUMBER"),
        ("account number:", "ACCOUNT_NUMBER"),
        ("policy:", "ACCOUNT_NUMBER"),
        ("case:", "ACCOUNT_NUMBER"),
    ];

    /// <summary>
    /// Detects named entities in text using heuristic patterns.
    /// Returns entities with their positions and types.
    /// </summary>
    public List<NerEntity> DetectEntities(string text)
    {
        var entities = new List<NerEntity>();
        if (string.IsNullOrEmpty(text)) return entities;

        var lower = text.ToLowerInvariant();

        // Detect contextual PII (keyword: value patterns)
        foreach (var (keyword, entityType) in ContextualPatterns)
        {
            var idx = lower.IndexOf(keyword, StringComparison.Ordinal);
            while (idx >= 0)
            {
                var valueStart = idx + keyword.Length;
                var value = ExtractValueAfterKeyword(text, valueStart);
                if (!string.IsNullOrWhiteSpace(value) && value.Length >= 2)
                {
                    entities.Add(new NerEntity
                    {
                        Text = value.Trim(),
                        Type = entityType,
                        StartIndex = valueStart,
                        EndIndex = valueStart + value.Length,
                        Confidence = 0.7,
                        Source = "heuristic"
                    });
                }
                idx = lower.IndexOf(keyword, idx + keyword.Length, StringComparison.Ordinal);
            }
        }

        // Detect names with titles (Mr. John Smith)
        foreach (var nameRegex in NamePrefixRegexes)
        {
            foreach (Match m in nameRegex.Matches(text))
            {
                entities.Add(new NerEntity
                {
                    Text = m.Value,
                    Type = "PERSON_NAME",
                    StartIndex = m.Index,
                    EndIndex = m.Index + m.Length,
                    Confidence = 0.85,
                    Source = "title_pattern"
                });
            }
        }

        // Detect US street addresses
        foreach (Match m in AddressRegex.Matches(text))
        {
            entities.Add(new NerEntity
            {
                Text = m.Value,
                Type = "ADDRESS",
                StartIndex = m.Index,
                EndIndex = m.Index + m.Length,
                Confidence = 0.75,
                Source = "address_pattern"
            });
        }

        // Detect currency amounts in context
        foreach (Match m in CurrencyRegex.Matches(text))
        {
            entities.Add(new NerEntity
            {
                Text = m.Value,
                Type = "FINANCIAL",
                StartIndex = m.Index,
                EndIndex = m.Index + m.Length,
                Confidence = 0.8,
                Source = "currency_pattern"
            });
        }

        // Detect dates of birth patterns
        foreach (Match m in DobRegex.Matches(text))
        {
            entities.Add(new NerEntity
            {
                Text = m.Value,
                Type = "DATE_OF_BIRTH",
                StartIndex = m.Index,
                EndIndex = m.Index + m.Length,
                Confidence = 0.6, // Could be any date
                Source = "date_pattern"
            });
        }

        // Deduplicate overlapping entities (keep higher confidence)
        return DeduplicateEntities(entities);
    }

    /// <summary>
    /// Redacts detected entities from text.
    /// Only redacts entities above the confidence threshold.
    /// </summary>
    public string RedactEntities(string text, List<NerEntity> entities, double minConfidence = 0.6)
    {
        if (string.IsNullOrEmpty(text) || entities.Count == 0) return text ?? "";

        // Sort by position descending (so replacements don't shift indices)
        var toRedact = entities
            .Where(e => e.Confidence >= minConfidence)
            .OrderByDescending(e => e.StartIndex)
            .ToList();

        var result = text;
        foreach (var entity in toRedact)
        {
            if (entity.StartIndex >= 0 && entity.EndIndex <= result.Length &&
                entity.StartIndex < entity.EndIndex)
            {
                var replacement = $"[{entity.Type}-REDACTED]";
                result = result[..entity.StartIndex] + replacement + result[entity.EndIndex..];
                entity.IsRedacted = true;
            }
        }

        return result;
    }

    /// <summary>
    /// Extracts the value following a keyword (up to newline or next keyword).
    /// </summary>
    private static string ExtractValueAfterKeyword(string text, int startIndex)
    {
        if (startIndex >= text.Length) return "";

        // Skip leading whitespace
        var i = startIndex;
        while (i < text.Length && char.IsWhiteSpace(text[i]) && text[i] != '\n') i++;

        // Read until end of line or next obvious keyword
        var end = i;
        while (end < text.Length && text[end] != '\n' && text[end] != '\r')
        {
            // Stop at common delimiters
            if (end > i + 2 && (text[end] == '|' || text[end] == '\t'))
                break;
            end++;
        }

        var value = text[i..end];
        // Cap at reasonable length
        if (value.Length > 100) value = value[..100];
        return value;
    }

    /// <summary>
    /// Removes overlapping entities, keeping the one with higher confidence.
    /// </summary>
    private static List<NerEntity> DeduplicateEntities(List<NerEntity> entities)
    {
        if (entities.Count <= 1) return entities;

        var sorted = entities.OrderBy(e => e.StartIndex).ThenByDescending(e => e.Confidence).ToList();
        var result = new List<NerEntity> { sorted[0] };

        for (int i = 1; i < sorted.Count; i++)
        {
            var prev = result[^1];
            var curr = sorted[i];

            // If no overlap, add it
            if (curr.StartIndex >= prev.EndIndex)
                result.Add(curr);
            // If overlap, keep higher confidence
            else if (curr.Confidence > prev.Confidence)
                result[^1] = curr;
        }

        return result;
    }
}

/// <summary>
/// A detected named entity with position and classification.
/// </summary>
public sealed class NerEntity
{
    public string Text { get; set; } = "";
    public string Type { get; set; } = "";
    public int StartIndex { get; set; }
    public int EndIndex { get; set; }
    public double Confidence { get; set; }
    public string Source { get; set; } = "";
    public bool IsRedacted { get; set; }
}
