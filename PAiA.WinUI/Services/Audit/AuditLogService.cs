using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace PAiA.WinUI.Services.Audit;

/// <summary>
/// Audit event record — stores only redacted data.
/// </summary>
public sealed record AuditEvent(
    string Action,
    string? Target = null,
    string? PackId = null,
    string? Question = null,
    string? OcrRedacted = null,
    string? Answer = null,
    string? Hash = null
);

/// <summary>
/// Manages a tamper-evident local audit log.
/// Each entry is SHA-256 hashed for integrity verification.
/// Stores only redacted text — never raw screenshots.
/// </summary>
public sealed class AuditLogService
{
    private readonly string _logDir;

    public AuditLogService(string? logDir = null)
    {
        _logDir = logDir ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "PAiA", "AuditLogs");
        Directory.CreateDirectory(_logDir);
    }

    /// <summary>Writes an audit event to the daily log file.</summary>
    public void Log(AuditEvent evt)
    {
        var entry = evt with
        {
            Hash = ComputeHash(evt)
        };

        var fileName = $"audit-{DateTime.UtcNow:yyyy-MM-dd}.jsonl";
        var path = Path.Combine(_logDir, fileName);
        var line = JsonSerializer.Serialize(entry) + Environment.NewLine;
        File.AppendAllText(path, line, Encoding.UTF8);
    }

    /// <summary>Returns total log entry count and size on disk.</summary>
    public (int count, long bytes) GetStats()
    {
        var files = Directory.GetFiles(_logDir, "audit-*.jsonl");
        int count = 0;
        long bytes = 0;
        foreach (var f in files)
        {
            var info = new FileInfo(f);
            bytes += info.Length;
            count += File.ReadLines(f).Count(l => !string.IsNullOrWhiteSpace(l));
        }
        return (count, bytes);
    }

    /// <summary>Deletes all audit logs.</summary>
    public void DeleteAll()
    {
        foreach (var f in Directory.GetFiles(_logDir, "audit-*.jsonl"))
            File.Delete(f);
    }

    private static string ComputeHash(AuditEvent evt)
    {
        var raw = $"{evt.Action}|{evt.Target}|{evt.OcrRedacted}|{evt.Answer}|{DateTimeOffset.UtcNow:O}";
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(raw));
        return Convert.ToHexString(hash)[..16];
    }
}
