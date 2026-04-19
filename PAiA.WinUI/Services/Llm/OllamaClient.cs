using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace PAiA.WinUI.Services.Llm;

/// <summary>
/// Communicates with a local Ollama instance. Nothing ever leaves localhost.
/// </summary>
public sealed class OllamaClient : ILlmClient, IDisposable
{
    private readonly HttpClient _http;
    private bool _disposed;

    public string BaseUrl { get; } = "http://localhost:11434";
    public string Model { get; set; } = "llama3.2:latest";

    public OllamaClient()
    {
        _http = new HttpClient { Timeout = TimeSpan.FromMinutes(5) };
    }

    /// <summary>Lists available models.</summary>
    public async Task<List<string>> ListModelsAsync(CancellationToken ct = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        var resp = await _http.GetFromJsonAsync<OllamaTagsResponse>($"{BaseUrl}/api/tags", ct);
        return resp?.Models?.Select(m => m.Name).ToList() ?? [];
    }

    /// <summary>Checks if Ollama is reachable.</summary>
    public async Task<bool> IsAvailableAsync(CancellationToken ct = default)
    {
        try
        {
            var resp = await _http.GetAsync(BaseUrl, ct);
            return resp.IsSuccessStatusCode;
        }
        catch { return false; }
    }

    /// <summary>Sends a one-shot chat request.</summary>
    public async Task<string> ChatAsync(string system, string user, CancellationToken ct = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);

        var payload = new
        {
            model = Model,
            stream = false,
            messages = new[]
            {
                new { role = "system", content = system },
                new { role = "user", content = user }
            }
        };

        var resp = await _http.PostAsJsonAsync($"{BaseUrl}/api/chat", payload, ct);
        resp.EnsureSuccessStatusCode();

        var result = await resp.Content.ReadFromJsonAsync<OllamaChatResponse>(cancellationToken: ct);
        return result?.Message?.Content ?? "";
    }

    /// <summary>Streams a chat response token-by-token.</summary>
    public async IAsyncEnumerable<string> ChatStreamAsync(
        string system, string user,
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);

        var payload = new
        {
            model = Model,
            stream = true,
            messages = new[]
            {
                new { role = "system", content = system },
                new { role = "user", content = user }
            }
        };

        var request = new HttpRequestMessage(HttpMethod.Post, $"{BaseUrl}/api/chat")
        {
            Content = JsonContent.Create(payload)
        };

        var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        response.EnsureSuccessStatusCode();

        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var reader = new StreamReader(stream);

        while (!reader.EndOfStream && !ct.IsCancellationRequested)
        {
            var line = await reader.ReadLineAsync(ct);
            if (string.IsNullOrEmpty(line)) continue;
            var chunk = JsonSerializer.Deserialize<OllamaChatResponse>(line);
            if (!string.IsNullOrEmpty(chunk?.Message?.Content))
                yield return chunk.Message.Content;
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _http.Dispose();
    }

    private sealed class OllamaChatResponse
    {
        [JsonPropertyName("message")] public OllamaMessage? Message { get; set; }
        [JsonPropertyName("done")] public bool Done { get; set; }
    }
    private sealed class OllamaMessage
    {
        [JsonPropertyName("content")] public string? Content { get; set; }
    }
    private sealed class OllamaTagsResponse
    {
        [JsonPropertyName("models")] public List<OllamaModel>? Models { get; set; }
    }
    private sealed class OllamaModel
    {
        [JsonPropertyName("name")] public string Name { get; set; } = "";
    }
}
