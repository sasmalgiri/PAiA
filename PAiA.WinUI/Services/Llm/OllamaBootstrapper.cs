using System.Diagnostics;
using System.Net.Http;

namespace PAiA.WinUI.Services.Llm;

/// <summary>
/// Handles Ollama lifecycle management for PAiA.
/// 
/// On app start:
/// 1. Check if Ollama is installed
/// 2. Check if Ollama is running
/// 3. Start it if needed
/// 4. Wait for it to become ready
/// 5. Check if models are available
/// 
/// This removes the "install Ollama first" friction — PAiA handles it.
/// </summary>
public sealed class OllamaBootstrapper
{
    private static readonly string[] OllamaSearchPaths =
    [
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Ollama", "ollama.exe"),
        @"C:\Program Files\Ollama\ollama.exe",
        @"C:\Program Files (x86)\Ollama\ollama.exe",
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "AppData", "Local", "Ollama", "ollama.exe"),
    ];

    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(5) };
    private Process? _ollamaProcess;

    /// <summary>
    /// Checks if Ollama is installed on the system.
    /// </summary>
    public OllamaInstallStatus CheckInstallation()
    {
        // Check if ollama is in PATH
        var inPath = FindInPath("ollama.exe") ?? FindInPath("ollama");
        if (inPath is not null)
            return new OllamaInstallStatus { IsInstalled = true, ExePath = inPath };

        // Check known install locations
        foreach (var path in OllamaSearchPaths)
        {
            if (File.Exists(path))
                return new OllamaInstallStatus { IsInstalled = true, ExePath = path };
        }

        return new OllamaInstallStatus
        {
            IsInstalled = false,
            InstallUrl = "https://ollama.com/download/windows"
        };
    }

    /// <summary>
    /// Checks if Ollama server is currently running and responding.
    /// </summary>
    public async Task<bool> IsRunningAsync()
    {
        try
        {
            var response = await _http.GetAsync("http://localhost:11434");
            return response.IsSuccessStatusCode;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Attempts to start Ollama if it's installed but not running.
    /// Returns true if Ollama became available.
    /// </summary>
    public async Task<bool> EnsureRunningAsync()
    {
        // Already running?
        if (await IsRunningAsync()) return true;

        // Find Ollama
        var install = CheckInstallation();
        if (!install.IsInstalled || install.ExePath is null) return false;

        try
        {
            // Start Ollama serve in the background
            _ollamaProcess = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = install.ExePath,
                    Arguments = "serve",
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true
                }
            };

            _ollamaProcess.Start();

            // Wait up to 15 seconds for Ollama to become responsive
            for (int i = 0; i < 30; i++)
            {
                await Task.Delay(500);
                if (await IsRunningAsync()) return true;
            }

            return false;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Checks if any models are installed in Ollama.
    /// </summary>
    public async Task<List<string>> GetInstalledModelsAsync()
    {
        try
        {
            var response = await _http.GetAsync("http://localhost:11434/api/tags");
            if (!response.IsSuccessStatusCode) return [];

            var json = await response.Content.ReadAsStringAsync();
            var doc = System.Text.Json.JsonDocument.Parse(json);
            var models = new List<string>();

            if (doc.RootElement.TryGetProperty("models", out var modelsArray))
            {
                foreach (var model in modelsArray.EnumerateArray())
                {
                    if (model.TryGetProperty("name", out var name))
                        models.Add(name.GetString() ?? "");
                }
            }

            return models.Where(m => !string.IsNullOrEmpty(m)).ToList();
        }
        catch
        {
            return [];
        }
    }

    /// <summary>
    /// Runs the full bootstrap sequence and returns a status report.
    /// </summary>
    public async Task<BootstrapResult> BootstrapAsync()
    {
        var result = new BootstrapResult();

        // Step 1: Check installation
        var install = CheckInstallation();
        result.IsInstalled = install.IsInstalled;
        result.ExePath = install.ExePath;

        if (!install.IsInstalled)
        {
            result.Status = BootstrapStatus.NotInstalled;
            result.Message = "Ollama is not installed. Download it from ollama.com/download";
            result.ActionUrl = install.InstallUrl;
            return result;
        }

        // Step 2: Ensure running
        var wasRunning = await IsRunningAsync();
        if (!wasRunning)
        {
            result.WasAutoStarted = true;
            var started = await EnsureRunningAsync();
            if (!started)
            {
                result.Status = BootstrapStatus.FailedToStart;
                result.Message = "Ollama is installed but couldn't be started. Try running 'ollama serve' manually.";
                return result;
            }
        }

        result.IsRunning = true;

        // Step 3: Check models
        result.InstalledModels = await GetInstalledModelsAsync();

        if (result.InstalledModels.Count == 0)
        {
            result.Status = BootstrapStatus.NoModels;
            result.Message = "Ollama is running but no models are installed. Pull one with: ollama pull qwen3.5:9b";
            return result;
        }

        result.Status = BootstrapStatus.Ready;
        result.Message = $"Ready — {result.InstalledModels.Count} model(s) available";
        return result;
    }

    private static string? FindInPath(string fileName)
    {
        var pathDirs = Environment.GetEnvironmentVariable("PATH")?.Split(Path.PathSeparator) ?? [];
        foreach (var dir in pathDirs)
        {
            var fullPath = Path.Combine(dir, fileName);
            if (File.Exists(fullPath)) return fullPath;
        }
        return null;
    }

    public void StopOllama()
    {
        try
        {
            _ollamaProcess?.Kill(true);
            _ollamaProcess?.Dispose();
        }
        catch { }
    }
}

public sealed class OllamaInstallStatus
{
    public bool IsInstalled { get; set; }
    public string? ExePath { get; set; }
    public string? InstallUrl { get; set; }
}

public sealed class BootstrapResult
{
    public BootstrapStatus Status { get; set; }
    public string Message { get; set; } = "";
    public bool IsInstalled { get; set; }
    public bool IsRunning { get; set; }
    public bool WasAutoStarted { get; set; }
    public string? ExePath { get; set; }
    public string? ActionUrl { get; set; }
    public List<string> InstalledModels { get; set; } = [];
}

public enum BootstrapStatus
{
    Ready,
    NotInstalled,
    FailedToStart,
    NoModels
}
