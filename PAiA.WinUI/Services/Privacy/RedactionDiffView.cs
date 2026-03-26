using System.Text.RegularExpressions;

namespace PAiA.WinUI.Services.Privacy;

/// <summary>
/// Generates a visual diff showing exactly what was redacted.
/// Users see their original text with PII highlighted in red,
/// replaced by [REDACTED] tags. This is VISIBLE PROOF — the feature
/// that makes people actually trust the app.
/// 
/// Returns structured diff segments, not just a string.
/// The UI renders these with red highlighting for removed items.
/// </summary>
public sealed class RedactionDiffView
{
    /// <summary>
    /// Produces a list of diff segments showing what changed.
    /// </summary>
    public static List<DiffSegment> GenerateDiff(string original, string redacted)
    {
        var segments = new List<DiffSegment>();

        if (string.IsNullOrEmpty(original))
            return segments;

        // Find all PII matches and their positions in the original
        var matches = FindPiiMatches(original);

        if (matches.Count == 0)
        {
            segments.Add(new DiffSegment(original, DiffType.Unchanged));
            return segments;
        }

        // Sort by position and build diff
        matches.Sort((a, b) => a.start.CompareTo(b.start));

        int lastEnd = 0;
        foreach (var (start, end, type) in matches)
        {
            // Add unchanged text before this match
            if (start > lastEnd)
            {
                segments.Add(new DiffSegment(
                    original[lastEnd..start], DiffType.Unchanged));
            }

            // Add the redacted PII
            var originalPii = original[start..end];
            var masked = MaskForDisplay(originalPii, type);

            segments.Add(new DiffSegment(originalPii, DiffType.Removed, type));
            segments.Add(new DiffSegment(masked, DiffType.Replaced, type));

            lastEnd = end;
        }

        // Add remaining unchanged text
        if (lastEnd < original.Length)
        {
            segments.Add(new DiffSegment(
                original[lastEnd..], DiffType.Unchanged));
        }

        return segments;
    }

    /// <summary>
    /// Returns a summary: "3 items redacted: 1 email, 1 credit card, 1 phone number"
    /// </summary>
    public static string GetSummary(string original)
    {
        var matches = FindPiiMatches(original);
        if (matches.Count == 0) return "No sensitive items detected.";

        var counts = matches.GroupBy(m => m.type)
            .Select(g => $"{g.Count()} {g.Key.ToLower()}")
            .ToList();

        return $"{matches.Count} item{(matches.Count != 1 ? "s" : "")} redacted: {string.Join(", ", counts)}";
    }

    /// <summary>
    /// Creates a user-safe masked version for display.
    /// Shows enough to recognize the type but not the actual data.
    /// e.g., "4532****1234" for a card, "j***@gmail.com" for email
    /// </summary>
    private static string MaskForDisplay(string pii, string type)
    {
        return type switch
        {
            "CARD" => pii.Length >= 8
                ? pii[..4] + new string('*', pii.Length - 8) + pii[^4..]
                : "[CARD-REDACTED]",
            "EMAIL" => pii.Contains('@')
                ? pii[0] + "***@" + pii[(pii.IndexOf('@') + 1)..]
                : "[EMAIL-REDACTED]",
            "SSN" => "***-**-" + (pii.Length >= 4 ? pii[^4..] : "****"),
            "PHONE" => pii.Length >= 4
                ? new string('*', pii.Length - 4) + pii[^4..]
                : "[PHONE-REDACTED]",
            "IP" => "[IP-REDACTED]",
            "JWT" => "eyJ***[TOKEN-REDACTED]",
            _ => $"[{type}-REDACTED]"
        };
    }

    private static List<(int start, int end, string type)> FindPiiMatches(string text)
    {
        var matches = new List<(int start, int end, string type)>();
        var patterns = new (string pattern, string type)[]
        {
            (@"\b(?:\d[ -]*?){13,19}\b", "CARD"),
            (@"\b\d{3}-\d{2}-\d{4}\b", "SSN"),
            (@"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b", "EMAIL"),
            (@"\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b", "PHONE"),
            (@"\b(?:\d{1,3}\.){3}\d{1,3}\b", "IP"),
            (@"\bAKIA[0-9A-Z]{16}\b", "AWS-KEY"),
            (@"\bgh[ps]_[A-Za-z0-9_]{36,255}\b", "GITHUB-TOKEN"),
            (@"\beyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_.+/=]+\b", "JWT"),
        };

        foreach (var (pattern, type) in patterns)
        {
            foreach (Match m in Regex.Matches(text, pattern))
            {
                // Avoid overlapping matches
                bool overlaps = matches.Any(existing =>
                    m.Index < existing.end && m.Index + m.Length > existing.start);
                if (!overlaps)
                    matches.Add((m.Index, m.Index + m.Length, type));
            }
        }

        return matches;
    }
}

/// <summary>
/// A single segment in a redaction diff.
/// </summary>
public sealed record DiffSegment(string Text, DiffType Type, string? PiiType = null);

public enum DiffType
{
    Unchanged,  // Normal text — render as-is
    Removed,    // Original PII — render with red strikethrough
    Replaced    // Masked replacement — render with green highlight
}
