using System.Text.Json;
using PAiA.WinUI.Models;

namespace PAiA.WinUI.Services.Plugin;

/// <summary>
/// PAiA's plugin system — extend PAiA without modifying core code.
/// 
/// Plugins are JSON files in %LOCALAPPDATA%\PAiA\Plugins\
/// Each plugin can add:
/// - Custom context types (detect new app categories)
/// - Quick actions (new one-click buttons)
/// - System prompts (specialized AI behavior)
/// - Redaction patterns (domain-specific PII)
/// - Detection rules (keywords that identify the context)
/// 
/// Example plugin: "jira-helper.json" adds JIRA-specific context detection,
/// quick actions like "Create subtask" and "Link issue", and redaction for
/// internal ticket IDs.
/// </summary>
public sealed class PluginManager
{
    private readonly string _pluginDir;
    private readonly List<PluginDefinition> _plugins = [];

    public IReadOnlyList<PluginDefinition> Plugins => _plugins;

    public PluginManager()
    {
        _pluginDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "PAiA", "Plugins");
        Directory.CreateDirectory(_pluginDir);
    }

    /// <summary>
    /// Loads all plugins from the plugins directory.
    /// </summary>
    public void LoadAll()
    {
        _plugins.Clear();
        foreach (var file in Directory.GetFiles(_pluginDir, "*.json"))
        {
            try
            {
                var json = File.ReadAllText(file);
                var plugin = JsonSerializer.Deserialize<PluginDefinition>(json,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                if (plugin is not null && plugin.Enabled)
                {
                    plugin.FilePath = file;
                    _plugins.Add(plugin);
                }
            }
            catch { /* Skip invalid plugins */ }
        }
    }

    /// <summary>
    /// Checks if any plugin matches the current screen content.
    /// Returns the first matching plugin, or null.
    /// </summary>
    public PluginDefinition? DetectPlugin(string ocrText, string windowTitle)
    {
        var lower = ocrText.ToLowerInvariant();
        var titleLower = windowTitle.ToLowerInvariant();

        foreach (var plugin in _plugins)
        {
            var matchCount = 0;
            foreach (var keyword in plugin.DetectionKeywords)
            {
                if (lower.Contains(keyword.ToLowerInvariant()) ||
                    titleLower.Contains(keyword.ToLowerInvariant()))
                    matchCount++;
            }

            if (matchCount >= plugin.MinKeywordMatches)
                return plugin;
        }

        return null;
    }

    /// <summary>
    /// Gets quick actions from a matching plugin.
    /// </summary>
    public List<QuickAction> GetPluginActions(PluginDefinition plugin)
    {
        return plugin.QuickActions.Select(a => new QuickAction
        {
            Label = a.Label,
            Prompt = a.Prompt,
            Icon = a.Icon ?? "\uE946"
        }).ToList();
    }

    /// <summary>
    /// Creates a sample plugin file as a template.
    /// </summary>
    public void CreateSamplePlugin()
    {
        var sample = new PluginDefinition
        {
            Name = "JIRA Helper",
            Description = "Adds JIRA-specific context detection and actions",
            Version = "1.0",
            Enabled = true,
            DetectionKeywords = ["jira", "sprint", "backlog", "story points", "epic"],
            MinKeywordMatches = 2,
            SystemPrompt = "You are a JIRA project management assistant. Help with ticket management, sprint planning, and agile workflows.",
            QuickActions =
            [
                new PluginAction { Label = "Summarize ticket", Prompt = "Summarize this JIRA ticket: key details, status, and next steps.", Icon = "\uE8C8" },
                new PluginAction { Label = "Write acceptance criteria", Prompt = "Write acceptance criteria for the user story shown on screen.", Icon = "\uE70F" },
                new PluginAction { Label = "Estimate story points", Prompt = "Estimate story points for this ticket based on complexity.", Icon = "\uE8EF" },
                new PluginAction { Label = "Draft standup update", Prompt = "Draft a standup update based on this ticket's status.", Icon = "\uE715" }
            ],
            RedactionPatterns =
            [
                new PluginRedaction { Name = "JIRA Tickets", Pattern = @"\b[A-Z]{2,10}-\d{1,6}\b", IsRegex = true }
            ]
        };

        var json = JsonSerializer.Serialize(sample, new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(Path.Combine(_pluginDir, "_sample-jira-helper.json"), json);
    }
}

// ═══ Plugin Data Models ═══════════════════════════════════════════

public sealed class PluginDefinition
{
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public string Version { get; set; } = "1.0";
    public bool Enabled { get; set; } = true;
    public string? FilePath { get; set; }

    /// <summary>Keywords that trigger this plugin's context.</summary>
    public List<string> DetectionKeywords { get; set; } = [];

    /// <summary>Minimum keyword matches to activate (prevents false positives).</summary>
    public int MinKeywordMatches { get; set; } = 2;

    /// <summary>Custom system prompt for the LLM when this plugin is active.</summary>
    public string SystemPrompt { get; set; } = "";

    /// <summary>Quick action buttons shown when this plugin matches.</summary>
    public List<PluginAction> QuickActions { get; set; } = [];

    /// <summary>Additional redaction patterns specific to this plugin's domain.</summary>
    public List<PluginRedaction> RedactionPatterns { get; set; } = [];
}

public sealed class PluginAction
{
    public string Label { get; set; } = "";
    public string Prompt { get; set; } = "";
    public string? Icon { get; set; }
}

public sealed class PluginRedaction
{
    public string Name { get; set; } = "";
    public string Pattern { get; set; } = "";
    public bool IsRegex { get; set; }
}
