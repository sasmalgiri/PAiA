namespace PAiA.WinUI.Models;

/// <summary>
/// A single message in the PAiA conversation thread.
/// </summary>
public sealed class ChatMessage
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N")[..8];
    public ChatRole Role { get; set; }
    public string Content { get; set; } = string.Empty;
    public DateTimeOffset Timestamp { get; set; } = DateTimeOffset.Now;

    /// <summary>Whether the user has copied this message.</summary>
    public bool IsCopied { get; set; }
}

public enum ChatRole
{
    User,
    Assistant,
    System
}
