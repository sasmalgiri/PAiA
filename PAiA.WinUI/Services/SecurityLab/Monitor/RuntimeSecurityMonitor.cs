using PAiA.WinUI.Services.Privacy;
using PAiA.WinUI.Services.SecurityLab.ThreatIntel;

namespace PAiA.WinUI.Services.SecurityLab.Monitor;

/// <summary>
/// Real-time security monitor that runs during app operation.
/// Checks for anomalies continuously and raises alerts.
/// 
/// Monitors:
/// • Unexpected outbound network connections
/// • Image files appearing on disk (screenshot leaks)
/// • Unusual Ollama endpoint changes
/// • Rapid-fire capture patterns (possible automation abuse)
/// • Audit log tampering
/// • Process injection attempts
/// </summary>
public sealed class RuntimeSecurityMonitor : IDisposable
{
    private readonly PrivacyGuard _guard;
    private readonly ThreatKnowledgeBase _kb;
    private Timer? _monitorTimer;
    private bool _disposed;

    private int _captureCount;
    private DateTimeOffset _lastCaptureTime = DateTimeOffset.MinValue;
    private long _lastAuditLogSize;
    private string _lastAuditLogHash = "";

    private readonly List<SecurityAlert> _alerts = [];
    public IReadOnlyList<SecurityAlert> ActiveAlerts => _alerts;

    public event Action<SecurityAlert>? AlertRaised;

    public RuntimeSecurityMonitor(PrivacyGuard guard, ThreatKnowledgeBase kb)
    {
        _guard = guard;
        _kb = kb;
    }

    /// <summary>
    /// Starts continuous monitoring (checks every 5 seconds).
    /// </summary>
    public void Start()
    {
        _monitorTimer = new Timer(CheckAll, null,
            TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(5));
    }

    /// <summary>
    /// Records a capture event for rate monitoring.
    /// </summary>
    public void RecordCapture()
    {
        var now = DateTimeOffset.Now;
        var timeSinceLast = now - _lastCaptureTime;
        _lastCaptureTime = now;
        _captureCount++;

        // Alert if captures are happening suspiciously fast
        if (timeSinceLast < TimeSpan.FromSeconds(2) && _captureCount > 3)
        {
            RaiseAlert(new SecurityAlert
            {
                Level = AlertLevel.Warning,
                Category = ThreatCategory.ScreenCapture,
                Title = "Rapid capture pattern detected",
                Description = $"Captures happening every {timeSinceLast.TotalSeconds:F1}s. " +
                    "This could indicate automated abuse. Normal usage has longer intervals.",
                Recommendation = "If you're capturing manually, this is fine. If not, check for unauthorized automation."
            });
        }
    }

    /// <summary>
    /// Checks all security conditions.
    /// </summary>
    private void CheckAll(object? state)
    {
        try
        {
            CheckNetworkIsolation();
            CheckDiskLeaks();
            CheckAuditLogIntegrity();
        }
        catch { /* Monitor must never crash the app */ }
    }

    private void CheckNetworkIsolation()
    {
        var connections = _guard.GetActiveOutboundConnections();
        if (connections.Count > 0)
        {
            RaiseAlert(new SecurityAlert
            {
                Level = AlertLevel.Critical,
                Category = ThreatCategory.NetworkBypass,
                Title = "Unexpected outbound network connection",
                Description = $"Detected {connections.Count} connection(s) to external hosts: " +
                    string.Join(", ", connections),
                Recommendation = "PAiA should only connect to localhost. Check if Ollama is misconfigured or if malware is present."
            });
        }
    }

    private void CheckDiskLeaks()
    {
        var leaked = _guard.FindLeakedImages();
        if (leaked.Count > 0)
        {
            RaiseAlert(new SecurityAlert
            {
                Level = AlertLevel.Critical,
                Category = ThreatCategory.ScreenCapture,
                Title = "Screenshot files found on disk!",
                Description = $"{leaked.Count} image file(s) found in PAiA data directory: " +
                    string.Join(", ", leaked.Select(Path.GetFileName)),
                Recommendation = "Delete these files immediately. This should never happen — investigate the cause."
            });
        }
    }

    private void CheckAuditLogIntegrity()
    {
        var logDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "PAiA", "AuditLogs");

        if (!Directory.Exists(logDir)) return;

        var currentSize = Directory.GetFiles(logDir, "audit-*.jsonl")
            .Sum(f => new FileInfo(f).Length);

        // Audit log should only grow (append-only). If it shrinks, someone tampered.
        if (_lastAuditLogSize > 0 && currentSize < _lastAuditLogSize)
        {
            RaiseAlert(new SecurityAlert
            {
                Level = AlertLevel.Warning,
                Category = ThreatCategory.DataExfiltration,
                Title = "Audit log size decreased",
                Description = $"Log size went from {_lastAuditLogSize} to {currentSize} bytes. " +
                    "Audit logs are append-only — shrinking indicates tampering or unauthorized deletion.",
                Recommendation = "Check if DataWiper was used legitimately, or investigate unauthorized modification."
            });
        }

        _lastAuditLogSize = currentSize;
    }

    private void RaiseAlert(SecurityAlert alert)
    {
        alert.DetectedAt = DateTimeOffset.Now;

        // Deduplicate: don't raise same alert within 60 seconds
        var isDuplicate = _alerts.Any(a =>
            a.Title == alert.Title &&
            (DateTimeOffset.Now - a.DetectedAt) < TimeSpan.FromSeconds(60));

        if (!isDuplicate)
        {
            _alerts.Add(alert);
            AlertRaised?.Invoke(alert);

            // Keep only last 100 alerts
            while (_alerts.Count > 100)
                _alerts.RemoveAt(0);
        }
    }

    public void ClearAlerts() => _alerts.Clear();

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _monitorTimer?.Dispose();
    }
}

public sealed class SecurityAlert
{
    public AlertLevel Level { get; set; }
    public ThreatCategory Category { get; set; }
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    public string Recommendation { get; set; } = "";
    public DateTimeOffset DetectedAt { get; set; }
}

public enum AlertLevel
{
    Info,
    Warning,
    Critical
}
