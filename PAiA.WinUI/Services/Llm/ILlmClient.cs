namespace PAiA.WinUI.Services.Llm;

/// <summary>
/// Interface for LLM communication. Both OllamaClient and SecureOllamaClient
/// implement this, so consumers (ChatService, FormAnalysisService) can use
/// the secure wrapper without knowing the difference.
/// </summary>
public interface ILlmClient
{
    string Model { get; set; }
    Task<string> ChatAsync(string system, string user, CancellationToken ct = default);
    IAsyncEnumerable<string> ChatStreamAsync(string system, string user, CancellationToken ct = default);
    Task<List<string>> ListModelsAsync(CancellationToken ct = default);
    Task<bool> IsAvailableAsync(CancellationToken ct = default);
}
