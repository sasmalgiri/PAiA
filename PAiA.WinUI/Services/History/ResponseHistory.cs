using System.Text.Json;

namespace PAiA.WinUI.Services.History;

/// <summary>
/// Searchable history of PAiA conversations.
/// 
/// Problem: PAiA gave you a perfect fix for a Python error last Tuesday.
/// You need it again. But the conversation is gone.
/// 
/// Solution: Every exchange is saved locally (redacted text only).
/// Search by keyword, filter by context type, bookmark useful ones.
/// 
/// All data stored in %LOCALAPPDATA%\PAiA\History — user owns it.
/// </summary>
public sealed class ResponseHistory
{
    private readonly string _historyDir;
    private readonly List<HistoryEntry> _entries = [];
    private bool _loaded;

    public IReadOnlyList<HistoryEntry> Entries => _entries;

    public ResponseHistory()
    {
        _historyDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "PAiA", "History");
        Directory.CreateDirectory(_historyDir);
    }

    /// <summary>
    /// Saves a Q&A exchange to history.
    /// </summary>
    public void Save(HistoryEntry entry)
    {
        entry.Id ??= Guid.NewGuid().ToString("N")[..12];
        entry.Timestamp = DateTimeOffset.Now;

        _entries.Insert(0, entry); // Most recent first

        // Append to daily file
        var fileName = $"history-{DateTime.UtcNow:yyyy-MM-dd}.jsonl";
        var path = Path.Combine(_historyDir, fileName);
        var line = JsonSerializer.Serialize(entry) + Environment.NewLine;
        File.AppendAllText(path, line);
    }

    /// <summary>
    /// Searches history by keyword across questions and answers.
    /// </summary>
    public List<HistoryEntry> Search(string query, int maxResults = 20)
    {
        EnsureLoaded();
        var lower = query.ToLowerInvariant();

        return _entries
            .Where(e =>
                (e.Question?.Contains(lower, StringComparison.OrdinalIgnoreCase) ?? false) ||
                (e.Answer?.Contains(lower, StringComparison.OrdinalIgnoreCase) ?? false) ||
                (e.ContextType?.Contains(lower, StringComparison.OrdinalIgnoreCase) ?? false) ||
                (e.AppName?.Contains(lower, StringComparison.OrdinalIgnoreCase) ?? false))
            .Take(maxResults)
            .ToList();
    }

    /// <summary>
    /// Returns bookmarked entries.
    /// </summary>
    public List<HistoryEntry> GetBookmarked()
    {
        EnsureLoaded();
        return _entries.Where(e => e.IsBookmarked).ToList();
    }

    /// <summary>
    /// Toggles bookmark on an entry.
    /// </summary>
    public void ToggleBookmark(string entryId)
    {
        EnsureLoaded();
        var entry = _entries.FirstOrDefault(e => e.Id == entryId);
        if (entry is not null)
        {
            entry.IsBookmarked = !entry.IsBookmarked;
            RewriteEntryFile(entry);
        }
    }

    /// <summary>
    /// Returns recent entries, optionally filtered by context type.
    /// </summary>
    public List<HistoryEntry> GetRecent(int count = 20, string? contextType = null)
    {
        EnsureLoaded();
        var query = _entries.AsEnumerable();
        if (contextType is not null)
            query = query.Where(e =>
                e.ContextType?.Equals(contextType, StringComparison.OrdinalIgnoreCase) ?? false);
        return query.Take(count).ToList();
    }

    /// <summary>
    /// Deletes all history.
    /// </summary>
    public void DeleteAll()
    {
        foreach (var file in Directory.GetFiles(_historyDir, "history-*.jsonl"))
            File.Delete(file);
        _entries.Clear();
    }

    /// <summary>
    /// Returns stats about the history.
    /// </summary>
    public (int total, int bookmarked, long sizeBytes) GetStats()
    {
        EnsureLoaded();
        var size = Directory.GetFiles(_historyDir, "history-*.jsonl")
            .Sum(f => new FileInfo(f).Length);
        return (_entries.Count, _entries.Count(e => e.IsBookmarked), size);
    }

    private void EnsureLoaded()
    {
        if (_loaded) return;
        _loaded = true;

        var files = Directory.GetFiles(_historyDir, "history-*.jsonl")
            .OrderByDescending(f => f);

        foreach (var file in files)
        {
            foreach (var line in File.ReadLines(file))
            {
                if (string.IsNullOrWhiteSpace(line)) continue;
                try
                {
                    var entry = JsonSerializer.Deserialize<HistoryEntry>(line);
                    if (entry is not null)
                        _entries.Add(entry);
                }
                catch { /* skip corrupt entries */ }
            }
        }
    }

    private void RewriteEntryFile(HistoryEntry updated)
    {
        // Find the file containing this entry and update it
        foreach (var file in Directory.GetFiles(_historyDir, "history-*.jsonl"))
        {
            var lines = File.ReadAllLines(file);
            var modified = false;

            for (int i = 0; i < lines.Length; i++)
            {
                if (string.IsNullOrWhiteSpace(lines[i])) continue;
                try
                {
                    var entry = JsonSerializer.Deserialize<HistoryEntry>(lines[i]);
                    if (entry?.Id == updated.Id)
                    {
                        lines[i] = JsonSerializer.Serialize(updated);
                        modified = true;
                        break;
                    }
                }
                catch { }
            }

            if (modified)
            {
                File.WriteAllLines(file, lines);
                break;
            }
        }
    }
}

public sealed class HistoryEntry
{
    public string? Id { get; set; }
    public DateTimeOffset Timestamp { get; set; }
    public string? Question { get; set; }
    public string? Answer { get; set; }
    public string? ContextType { get; set; }
    public string? AppName { get; set; }
    public bool IsBookmarked { get; set; }
}
