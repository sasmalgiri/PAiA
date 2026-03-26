namespace PAiA.WinUI.Services.Privacy;

/// <summary>
/// Securely deletes all PAiA data when requested by the user.
/// 
/// Supports:
/// - Full wipe (all data including consent)
/// - Audit log wipe only
/// - Verification that wipe was complete
/// </summary>
public sealed class DataWiper
{
    private readonly string _dataDir;

    public DataWiper()
    {
        _dataDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "PAiA");
    }

    /// <summary>
    /// Deletes all PAiA data. Returns a report of what was deleted.
    /// </summary>
    public WipeReport WipeAll()
    {
        var report = new WipeReport();

        if (!Directory.Exists(_dataDir))
        {
            report.Success = true;
            report.Message = "No PAiA data directory found — nothing to delete.";
            return report;
        }

        // Count before deletion
        var files = Directory.GetFiles(_dataDir, "*.*", SearchOption.AllDirectories);
        report.FilesFound = files.Length;
        report.BytesBefore = files.Sum(f => new FileInfo(f).Length);

        foreach (var file in files)
        {
            try
            {
                // Overwrite with zeros before deleting (basic secure delete)
                var length = new FileInfo(file).Length;
                if (length > 0 && length < 100 * 1024 * 1024) // Skip files > 100MB
                {
                    using var fs = new FileStream(file, FileMode.Open, FileAccess.Write);
                    var zeros = new byte[Math.Min(length, 8192)];
                    var written = 0L;
                    while (written < length)
                    {
                        var toWrite = (int)Math.Min(zeros.Length, length - written);
                        fs.Write(zeros, 0, toWrite);
                        written += toWrite;
                    }
                    fs.Flush(true);
                }

                File.Delete(file);
                report.FilesDeleted++;
            }
            catch (Exception ex)
            {
                report.Errors.Add($"Failed to delete {Path.GetFileName(file)}: {ex.Message}");
            }
        }

        // Remove empty directories
        try
        {
            foreach (var dir in Directory.GetDirectories(_dataDir, "*", SearchOption.AllDirectories)
                         .OrderByDescending(d => d.Length))
            {
                if (Directory.Exists(dir) && !Directory.EnumerateFileSystemEntries(dir).Any())
                    Directory.Delete(dir);
            }
        }
        catch { /* best effort */ }

        // Verify
        var remaining = Directory.Exists(_dataDir)
            ? Directory.GetFiles(_dataDir, "*.*", SearchOption.AllDirectories).Length
            : 0;

        report.FilesRemaining = remaining;
        report.Success = remaining == 0;
        report.Message = report.Success
            ? $"Successfully deleted {report.FilesDeleted} file(s) ({report.BytesBefore / 1024.0:F1} KB)."
            : $"Deleted {report.FilesDeleted} file(s), but {remaining} could not be removed.";

        return report;
    }

    /// <summary>
    /// Deletes only audit logs, keeping consent and preferences.
    /// </summary>
    public WipeReport WipeAuditLogs()
    {
        var auditDir = Path.Combine(_dataDir, "AuditLogs");
        var report = new WipeReport();

        if (!Directory.Exists(auditDir))
        {
            report.Success = true;
            report.Message = "No audit logs found.";
            return report;
        }

        var files = Directory.GetFiles(auditDir, "audit-*.jsonl");
        report.FilesFound = files.Length;
        report.BytesBefore = files.Sum(f => new FileInfo(f).Length);

        foreach (var file in files)
        {
            try
            {
                File.Delete(file);
                report.FilesDeleted++;
            }
            catch (Exception ex)
            {
                report.Errors.Add($"Failed: {ex.Message}");
            }
        }

        report.Success = report.Errors.Count == 0;
        report.Message = $"Deleted {report.FilesDeleted} audit log(s).";
        return report;
    }
}

public sealed class WipeReport
{
    public bool Success { get; set; }
    public string Message { get; set; } = "";
    public int FilesFound { get; set; }
    public int FilesDeleted { get; set; }
    public int FilesRemaining { get; set; }
    public long BytesBefore { get; set; }
    public List<string> Errors { get; set; } = [];
}
