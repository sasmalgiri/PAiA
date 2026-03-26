using System.Diagnostics;
using System.Runtime.InteropServices;

namespace PAiA.WinUI.Services.Llm;

/// <summary>
/// Detects user hardware and recommends the optimal Ollama model.
/// Handles CPU-only systems gracefully with appropriate model suggestions.
/// 
/// KEY FACTS:
/// - PAiA WORKS on CPU-only machines (no GPU required)
/// - CPU-only is SLOW but usable with small models
/// - GPU makes it 10-50x faster
/// - PAiA is Windows desktop ONLY (not mobile)
/// </summary>
public sealed class ModelRecommender
{
    /// <summary>
    /// Detects system hardware and returns a recommendation.
    /// </summary>
    public static HardwareProfile DetectHardware()
    {
        var profile = new HardwareProfile();

        // RAM detection
        try
        {
            var info = GC.GetGCMemoryInfo();
            profile.TotalRamMb = (int)(info.TotalAvailableMemoryBytes / 1024 / 1024);
        }
        catch
        {
            profile.TotalRamMb = 8192; // Assume 8GB as fallback
        }

        // CPU core count
        profile.CpuCores = Environment.ProcessorCount;

        // GPU detection — check if NVIDIA or AMD GPU is available
        profile.HasNvidiaGpu = CheckNvidiaGpu();
        profile.HasAmdGpu = CheckAmdGpu();
        profile.HasGpu = profile.HasNvidiaGpu || profile.HasAmdGpu;

        // Estimate VRAM (rough — actual detection requires GPU-specific APIs)
        if (profile.HasGpu)
        {
            // We can't easily detect VRAM from C# without GPU APIs,
            // so we'll check via Ollama's model loading behavior
            profile.EstimatedVramMb = EstimateVram(profile);
        }

        // Generate recommendations
        profile.Recommendations = GenerateRecommendations(profile);
        profile.Tier = ClassifyTier(profile);

        return profile;
    }

    /// <summary>
    /// Returns model recommendations based on hardware profile.
    /// </summary>
    private static List<ModelRecommendation> GenerateRecommendations(HardwareProfile hw)
    {
        var recs = new List<ModelRecommendation>();

        if (hw.HasGpu && hw.TotalRamMb >= 32768)
        {
            // ═══ POWER USER (24GB+ VRAM or 32GB+ unified memory) ═══
            recs.Add(new ModelRecommendation
            {
                ModelName = "qwen3.5:27b",
                DisplayName = "Qwen 3.5 27B",
                PullCommand = "ollama pull qwen3.5:27b",
                Tier = HardwareTier.PowerUser,
                BestFor = "Best overall quality — rivals cloud models",
                SpeedEstimate = "20-40 tok/s on GPU",
                RamRequired = "20 GB",
                IsRecommended = true
            });
            recs.Add(new ModelRecommendation
            {
                ModelName = "qwen3.5:35b-a3b",
                DisplayName = "Qwen 3.5 35B MoE",
                PullCommand = "ollama pull qwen3.5:35b-a3b",
                Tier = HardwareTier.PowerUser,
                BestFor = "Ultra-fast — 112 tok/s, quality tradeoff",
                SpeedEstimate = "80-112 tok/s on GPU",
                RamRequired = "16 GB"
            });
            recs.Add(new ModelRecommendation
            {
                ModelName = "deepseek-r1:14b",
                DisplayName = "DeepSeek R1 14B",
                PullCommand = "ollama pull deepseek-r1:14b",
                Tier = HardwareTier.PowerUser,
                BestFor = "Deep reasoning and debugging",
                SpeedEstimate = "30-50 tok/s on GPU",
                RamRequired = "12 GB"
            });
        }

        if (hw.HasGpu && hw.TotalRamMb >= 16384)
        {
            // ═══ STANDARD (16GB RAM + GPU) ═══
            recs.Add(new ModelRecommendation
            {
                ModelName = "qwen3.5:9b",
                DisplayName = "Qwen 3.5 9B",
                PullCommand = "ollama pull qwen3.5:9b",
                Tier = HardwareTier.Standard,
                BestFor = "Best balance of quality and speed for PAiA",
                SpeedEstimate = "40-70 tok/s on GPU",
                RamRequired = "8 GB",
                IsRecommended = hw.TotalRamMb < 32768
            });
            recs.Add(new ModelRecommendation
            {
                ModelName = "qwen2.5-coder:14b",
                DisplayName = "Qwen 2.5 Coder 14B",
                PullCommand = "ollama pull qwen2.5-coder:14b",
                Tier = HardwareTier.Standard,
                BestFor = "Code-focused tasks (IDE, terminal, errors)",
                SpeedEstimate = "30-50 tok/s on GPU",
                RamRequired = "10 GB"
            });
            recs.Add(new ModelRecommendation
            {
                ModelName = "llama4:8b",
                DisplayName = "Llama 4 8B",
                PullCommand = "ollama pull llama4:8b",
                Tier = HardwareTier.Standard,
                BestFor = "General purpose, Meta's latest",
                SpeedEstimate = "50-80 tok/s on GPU",
                RamRequired = "6 GB"
            });
        }

        if (hw.HasGpu && hw.TotalRamMb >= 8192)
        {
            // ═══ BUDGET GPU (8GB RAM + basic GPU) ═══
            recs.Add(new ModelRecommendation
            {
                ModelName = "qwen3:7b",
                DisplayName = "Qwen 3 7B",
                PullCommand = "ollama pull qwen3:7b",
                Tier = HardwareTier.Budget,
                BestFor = "Best all-rounder for 8GB systems",
                SpeedEstimate = "30-60 tok/s on GPU",
                RamRequired = "5 GB",
                IsRecommended = hw.TotalRamMb < 16384 && hw.HasGpu
            });
        }

        // ═══ CPU-ONLY (always include these as fallback) ═══
        recs.Add(new ModelRecommendation
        {
            ModelName = "phi4-mini",
            DisplayName = "Phi-4 Mini (3.8B)",
            PullCommand = "ollama pull phi4-mini",
            Tier = HardwareTier.CpuOnly,
            BestFor = "CPU-only systems — fastest usable model",
            SpeedEstimate = hw.HasGpu ? "60+ tok/s" : "8-15 tok/s on CPU",
            RamRequired = "3 GB",
            IsRecommended = !hw.HasGpu
        });
        recs.Add(new ModelRecommendation
        {
            ModelName = "gemma3:1b",
            DisplayName = "Gemma 3 1B",
            PullCommand = "ollama pull gemma3:1b",
            Tier = HardwareTier.CpuOnly,
            BestFor = "Ultra-light — works on very weak hardware",
            SpeedEstimate = hw.HasGpu ? "100+ tok/s" : "15-25 tok/s on CPU",
            RamRequired = "1.5 GB"
        });
        recs.Add(new ModelRecommendation
        {
            ModelName = "qwen3:0.6b",
            DisplayName = "Qwen 3 0.6B",
            PullCommand = "ollama pull qwen3:0.6b",
            Tier = HardwareTier.CpuOnly,
            BestFor = "Absolute minimum — runs on anything",
            SpeedEstimate = "20-40 tok/s on CPU",
            RamRequired = "1 GB"
        });

        return recs;
    }

    /// <summary>
    /// Returns the best context-specific model from installed models.
    /// </summary>
    public static string? GetBestModelForContext(string contextType, List<string> installedModels)
    {
        // Priority order per context type
        var preferences = contextType.ToLowerInvariant() switch
        {
            "code" or "terminal" => new[]
            {
                "qwen2.5-coder", "qwen3-coder", "qwen3.5", "deepseek-coder",
                "qwen3", "llama4", "phi4"
            },
            "error" => new[]
            {
                "deepseek-r1", "qwen3.5", "qwen3", "llama4", "phi4"
            },
            "email" or "document" or "chat" => new[]
            {
                "qwen3.5", "llama4", "qwen3", "gemma3", "phi4"
            },
            "form" or "spreadsheet" => new[]
            {
                "qwen3", "qwen3.5", "phi4", "llama4"
            },
            _ => new[]
            {
                "qwen3.5", "qwen3", "llama4", "phi4", "gemma3"
            }
        };

        // Find best installed model matching preferences
        foreach (var pref in preferences)
        {
            var match = installedModels.FirstOrDefault(m =>
                m.Contains(pref, StringComparison.OrdinalIgnoreCase));
            if (match is not null) return match;
        }

        // Fallback: return first installed model
        return installedModels.FirstOrDefault();
    }

    // ─── Hardware detection helpers ────────────────────────────────

    private static bool CheckNvidiaGpu()
    {
        try
        {
            var psi = new ProcessStartInfo("nvidia-smi", "--query-gpu=name --format=csv,noheader")
            {
                RedirectStandardOutput = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            using var proc = Process.Start(psi);
            if (proc is null) return false;
            var output = proc.StandardOutput.ReadToEnd();
            proc.WaitForExit(3000);
            return !string.IsNullOrWhiteSpace(output) && proc.ExitCode == 0;
        }
        catch { return false; }
    }

    private static bool CheckAmdGpu()
    {
        // Check for AMD GPU via registry or known AMD tools
        try
        {
            return File.Exists(@"C:\Windows\System32\amdvlk64.dll") ||
                   File.Exists(@"C:\Windows\System32\DriverStore\FileRepository\u0*.inf_amd64_*\atikmdag.sys");
        }
        catch { return false; }
    }

    private static int EstimateVram(HardwareProfile hw)
    {
        // Rough estimation — actual VRAM detection would require DirectX or NVML
        if (hw.HasNvidiaGpu)
        {
            try
            {
                var psi = new ProcessStartInfo("nvidia-smi",
                    "--query-gpu=memory.total --format=csv,noheader,nounits")
                {
                    RedirectStandardOutput = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                using var proc = Process.Start(psi);
                if (proc is not null)
                {
                    var output = proc.StandardOutput.ReadToEnd().Trim();
                    proc.WaitForExit(3000);
                    if (int.TryParse(output, out var vram))
                        return vram;
                }
            }
            catch { }
        }
        // Fallback estimates
        return hw.TotalRamMb >= 32768 ? 8192 : 4096;
    }

    private static HardwareTier ClassifyTier(HardwareProfile hw)
    {
        if (!hw.HasGpu) return HardwareTier.CpuOnly;
        if (hw.TotalRamMb >= 32768 || hw.EstimatedVramMb >= 20480) return HardwareTier.PowerUser;
        if (hw.TotalRamMb >= 16384 || hw.EstimatedVramMb >= 8192) return HardwareTier.Standard;
        return HardwareTier.Budget;
    }
}

// ═══ Models ═══════════════════════════════════════════════════════

public sealed class HardwareProfile
{
    public int TotalRamMb { get; set; }
    public int CpuCores { get; set; }
    public bool HasGpu { get; set; }
    public bool HasNvidiaGpu { get; set; }
    public bool HasAmdGpu { get; set; }
    public int EstimatedVramMb { get; set; }
    public HardwareTier Tier { get; set; }
    public List<ModelRecommendation> Recommendations { get; set; } = [];

    public string GetSummary()
    {
        var gpu = HasGpu
            ? $"GPU detected ({(HasNvidiaGpu ? "NVIDIA" : "AMD")}, ~{EstimatedVramMb / 1024.0:F1} GB VRAM)"
            : "No dedicated GPU — CPU-only mode";

        return $"RAM: {TotalRamMb / 1024.0:F1} GB | CPU: {CpuCores} cores | {gpu} | Tier: {Tier}";
    }
}

public sealed class ModelRecommendation
{
    public string ModelName { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string PullCommand { get; set; } = "";
    public HardwareTier Tier { get; set; }
    public string BestFor { get; set; } = "";
    public string SpeedEstimate { get; set; } = "";
    public string RamRequired { get; set; } = "";
    public bool IsRecommended { get; set; }
}

public enum HardwareTier
{
    CpuOnly,    // No GPU — use tiny models
    Budget,     // 8GB RAM + basic GPU
    Standard,   // 16GB RAM + decent GPU
    PowerUser   // 24GB+ VRAM or 32GB+ unified
}
