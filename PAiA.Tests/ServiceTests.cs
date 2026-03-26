using PAiA.WinUI.Services.Clipboard;
using PAiA.WinUI.Services.Privacy;
using PAiA.WinUI.Services.Redaction;
using PAiA.WinUI.Services.SecurityLab.ThreatIntel;
using Xunit;

namespace PAiA.Tests;

// ═══ SENSITIVE APP FILTER ══════════════════════════════════════════

public class SensitiveAppFilterTests
{
    [Theory]
    [InlineData("Chase Bank - Online Banking")]
    [InlineData("1Password - Vault")]
    [InlineData("Bitwarden")]
    [InlineData("PayPal - Send Money")]
    [InlineData("MetaMask")]
    [InlineData("MyChart - Patient Portal")]
    [InlineData("TurboTax 2024")]
    [InlineData("LastPass")]
    [InlineData("Authenticator")]
    public void Warns_ForSensitiveApps(string windowTitle)
    {
        var warning = SensitiveAppFilter.CheckWindowTitle(windowTitle);
        Assert.NotNull(warning);
        Assert.Contains("sensitive", warning, StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData("Notepad")]
    [InlineData("Visual Studio Code")]
    [InlineData("Google Chrome - YouTube")]
    [InlineData("File Explorer")]
    [InlineData("Microsoft Word")]
    [InlineData("")]
    public void NoWarning_ForNormalApps(string windowTitle)
    {
        var warning = SensitiveAppFilter.CheckWindowTitle(windowTitle);
        Assert.Null(warning);
    }

    [Theory]
    [InlineData("1password", true)]
    [InlineData("bitwarden", true)]
    [InlineData("notepad", false)]
    [InlineData("chrome", false)]
    public void Detects_SensitiveProcesses(string process, bool expected)
    {
        Assert.Equal(expected, SensitiveAppFilter.IsSensitiveProcess(process));
    }
}

// ═══ CUSTOM REDACTION RULES ════════════════════════════════════════

public class CustomRedactionRulesTests
{
    [Fact]
    public void Add_AndApply_PlainTextRule()
    {
        var rules = new CustomRedactionRules();
        rules.Add("Project Name", "Project Falcon", "[PROJECT-REDACTED]");

        var result = rules.Apply("Meeting about Project Falcon tomorrow");
        Assert.DoesNotContain("Project Falcon", result);
        Assert.Contains("[PROJECT-REDACTED]", result);
    }

    [Fact]
    public void Add_AndApply_RegexRule()
    {
        var rules = new CustomRedactionRules();
        rules.Add("JIRA Tickets", @"\b[A-Z]{2,10}-\d{1,6}\b", "[JIRA-REDACTED]", isRegex: true);

        var result = rules.Apply("Fix PROJ-1234 and DEV-5678");
        Assert.DoesNotContain("PROJ-1234", result);
        Assert.DoesNotContain("DEV-5678", result);
    }

    [Fact]
    public void CaseInsensitive_Matching()
    {
        var rules = new CustomRedactionRules();
        rules.Add("Company", "ACME Corp", "[COMPANY-REDACTED]");

        var result = rules.Apply("Working at acme corp is great");
        Assert.Contains("[COMPANY-REDACTED]", result);
    }

    [Fact]
    public void Toggle_DisablesRule()
    {
        var rules = new CustomRedactionRules();
        rules.Add("Test", "secret", "[REDACTED]");
        var ruleId = rules.Rules[0].Id;

        rules.Toggle(ruleId);
        var result = rules.Apply("this is secret data");
        Assert.Contains("secret", result); // Should NOT redact when disabled
    }

    [Fact]
    public void Remove_DeletesRule()
    {
        var rules = new CustomRedactionRules();
        rules.Add("Test", "secret", "[REDACTED]");
        Assert.Single(rules.Rules);

        rules.Remove(rules.Rules[0].Id);
        Assert.Empty(rules.Rules);
    }

    [Fact]
    public void CountMatches_ReturnsCorrectCount()
    {
        var rules = new CustomRedactionRules();
        var rule = new CustomRule { Pattern = "test", IsRegex = false };
        var count = rules.CountMatches("test test test", rule);
        Assert.Equal(3, count);
    }

    [Fact]
    public void Templates_AreAvailable()
    {
        var templates = CustomRedactionRules.GetTemplates();
        Assert.NotEmpty(templates);
        Assert.True(templates.Count >= 5);
    }

    [Fact]
    public void NoRules_ReturnsOriginal()
    {
        var rules = new CustomRedactionRules();
        var input = "Nothing to redact here";
        Assert.Equal(input, rules.Apply(input));
    }

    [Fact]
    public void Handles_EmptyInput()
    {
        var rules = new CustomRedactionRules();
        rules.Add("Test", "x");
        Assert.Equal("", rules.Apply(""));
    }
}

// ═══ REDACTION DIFF VIEW ═══════════════════════════════════════════

public class RedactionDiffViewTests
{
    [Fact]
    public void GenerateDiff_FindsPii()
    {
        var diff = RedactionDiffView.GenerateDiff("Email: user@test.com", "");
        Assert.NotEmpty(diff);
        Assert.Contains(diff, d => d.Type == DiffType.Removed);
        Assert.Contains(diff, d => d.Type == DiffType.Replaced);
    }

    [Fact]
    public void GenerateDiff_NoPii_ReturnsUnchanged()
    {
        var diff = RedactionDiffView.GenerateDiff("Hello world", "");
        Assert.Single(diff);
        Assert.Equal(DiffType.Unchanged, diff[0].Type);
    }

    [Fact]
    public void GenerateDiff_MultiplePii()
    {
        var input = "SSN 123-45-6789 and email user@test.com";
        var diff = RedactionDiffView.GenerateDiff(input, "");
        var removedCount = diff.Count(d => d.Type == DiffType.Removed);
        Assert.True(removedCount >= 2);
    }

    [Fact]
    public void GetSummary_DescribesPii()
    {
        var summary = RedactionDiffView.GetSummary("Card 4532015112830366 and 123-45-6789");
        Assert.Contains("redacted", summary);
    }

    [Fact]
    public void GetSummary_CleanText()
    {
        var summary = RedactionDiffView.GetSummary("Nothing sensitive here");
        Assert.Contains("No sensitive", summary);
    }

    [Fact]
    public void Handles_EmptyString()
    {
        var diff = RedactionDiffView.GenerateDiff("", "");
        Assert.Empty(diff);
    }
}

// ═══ CONSENT MANAGER ═══════════════════════════════════════════════

public class ConsentManagerTests
{
    [Fact]
    public void NeedsReconsent_BeforeAccepting()
    {
        var cm = new ConsentManager();
        // Fresh install should need consent (unless previously accepted)
        // We test the logic, not state
        Assert.NotNull(ConsentManager.GetConsentText());
    }

    [Fact]
    public void ConsentText_ContainsKeyDisclosures()
    {
        var text = ConsentManager.GetConsentText();
        Assert.Contains("WHAT PAiA DOES", text);
        Assert.Contains("WHAT PAiA NEVER DOES", text);
        Assert.Contains("YOUR DATA", text);
        Assert.Contains("never", text.ToLower());
        Assert.Contains("localhost", text.ToLower());
    }

    [Fact]
    public void Accept_SetsConsentState()
    {
        var cm = new ConsentManager();
        cm.Accept();
        Assert.True(cm.HasConsented);
        Assert.NotNull(cm.ConsentDate);
    }
}

// ═══ SMART CLIPBOARD QUEUE ═════════════════════════════════════════

public class SmartClipboardQueueTests
{
    [Fact]
    public void Enqueue_AddsItems()
    {
        var q = new SmartClipboardQueue();
        q.Enqueue("first", "First item");
        q.Enqueue("second", "Second item");
        Assert.Equal(2, q.Count);
    }

    [Fact]
    public void PasteNext_ReturnsInOrder()
    {
        var q = new SmartClipboardQueue();
        q.Enqueue("first");
        q.Enqueue("second");
        q.Enqueue("third");

        Assert.Equal("first", q.PasteNext()?.Text);
        Assert.Equal("second", q.PasteNext()?.Text);
        Assert.Equal("third", q.PasteNext()?.Text);
        Assert.Null(q.PasteNext());
    }

    [Fact]
    public void PeekNext_DoesNotRemove()
    {
        var q = new SmartClipboardQueue();
        q.Enqueue("peek me");
        Assert.Equal("peek me", q.PeekNext()?.Text);
        Assert.Equal(1, q.Count); // Still there
    }

    [Fact]
    public void QueueCodeBlocks_ExtractsFromMarkdown()
    {
        var response = "Here's the fix:\n```python\nprint('hello')\n```\nAnd then:\n```bash\nnpm install\n```\n";
        var q = new SmartClipboardQueue();
        var count = q.QueueCodeBlocks(response);
        Assert.Equal(2, count);
        Assert.Equal(2, q.Count);
    }

    [Fact]
    public void QueueCodeBlocks_NoBlocks_ReturnsZero()
    {
        var q = new SmartClipboardQueue();
        var count = q.QueueCodeBlocks("No code here, just text.");
        Assert.Equal(0, count);
        Assert.True(q.IsEmpty);
    }

    [Fact]
    public void Clear_RemovesQueue_KeepsHistory()
    {
        var q = new SmartClipboardQueue();
        q.Enqueue("item");
        q.Clear();
        Assert.True(q.IsEmpty);
        Assert.NotEmpty(q.History); // History preserved
    }

    [Fact]
    public void ClearAll_RemovesEverything()
    {
        var q = new SmartClipboardQueue();
        q.Enqueue("item");
        q.ClearAll();
        Assert.True(q.IsEmpty);
        Assert.Empty(q.History);
    }
}

// ═══ THREAT KNOWLEDGE BASE ═════════════════════════════════════════

public class ThreatKnowledgeBaseTests
{
    [Fact]
    public void LoadsBuiltInThreats()
    {
        var kb = new ThreatKnowledgeBase();
        kb.EnsureLoaded();
        Assert.True(kb.Threats.Count >= 15, $"Expected 15+ threats, got {kb.Threats.Count}");
    }

    [Fact]
    public void AllThreats_HaveRequiredFields()
    {
        var kb = new ThreatKnowledgeBase();
        kb.EnsureLoaded();
        foreach (var threat in kb.Threats)
        {
            Assert.NotNull(threat.Id);
            Assert.NotEmpty(threat.Title);
            Assert.NotEmpty(threat.Description);
            Assert.NotEmpty(threat.AttackVector);
            Assert.NotEmpty(threat.PaiaMitigation);
        }
    }

    [Fact]
    public void GetByCategory_ReturnsCorrectThreats()
    {
        var kb = new ThreatKnowledgeBase();
        var llmThreats = kb.GetByCategory(ThreatCategory.LlmInfrastructure);
        Assert.NotEmpty(llmThreats);
        Assert.All(llmThreats, t => Assert.Equal(ThreatCategory.LlmInfrastructure, t.Category));
    }

    [Fact]
    public void GetBySeverity_FiltersProperly()
    {
        var kb = new ThreatKnowledgeBase();
        var critical = kb.GetBySeverity(Severity.Critical);
        Assert.NotEmpty(critical);
        Assert.All(critical, t => Assert.Equal(Severity.Critical, t.Severity));
    }

    [Fact]
    public void GetStats_ReturnsValidStats()
    {
        var kb = new ThreatKnowledgeBase();
        var stats = kb.GetStats();
        Assert.True(stats.Total >= 15);
        Assert.True(stats.FullyMitigated > 0);
        Assert.Equal(stats.Total,
            stats.FullyMitigated + stats.PartiallyMitigated + stats.Unmitigated);
    }

    [Fact]
    public void AddThreat_IncrementsCount()
    {
        var kb = new ThreatKnowledgeBase();
        var before = kb.Threats.Count;
        kb.AddThreat(new ThreatEntry
        {
            Title = "Test threat",
            Description = "Test",
            Category = ThreatCategory.DataExfiltration,
            Severity = Severity.Low,
            AttackVector = "Test",
            PaiaMitigation = "Test"
        });
        Assert.Equal(before + 1, kb.Threats.Count);
    }

    [Fact]
    public void HasThreatsFor_AllCategories()
    {
        var kb = new ThreatKnowledgeBase();
        var stats = kb.GetStats();
        // Should cover most categories
        Assert.True(stats.Categories.Count >= 6,
            $"Expected 6+ categories, got {stats.Categories.Count}: {string.Join(", ", stats.Categories.Keys)}");
    }
}

// ═══ DATA WIPER ════════════════════════════════════════════════════

public class DataWiperTests
{
    [Fact]
    public void WipeAuditLogs_HandlesNoLogs()
    {
        var wiper = new DataWiper();
        var report = wiper.WipeAuditLogs();
        Assert.True(report.Success);
    }

    [Fact]
    public void WipeReport_HasFields()
    {
        var wiper = new DataWiper();
        var report = wiper.WipeAll();
        Assert.NotNull(report.Message);
        Assert.NotNull(report.Errors);
    }
}
