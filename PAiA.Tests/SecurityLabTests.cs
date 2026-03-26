using PAiA.WinUI.Services.Privacy;
using PAiA.WinUI.Services.Redaction;
using PAiA.WinUI.Services.SecurityLab;
using PAiA.WinUI.Services.SecurityLab.Simulator;
using PAiA.WinUI.Services.SecurityLab.ThreatIntel;
using Xunit;

namespace PAiA.Tests;

public class AttackSimulatorTests
{
    private AttackSimulator CreateSimulator()
    {
        var kb = new ThreatKnowledgeBase();
        var guard = new PrivacyGuard();
        var redact = new RedactionService();
        var custom = new CustomRedactionRules();
        return new AttackSimulator(kb, guard, redact, custom);
    }

    [Fact]
    public async Task FullSuite_Runs_WithoutCrashing()
    {
        var sim = CreateSimulator();
        var report = await sim.RunFullSuiteAsync();

        Assert.NotNull(report);
        Assert.True(report.TotalTests > 30, $"Expected 30+ tests, got {report.TotalTests}");
        Assert.True(report.SecurityScore >= 0 && report.SecurityScore <= 100);
    }

    [Fact]
    public async Task FullSuite_CatchesMostThings()
    {
        var sim = CreateSimulator();
        var report = await sim.RunFullSuiteAsync();

        // Most tests should pass — our defenses are solid
        var passRate = (double)report.Passed / report.TotalTests;
        Assert.True(passRate >= 0.7, $"Pass rate {passRate:P} is too low — defenses may be broken");
    }

    [Fact]
    public async Task ExternalUrls_AllBlocked()
    {
        var sim = CreateSimulator();
        var report = await sim.RunFullSuiteAsync();

        var netBlocks = report.Results
            .Where(r => r.ThreatId == "NET-EXTERNAL-BLOCK")
            .ToList();

        Assert.NotEmpty(netBlocks);
        Assert.All(netBlocks, r => Assert.True(r.Passed, $"Failed to block: {r.Details}"));
    }

    [Fact]
    public async Task LocalhostUrls_AllAllowed()
    {
        var sim = CreateSimulator();
        var report = await sim.RunFullSuiteAsync();

        var netAllows = report.Results
            .Where(r => r.ThreatId == "NET-LOCALHOST-ALLOW")
            .ToList();

        Assert.NotEmpty(netAllows);
        Assert.All(netAllows, r => Assert.True(r.Passed, $"Blocked localhost: {r.Details}"));
    }

    [Fact]
    public async Task CommonPii_AllCaught()
    {
        var sim = CreateSimulator();
        var report = await sim.RunFullSuiteAsync();

        var redactCatches = report.Results
            .Where(r => r.ThreatId == "REDACT-CATCH")
            .ToList();

        Assert.NotEmpty(redactCatches);
        var catchRate = (double)redactCatches.Count(r => r.Passed) / redactCatches.Count;
        Assert.True(catchRate >= 0.8, $"PII catch rate {catchRate:P} is too low");
    }

    [Fact]
    public async Task NoFalsePositives()
    {
        var sim = CreateSimulator();
        var report = await sim.RunFullSuiteAsync();

        var noFp = report.Results
            .Where(r => r.ThreatId == "REDACT-NO-FP")
            .ToList();

        Assert.NotEmpty(noFp);
        Assert.All(noFp, r => Assert.True(r.Passed, $"False positive: {r.Details}"));
    }

    [Fact]
    public async Task Report_HasSummary()
    {
        var sim = CreateSimulator();
        var report = await sim.RunFullSuiteAsync();
        var summary = report.ToSummary();

        Assert.Contains("Security Simulation Report", summary);
        Assert.Contains("Score:", summary);
    }

    [Fact]
    public void RunCategory_Works()
    {
        var sim = CreateSimulator();
        var report = sim.RunCategory(ThreatCategory.NetworkBypass);
        Assert.True(report.TotalTests > 0);
    }
}

public class SecurityLabOrchestratorTests
{
    [Fact]
    public void Initialize_LoadsThreats()
    {
        var guard = new PrivacyGuard();
        var redact = new RedactionService();
        var custom = new CustomRedactionRules();
        var lab = new SecurityLabOrchestrator(guard, redact, custom);

        lab.Initialize();
        Assert.True(lab.KnowledgeBase.Threats.Count >= 15);
    }

    [Fact]
    public async Task FullAudit_ProducesDashboard()
    {
        var guard = new PrivacyGuard();
        var redact = new RedactionService();
        var custom = new CustomRedactionRules();
        var lab = new SecurityLabOrchestrator(guard, redact, custom);
        lab.Initialize();

        var dashboard = await lab.RunFullAuditAsync();

        Assert.True(dashboard.TotalKnownThreats >= 15);
        Assert.True(dashboard.OverallHealth >= 0 && dashboard.OverallHealth <= 100);
        Assert.True(dashboard.LastSimulationScore >= 0);
    }

    [Fact]
    public void ProactiveHardening_AddsRules()
    {
        var guard = new PrivacyGuard();
        var redact = new RedactionService();
        var custom = new CustomRedactionRules();
        var lab = new SecurityLabOrchestrator(guard, redact, custom);
        lab.Initialize();

        var report = lab.RunProactiveHardening();
        Assert.True(report.AutoFixesApplied > 0, "Expected proactive hardening to add rules");
    }

    [Fact]
    public void GetSummaryText_Readable()
    {
        var guard = new PrivacyGuard();
        var redact = new RedactionService();
        var custom = new CustomRedactionRules();
        var lab = new SecurityLabOrchestrator(guard, redact, custom);
        lab.Initialize();

        var summary = lab.GetSummaryText();
        Assert.Contains("SecurityLab Dashboard", summary);
        Assert.Contains("Threat Intelligence", summary);
        Assert.Contains("Runtime Monitor", summary);
    }

    [Fact]
    public void Dispose_DoesNotThrow()
    {
        var guard = new PrivacyGuard();
        var redact = new RedactionService();
        var custom = new CustomRedactionRules();
        var lab = new SecurityLabOrchestrator(guard, redact, custom);
        lab.Initialize();
        lab.Dispose(); // Should not throw
    }
}
