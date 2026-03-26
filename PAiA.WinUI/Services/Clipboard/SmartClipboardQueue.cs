using Windows.ApplicationModel.DataTransfer;

namespace PAiA.WinUI.Services.Clipboard;

/// <summary>
/// Smart clipboard queue for PAiA responses.
/// 
/// Problem: PAiA gives you a response with 3 code blocks and a command.
/// You have to copy → switch → paste → switch back → copy next. Painful.
/// 
/// Solution: "Copy to queue" stacks items. Then Ctrl+Shift+V pastes them
/// in order, one at a time. When the queue is empty, clipboard returns to normal.
/// 
/// All items are stored in memory only — never written to disk.
/// </summary>
public sealed class SmartClipboardQueue
{
    private readonly Queue<ClipboardItem> _queue = new();
    private readonly List<ClipboardItem> _history = [];

    public int Count => _queue.Count;
    public bool IsEmpty => _queue.Count == 0;
    public IReadOnlyList<ClipboardItem> History => _history;

    /// <summary>
    /// Adds an item to the queue. The item is also set as the active clipboard content.
    /// </summary>
    public void Enqueue(string text, string? label = null)
    {
        var item = new ClipboardItem
        {
            Text = text,
            Label = label ?? TrimForLabel(text),
            QueuedAt = DateTimeOffset.Now
        };

        _queue.Enqueue(item);
        _history.Add(item);

        // Also set as current clipboard
        SetClipboard(text);
    }

    /// <summary>
    /// Pastes the next item: sets it to clipboard and removes from queue.
    /// Returns the item for UI feedback, or null if queue is empty.
    /// </summary>
    public ClipboardItem? PasteNext()
    {
        if (_queue.Count == 0) return null;

        var item = _queue.Dequeue();
        SetClipboard(item.Text);
        item.PastedAt = DateTimeOffset.Now;
        return item;
    }

    /// <summary>
    /// Peeks at the next item without removing it.
    /// </summary>
    public ClipboardItem? PeekNext() =>
        _queue.Count > 0 ? _queue.Peek() : null;

    /// <summary>
    /// Clears the queue (not the history).
    /// </summary>
    public void Clear() => _queue.Clear();

    /// <summary>
    /// Clears both queue and history.
    /// </summary>
    public void ClearAll()
    {
        _queue.Clear();
        _history.Clear();
    }

    /// <summary>
    /// Adds all code blocks from a response to the queue.
    /// Detects markdown code fences and queues each one.
    /// </summary>
    public int QueueCodeBlocks(string response)
    {
        int count = 0;
        var lines = response.Split('\n');
        var inCodeBlock = false;
        var currentBlock = new System.Text.StringBuilder();
        var language = "";

        foreach (var line in lines)
        {
            if (line.TrimStart().StartsWith("```"))
            {
                if (inCodeBlock)
                {
                    // End of code block
                    var code = currentBlock.ToString().Trim();
                    if (!string.IsNullOrEmpty(code))
                    {
                        Enqueue(code, $"Code block ({language})".Trim());
                        count++;
                    }
                    currentBlock.Clear();
                    inCodeBlock = false;
                }
                else
                {
                    // Start of code block
                    inCodeBlock = true;
                    language = line.TrimStart()[3..].Trim();
                    currentBlock.Clear();
                }
            }
            else if (inCodeBlock)
            {
                currentBlock.AppendLine(line);
            }
        }

        return count;
    }

    private static void SetClipboard(string text)
    {
        var pkg = new DataPackage();
        pkg.SetText(text);
        Windows.ApplicationModel.DataTransfer.Clipboard.SetContent(pkg);
        Windows.ApplicationModel.DataTransfer.Clipboard.Flush();
    }

    private static string TrimForLabel(string text)
    {
        var trimmed = text.Length > 50 ? text[..50] + "…" : text;
        return trimmed.Replace('\n', ' ').Replace('\r', ' ');
    }
}

public sealed class ClipboardItem
{
    public string Text { get; set; } = "";
    public string Label { get; set; } = "";
    public DateTimeOffset QueuedAt { get; set; }
    public DateTimeOffset? PastedAt { get; set; }
    public bool WasPasted => PastedAt.HasValue;
}
