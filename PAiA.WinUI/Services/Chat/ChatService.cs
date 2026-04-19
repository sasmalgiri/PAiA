using System.Text;
using PAiA.WinUI.Models;
using PAiA.WinUI.Services.Context;
using PAiA.WinUI.Services.Llm;

namespace PAiA.WinUI.Services.Chat;

/// <summary>
/// Manages a multi-turn conversation with the local LLM.
/// Keeps screen context so follow-up questions reference the same capture.
/// </summary>
public sealed class ChatService
{
    private readonly ILlmClient _ollama;
    private readonly List<ChatMessage> _history = [];
    private ScreenContext? _currentContext;

    public IReadOnlyList<ChatMessage> History => _history;
    public ScreenContext? CurrentContext => _currentContext;

    public ChatService(ILlmClient ollama)
    {
        _ollama = ollama;
    }

    /// <summary>
    /// Updates the screen context (called after a new capture + OCR + redact).
    /// Optionally clears conversation history for a fresh start.
    /// </summary>
    public void SetContext(ScreenContext context, bool clearHistory = true)
    {
        _currentContext = context;
        if (clearHistory) _history.Clear();
    }

    /// <summary>
    /// Sends a user message and returns the full assistant response.
    /// Includes screen context in the system prompt.
    /// </summary>
    public async Task<string> SendAsync(string userMessage, CancellationToken ct = default)
    {
        _history.Add(new ChatMessage { Role = ChatRole.User, Content = userMessage });

        var system = BuildSystemPrompt();
        var userPayload = BuildUserPayload(userMessage);

        var response = await _ollama.ChatAsync(system, userPayload, ct);

        _history.Add(new ChatMessage { Role = ChatRole.Assistant, Content = response });
        return response;
    }

    /// <summary>
    /// Sends a user message and streams the assistant response token-by-token.
    /// </summary>
    public async IAsyncEnumerable<string> SendStreamAsync(
        string userMessage,
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct = default)
    {
        _history.Add(new ChatMessage { Role = ChatRole.User, Content = userMessage });

        var system = BuildSystemPrompt();
        var userPayload = BuildUserPayload(userMessage);

        var full = new StringBuilder();
        await foreach (var chunk in _ollama.ChatStreamAsync(system, userPayload, ct))
        {
            full.Append(chunk);
            yield return chunk;
        }

        _history.Add(new ChatMessage { Role = ChatRole.Assistant, Content = full.ToString() });
    }

    /// <summary>
    /// Clears conversation history but keeps the screen context.
    /// </summary>
    public void ClearHistory() => _history.Clear();

    /// <summary>
    /// Injects web search results into the next message context.
    /// The results are included as part of the system context, not chat history.
    /// </summary>
    private string? _searchContext;
    public void InjectSearchContext(string searchResults)
    {
        _searchContext = searchResults;
    }

    /// <summary>
    /// Clears everything — context and history.
    /// </summary>
    public void Reset()
    {
        _history.Clear();
        _currentContext = null;
    }

    /// <summary>
    /// Builds the system prompt based on detected context type.
    /// </summary>
    private string BuildSystemPrompt()
    {
        var type = _currentContext?.Type ?? ContextType.General;
        return SmartContextService.GetSystemPrompt(type);
    }

    /// <summary>
    /// Builds the user payload: screen OCR + conversation history + new message.
    /// </summary>
    private string BuildUserPayload(string latestMessage)
    {
        var sb = new StringBuilder();

        // Include screen context on first message or if context just changed
        if (_currentContext is not null && _history.Count(m => m.Role == ChatRole.User) <= 1)
        {
            sb.AppendLine("=== SCREEN CAPTURE (OCR, redacted) ===");
            sb.AppendLine(_currentContext.RedactedOcr);
            sb.AppendLine("=== END SCREEN CAPTURE ===");
            sb.AppendLine();
        }

        // Include recent history for multi-turn context (last 6 exchanges)
        var recentHistory = _history.SkipLast(1).TakeLast(12).ToList();
        if (recentHistory.Count > 0)
        {
            sb.AppendLine("=== CONVERSATION HISTORY ===");
            foreach (var msg in recentHistory)
            {
                var role = msg.Role == ChatRole.User ? "User" : "Assistant";
                sb.AppendLine($"{role}: {msg.Content}");
            }
            sb.AppendLine("=== END HISTORY ===");
            sb.AppendLine();
        }

        // Include web search results if available (one-time injection)
        if (_searchContext is not null)
        {
            sb.AppendLine(_searchContext);
            sb.AppendLine();
            _searchContext = null; // Clear after use — one-shot
        }

        sb.AppendLine($"User: {latestMessage}");
        return sb.ToString();
    }
}
