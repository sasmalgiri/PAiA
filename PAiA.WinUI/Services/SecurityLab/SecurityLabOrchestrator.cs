using PAiA.WinUI.Services.Privacy;
using PAiA.WinUI.Services.Redaction;
using PAiA.WinUI.Services.SecurityLab.Hardening;
using PAiA.WinUI.Services.SecurityLab.Monitor;
using PAiA.WinUI.Services.SecurityLab.Simulator;
using PAiA.WinUI.Services.SecurityLab.ThreatIntel;

namespace PAiA.WinUI.Services.SecurityLab;

/// <summary>
/// PAiA SecurityLab — the complete security immune system.
/// 
/// Architecture:
/// 
///   ThreatKnowledgeBase (memory)
///        ↕ learns from
///   AttackSimulator (testing)
///        ↓ feeds results to
///   HardeningEngine (auto-fix + recommendations)
///        ↓ applied at runtime by
///   RuntimeSecurityMonitor (continuous watch)
///        ↓ alerts feed back into
///   ThreatKnowledgeBase (knowledge grows)
/// 
/// Usage:
///   var lab = new SecurityLabOrchestrator(guard, redact, customRedact);
///   lab.Initialize();                          // Load KB + start monitor
///   var report = await lab.RunFullAuditAsync(); // Simulate + harden + report
///   lab.GetDashboard();                         // Real-time status
/// </summary>
public sealed class SecurityLabOrchestrator : IDisposable
{
    public ThreatKnowledgeBase KnowledgeBase { get; }
    public AttackSimulator Simulator { get; }
    public HardeningEngine Hardener { get; }
    public RuntimeSecurityMonitor Monitor { get; }

    private SimulationReport? _lastSimulation;
    private HardeningReport? _lastHardening;
    private bool _initialized;

    public SecurityLabOrchestrator(
        PrivacyGuard guard,
        RedactionService redact,
        CustomRedactionRules customRedact)
    {
        KnowledgeBase = new ThreatKnowledgeBase();
        Simulator = new AttackSimulator(KnowledgeBase, guard, redact, customRedact);
        Hardener = new HardeningEngine(KnowledgeBase, customRedact);
        Monitor = new RuntimeSecurityMonitor(guard, KnowledgeBase);
    }

    /// <summary>
    /// Initializes the SecurityLab: loads threat DB, starts monitoring.
    /// Call once at app startup.
    /// </summary>
    public void Initialize()
    {
        if (_initialized) return;
        _initialized = true;

        KnowledgeBase.EnsureLoaded();
        Monitor.Start();
    }

    /// <summary>
    /// Runs the complete security audit cycle:
    /// 1. Simulate all known attacks
    /// 2. Auto-apply fixes for failures
    /// 3. Generate recommendations for manual fixes
    /// 4. Feed novel findings back into the knowledge base
    /// Returns a comprehensive dashboard.
    /// </summary>
    public async Task<SecurityDashboard> RunFullAuditAsync(CancellationToken ct = default)
    {
        // Step 1: Simulate
        _lastSimulation = await Simulator.RunFullSuiteAsync(ct);

        // Step 2: Harden
        _lastHardening = Hardener.ApplyFromSimulation(_lastSimulation);

        // Step 3: Build dashboard
        return GetDashboard();
    }

    /// <summary>
    /// Runs proactive hardening without simulation.
    /// Faster — applies known-good rules from threat intelligence.
    /// </summary>
    public HardeningReport RunProactiveHardening()
    {
        _lastHardening = Hardener.ApplyProactive();
        return _lastHardening;
    }

    /// <summary>
    /// Gets the current security dashboard (latest data).
    /// </summary>
    public SecurityDashboard GetDashboard()
    {
        var threatStats = KnowledgeBase.GetStats();

        return new SecurityDashboard
        {
            // Threat intelligence
            TotalKnownThreats = threatStats.Total,
            CriticalThreats = threatStats.Critical,
            FullyMitigated = threatStats.FullyMitigated,
            PartiallyMitigated = threatStats.PartiallyMitigated,
            Unmitigated = threatStats.Unmitigated,

            // Last simulation
            LastSimulationScore = _lastSimulation?.SecurityScore ?? -1,
            LastSimulationTime = _lastSimulation?.RunAt,
            SimulationTestsPassed = _lastSimulation?.Passed ?? 0,
            SimulationTestsFailed = _lastSimulation?.Failed ?? 0,

            // Hardening
            AutoFixesApplied = _lastHardening?.AutoFixesApplied ?? 0,
            PendingRecommendations = _lastHardening?.ManualRecommendations ?? 0,
            ImprovedScore = _lastHardening?.NewScore ?? -1,

            // Runtime monitor
            ActiveAlerts = Monitor.ActiveAlerts.Count,
            CriticalAlerts = Monitor.ActiveAlerts.Count(a => a.Level == AlertLevel.Critical),

            // Overall health
            OverallHealth = CalculateOverallHealth()
        };
    }

    /// <summary>
    /// Gets a human-readable security summary for the UI.
    /// </summary>
    public string GetSummaryText()
    {
        var d = GetDashboard();
        var sb = new System.Text.StringBuilder();

        sb.AppendLine("═══ PAiA SecurityLab Dashboard ═══");
        sb.AppendLine();

        // Overall health
        var healthEmoji = d.OverallHealth switch
        {
            >= 90 => "🟢",
            >= 70 => "🟡",
            >= 50 => "🟠",
            _ => "🔴"
        };
        sb.AppendLine($"{healthEmoji} Overall Health: {d.OverallHealth}/100");
        sb.AppendLine();

        // Threat intelligence
        sb.AppendLine($"📚 Threat Intelligence: {d.TotalKnownThreats} known threats");
        sb.AppendLine($"   ✅ {d.FullyMitigated} fully mitigated");
        sb.AppendLine($"   ⚠️ {d.PartiallyMitigated} partially mitigated");
        sb.AppendLine($"   ❌ {d.Unmitigated} unmitigated");
        sb.AppendLine();

        // Last simulation
        if (d.LastSimulationScore >= 0)
        {
            sb.AppendLine($"🧪 Last Simulation: {d.LastSimulationScore}/100 ({d.SimulationTestsPassed}/{d.SimulationTestsPassed + d.SimulationTestsFailed} tests passed)");
            sb.AppendLine($"   Run at: {d.LastSimulationTime:yyyy-MM-dd HH:mm}");
        }
        else
        {
            sb.AppendLine("🧪 No simulation run yet — click 'Run Security Audit'");
        }
        sb.AppendLine();

        // Hardening
        if (d.AutoFixesApplied > 0 || d.PendingRecommendations > 0)
        {
            sb.AppendLine($"🔧 Hardening: {d.AutoFixesApplied} auto-fixes applied");
            if (d.PendingRecommendations > 0)
                sb.AppendLine($"   📋 {d.PendingRecommendations} manual recommendations pending");
            if (d.ImprovedScore > 0)
                sb.AppendLine($"   📈 Score improved to: {d.ImprovedScore}/100");
        }
        sb.AppendLine();

        // Runtime monitor
        sb.AppendLine($"👁️ Runtime Monitor: Active");
        if (d.ActiveAlerts > 0)
            sb.AppendLine($"   🚨 {d.ActiveAlerts} alert(s) ({d.CriticalAlerts} critical)");
        else
            sb.AppendLine("   ✅ No alerts");

        return sb.ToString();
    }

    private int CalculateOverallHealth()
    {
        int score = 100;

        // Deduct for unmitigated threats
        var stats = KnowledgeBase.GetStats();
        score -= stats.Unmitigated * 5;
        score -= stats.PartiallyMitigated * 2;

        // Deduct for simulation failures
        if (_lastSimulation is not null && _lastSimulation.Failed > 0)
            score -= _lastSimulation.Failed * 3;

        // Deduct for active critical alerts
        score -= Monitor.ActiveAlerts.Count(a => a.Level == AlertLevel.Critical) * 15;
        score -= Monitor.ActiveAlerts.Count(a => a.Level == AlertLevel.Warning) * 5;

        // Bonus for auto-fixes applied
        if (_lastHardening is not null)
            score += Math.Min(10, _lastHardening.AutoFixesApplied * 2);

        return Math.Max(0, Math.Min(100, score));
    }

    public void Dispose()
    {
        Monitor.Dispose();
    }
}

/// <summary>
/// Complete security dashboard data for the UI.
/// </summary>
public sealed class SecurityDashboard
{
    // Threat intelligence
    public int TotalKnownThreats { get; set; }
    public int CriticalThreats { get; set; }
    public int FullyMitigated { get; set; }
    public int PartiallyMitigated { get; set; }
    public int Unmitigated { get; set; }

    // Last simulation
    public int LastSimulationScore { get; set; }
    public DateTimeOffset? LastSimulationTime { get; set; }
    public int SimulationTestsPassed { get; set; }
    public int SimulationTestsFailed { get; set; }

    // Hardening
    public int AutoFixesApplied { get; set; }
    public int PendingRecommendations { get; set; }
    public int ImprovedScore { get; set; }

    // Runtime monitor
    public int ActiveAlerts { get; set; }
    public int CriticalAlerts { get; set; }

    // Overall
    public int OverallHealth { get; set; }
}
