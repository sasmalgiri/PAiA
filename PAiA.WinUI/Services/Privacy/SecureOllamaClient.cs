using PAiA.WinUI.Services.Llm;
using PAiA.WinUI.Services.Redaction;

namespace PAiA.WinUI.Services.Privacy;

/// <summary>
/// Privacy-enforcing wrapper around OllamaClient.
/// 
/// ENFORCES AT CODE LEVEL:
/// - All URLs validated against localhost whitelist before any HTTP call
/// - All user text re-verified for PII before sending to LLM
/// - All operations audit-tracked via PrivacyGuard
/// 
/// Use this instead of OllamaClient directly in production code.
/// </summary>
public sealed class SecureOllamaClient : ILlmClient, IDisposable
{
    private readonly OllamaClient _inner;
    private readonly PrivacyGuard _guard;
    private readonly RedactionService _redact;
    private bool _disposed;

    public string Model
    {
        get => _inner.Model;
        set => _inner.Model = value;
    }

    public SecureOllamaClient(OllamaClient client, PrivacyGuard guard, RedactionService redact)
    {
        _inner = client;
        _guard = guard;
        _redact = redact;

        // Validate endpoint on construction
        if (!_guard.IsAllowedEndpoint(_inner.BaseUrl))
            throw new PrivacyViolationException(
                $"PAiA privacy violation: Ollama endpoint '{_inner.BaseUrl}' is not localhost. " +
                "PAiA only communicates with local Ollama instances.");
    }

    public async Task<List<string>> ListModelsAsync(CancellationToken ct = default)
    {
        ValidateEndpoint();
        return await _inner.ListModelsAsync(ct);
    }

    public async Task<bool> IsAvailableAsync(CancellationToken ct = default)
    {
        ValidateEndpoint();
        return await _inner.IsAvailableAsync(ct);
    }

    /// <summary>
    /// Sends a chat request with mandatory PII re-verification.
    /// Even if the caller forgot to redact, this catches it.
    /// </summary>
    public async Task<string> ChatAsync(string system, string user, CancellationToken ct = default)
    {
        ValidateEndpoint();
        var safeUser = EnsureRedacted(user);
        _guard.RecordLlmCall();
        return await _inner.ChatAsync(system, safeUser, ct);
    }

    /// <summary>
    /// Streams a chat response with mandatory PII re-verification.
    /// </summary>
    public async IAsyncEnumerable<string> ChatStreamAsync(
        string system, string user,
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct = default)
    {
        ValidateEndpoint();
        var safeUser = EnsureRedacted(user);
        _guard.RecordLlmCall();

        await foreach (var chunk in _inner.ChatStreamAsync(system, safeUser, ct))
            yield return chunk;
    }

    /// <summary>
    /// Double-redacts text as a safety net. If the caller already redacted,
    /// this is a no-op. If they forgot, this catches PII.
    /// </summary>
    private string EnsureRedacted(string text)
    {
        var leaks = _guard.VerifyRedaction(text);
        if (leaks.Count > 0)
        {
            // Re-redact — something slipped through
            return _redact.Redact(text);
        }
        return text;
    }

    private void ValidateEndpoint()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (!_guard.IsAllowedEndpoint(_inner.BaseUrl))
            throw new PrivacyViolationException(
                "PAiA privacy violation: Ollama endpoint is not on localhost.");
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _inner.Dispose();
    }
}

/// <summary>
/// Thrown when a privacy guarantee would be violated.
/// </summary>
public class PrivacyViolationException : Exception
{
    public PrivacyViolationException(string message) : base(message) { }
}
