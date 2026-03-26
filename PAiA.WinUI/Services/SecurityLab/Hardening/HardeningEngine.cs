using PAiA.WinUI.Services.Redaction;
using PAiA.WinUI.Services.SecurityLab.Simulator;
using PAiA.WinUI.Services.SecurityLab.ThreatIntel;

namespace PAiA.WinUI.Services.SecurityLab.Hardening;

/// <summary>
/// Automatic security hardening engine. Takes simulation results and
/// threat intelligence, then applies fixes that don't require code changes.
/// 
/// What it can fix at runtime:
/// - Add missing redaction patterns discovered by mutation tests
/// - Tighten endpoint validation rules
/// - Enable additional monitoring for detected weakness areas
/// - Generate security recommendations for issues requiring code changes
/// 
/// What requires manual fixes (generates recommendations):
/// - Memory locking (VirtualLock)
/// - Audit log encryption
/// - New capture API restrictions
/// - Model safety filtering
/// </summary>
public sealed class HardeningEngine
{
    private readonly ThreatKnowledgeBase _kb;
    private readonly CustomRedactionRules _customRedact;
    private readonly List<HardeningAction> _appliedActions = [];
    private readonly List<HardeningRecommendation> _recommendations = [];

    public IReadOnlyList<HardeningAction> AppliedActions => _appliedActions;
    public IReadOnlyList<HardeningRecommendation> Recommendations => _recommendations;

    public HardeningEngine(ThreatKnowledgeBase kb, CustomRedactionRules customRedact)
    {
        _kb = kb;
        _customRedact = customRedact;
    }

    /// <summary>
    /// Analyzes simulation results and applies all possible automatic fixes.
    /// Returns a hardening report.
    /// </summary>
    public HardeningReport ApplyFromSimulation(SimulationReport simReport)
    {
        _appliedActions.Clear();
        _recommendations.Clear();

        foreach (var failure in simReport.Failures)
        {
            AnalyzeAndFix(failure);
        }

        // Also analyze unmitigated threats from KB
        foreach (var threat in _kb.GetUnmitigated())
        {
            GenerateRecommendation(threat);
        }

        return new HardeningReport
        {
            GeneratedAt = DateTimeOffset.Now,
            SimulationScore = simReport.SecurityScore,
            AutoFixesApplied = _appliedActions.Count,
            ManualRecommendations = _recommendations.Count,
            Actions = [.. _appliedActions],
            Recommendations = [.. _recommendations],
            NewScore = EstimateNewScore(simReport)
        };
    }

    /// <summary>
    /// Runs proactive hardening based on threat intelligence alone
    /// (without needing a simulation run first).
    /// </summary>
    public HardeningReport ApplyProactive()
    {
        _appliedActions.Clear();
        _recommendations.Clear();

        // Auto-add common redaction patterns users might miss
        EnsureCommonRedactionRules();

        // Generate recommendations for all partially/unmitigated threats
        foreach (var threat in _kb.Threats.Where(t =>
            t.MitigationStatus != MitigationStatus.FullyMitigated))
        {
            GenerateRecommendation(threat);
        }

        return new HardeningReport
        {
            GeneratedAt = DateTimeOffset.Now,
            AutoFixesApplied = _appliedActions.Count,
            ManualRecommendations = _recommendations.Count,
            Actions = [.. _appliedActions],
            Recommendations = [.. _recommendations]
        };
    }

    // ─── Auto-fix logic ────────────────────────────────────────────

    private void AnalyzeAndFix(SimulationResult failure)
    {
        var details = failure.Details.ToLowerInvariant();

        // Fix 1: Unicode PII bypass → add normalization rule
        if (details.Contains("unicode") && details.Contains("missed"))
        {
            AddRedactionRule(
                "Unicode normalization",
                @"[＠＃＄％＆]",
                "[UNICODE-CHAR-REDACTED]",
                isRegex: true,
                "Auto-added by SecurityLab: Unicode PII bypass detected in simulation"
            );
        }

        // Fix 2: URL-encoded PII bypass
        if (details.Contains("url-encoded") && details.Contains("missed"))
        {
            AddRedactionRule(
                "URL-encoded email",
                @"\w+%40\w+%2E\w+",
                "[URL-ENCODED-EMAIL-REDACTED]",
                isRegex: true,
                "Auto-added: URL-encoded email bypass detected"
            );
        }

        // Fix 3: Encoded IP addresses
        if (details.Contains("encoded ip") && details.Contains("missed"))
        {
            AddRedactionRule(
                "Hex IP addresses",
                @"0x[0-9a-fA-F]{1,2}\.0x[0-9a-fA-F]{1,2}\.0x[0-9a-fA-F]{1,2}\.0x[0-9a-fA-F]{1,2}",
                "[HEX-IP-REDACTED]",
                isRegex: true,
                "Auto-added: Hex-encoded IP bypass detected"
            );
        }

        // Fix 4: Split PII across lines
        if (details.Contains("split across lines") && details.Contains("missed"))
        {
            _recommendations.Add(new HardeningRecommendation
            {
                Severity = Severity.High,
                Title = "Add line-joining pre-processing to redaction",
                Description = "PII split across OCR lines bypasses regex patterns. " +
                    "Add a pre-processing step that joins numeric sequences split by newlines before running redaction.",
                AffectedComponent = "RedactionService",
                ThreatId = "MUTATION-SPLIT-PII",
                Effort = "Medium — modify RedactionService.Redact() to normalize line breaks in numeric sequences"
            });
        }

        // Generic: any unhandled failure gets a recommendation
        if (!_appliedActions.Any(a => a.FailureDetails == failure.Details) &&
            !_recommendations.Any(r => r.ThreatId == failure.ThreatId))
        {
            _recommendations.Add(new HardeningRecommendation
            {
                Severity = Severity.Medium,
                Title = $"Investigate simulation failure: {failure.ThreatId}",
                Description = failure.Details,
                AffectedComponent = "SecurityLab",
                ThreatId = failure.ThreatId,
                Effort = "Review required"
            });
        }
    }

    private void GenerateRecommendation(ThreatEntry threat)
    {
        // Don't duplicate
        if (_recommendations.Any(r => r.ThreatId == threat.Id)) return;

        var rec = new HardeningRecommendation
        {
            Severity = threat.Severity,
            ThreatId = threat.Id ?? "UNKNOWN",
            Title = $"Mitigate: {threat.Title}",
            Description = threat.Description,
            AffectedComponent = threat.Category.ToString()
        };

        // Add specific fix suggestions based on threat
        rec.Effort = threat.Id switch
        {
            "CAPTURE-SWAP-LEAK" =>
                "High — implement VirtualLock() on bitmap memory to prevent page-out to swap file",
            "EXFIL-AUDIT-LOG" =>
                "Medium — encrypt audit logs at rest using Windows DPAPI (ProtectedData.Protect())",
            "EXFIL-CLIPBOARD" =>
                "Low — call Clipboard.ClearHistory() after setting content, opt out of clipboard history",
            "EXFIL-MEMORY-DUMP" =>
                "High — use SecureString for OCR text, implement explicit buffer clearing after use",
            "PROMPT-INJECT-INVISIBLE" =>
                "Medium — add OCR confidence threshold to discard low-confidence text (likely hidden/tiny)",
            "REDACT-CONTEXT-PII" =>
                "High — integrate NER model (e.g., spaCy or ONNX) for name/address detection",
            "AI-HALLUCINATE-HARMFUL" =>
                "Medium — add output safety filter that checks for dangerous commands (rm -rf, format, etc.)",
            _ => "Review required"
        };

        _recommendations.Add(rec);
    }

    /// <summary>
    /// Ensures commonly needed redaction rules exist.
    /// </summary>
    private void EnsureCommonRedactionRules()
    {
        var existingNames = _customRedact.Rules.Select(r => r.Name).ToHashSet();

        // Auto-add patterns that should always be there
        var essential = new (string name, string pattern, bool isRegex)[]
        {
            ("Indian Aadhaar numbers", @"\b\d{4}\s?\d{4}\s?\d{4}\b", true),
            ("Indian PAN numbers", @"\b[A-Z]{5}\d{4}[A-Z]\b", true),
            ("UK National Insurance", @"\b[A-Z]{2}\d{6}[A-D]\b", true),
            ("IBAN numbers", @"\b[A-Z]{2}\d{2}[A-Z0-9]{4,30}\b", true),
            ("Passport numbers", @"\b[A-Z]\d{7,8}\b", true),
        };

        foreach (var (name, pattern, isRegex) in essential)
        {
            if (!existingNames.Contains(name))
            {
                _customRedact.Add(name, pattern, isRegex: isRegex);
                _appliedActions.Add(new HardeningAction
                {
                    Type = HardeningActionType.AddRedactionRule,
                    Description = $"Added redaction rule: {name}",
                    FailureDetails = "Proactive hardening"
                });
            }
        }
    }

    private void AddRedactionRule(string name, string pattern, string replacement,
        bool isRegex, string reason)
    {
        // Don't add duplicates
        if (_customRedact.Rules.Any(r => r.Pattern == pattern)) return;

        _customRedact.Add(name, pattern, replacement, isRegex);
        _appliedActions.Add(new HardeningAction
        {
            Type = HardeningActionType.AddRedactionRule,
            Description = $"Added rule '{name}': {pattern} → {replacement}",
            FailureDetails = reason
        });
    }

    private int EstimateNewScore(SimulationReport original)
    {
        // Estimate score improvement from auto-fixes
        var fixedFailures = _appliedActions.Count;
        var remainingFailures = original.Failed - fixedFailures;
        if (original.TotalTests == 0) return 100;
        var newPassRate = (double)(original.Passed + fixedFailures) / original.TotalTests;
        return (int)(newPassRate * 100);
    }
}

// ═══ Models ═══════════════════════════════════════════════════════

public sealed class HardeningAction
{
    public HardeningActionType Type { get; set; }
    public string Description { get; set; } = "";
    public string FailureDetails { get; set; } = "";
    public DateTimeOffset AppliedAt { get; set; } = DateTimeOffset.Now;
}

public enum HardeningActionType
{
    AddRedactionRule,
    TightenEndpoint,
    EnableMonitoring,
    UpdateConfig
}

public sealed class HardeningRecommendation
{
    public Severity Severity { get; set; }
    public string ThreatId { get; set; } = "";
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    public string AffectedComponent { get; set; } = "";
    public string Effort { get; set; } = "";
}

public sealed class HardeningReport
{
    public DateTimeOffset GeneratedAt { get; set; }
    public int SimulationScore { get; set; }
    public int NewScore { get; set; }
    public int AutoFixesApplied { get; set; }
    public int ManualRecommendations { get; set; }
    public List<HardeningAction> Actions { get; set; } = [];
    public List<HardeningRecommendation> Recommendations { get; set; } = [];

    public string ToSummary()
    {
        var sb = new System.Text.StringBuilder();
        sb.AppendLine("═══ PAiA Hardening Report ═══");
        sb.AppendLine($"Generated: {GeneratedAt:yyyy-MM-dd HH:mm:ss}");
        if (SimulationScore > 0)
            sb.AppendLine($"Score: {SimulationScore} → {NewScore} (+{NewScore - SimulationScore})");
        sb.AppendLine($"Auto-fixes applied: {AutoFixesApplied}");
        sb.AppendLine($"Manual recommendations: {ManualRecommendations}");

        if (Actions.Count > 0)
        {
            sb.AppendLine();
            sb.AppendLine("✅ AUTO-APPLIED:");
            foreach (var a in Actions)
                sb.AppendLine($"  • {a.Description}");
        }

        if (Recommendations.Count > 0)
        {
            sb.AppendLine();
            sb.AppendLine("📋 RECOMMENDATIONS:");
            foreach (var r in Recommendations.OrderByDescending(r => r.Severity))
                sb.AppendLine($"  [{r.Severity}] {r.Title} — {r.Effort}");
        }

        return sb.ToString();
    }
}
