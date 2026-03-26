using System.Text.Json;
using System.Text.RegularExpressions;

namespace PAiA.WinUI.Services.Redaction;

/// <summary>
/// User-defined redaction rules that run BEFORE the built-in patterns.
/// 
/// Problem: Your company has internal project codenames (Project Falcon),
/// internal IPs (10.0.x.x), and employee names you don't want even your
/// local LLM to process.
/// 
/// Solution: Add custom rules. They're stored locally and applied on
/// every capture. You control what gets scrubbed.
/// 
/// Rules are stored in %LOCALAPPDATA%\PAiA\custom-redaction.json
/// </summary>
public sealed class CustomRedactionRules
{
    private readonly string _rulesPath;
    private List<CustomRule> _rules = [];

    public IReadOnlyList<CustomRule> Rules => _rules;

    public CustomRedactionRules()
    {
        _rulesPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "PAiA", "custom-redaction.json");
        Load();
    }

    /// <summary>
    /// Applies all custom rules to the text. Returns the scrubbed result.
    /// </summary>
    public string Apply(string text)
    {
        if (_rules.Count == 0 || string.IsNullOrEmpty(text))
            return text;

        var result = text;
        foreach (var rule in _rules.Where(r => r.Enabled))
        {
            try
            {
                if (rule.IsRegex)
                {
                    result = Regex.Replace(result, rule.Pattern, rule.Replacement,
                        RegexOptions.IgnoreCase, TimeSpan.FromSeconds(1));
                }
                else
                {
                    result = result.Replace(rule.Pattern, rule.Replacement,
                        StringComparison.OrdinalIgnoreCase);
                }
            }
            catch (RegexMatchTimeoutException)
            {
                // Skip slow regexes — don't let user rules hang the app
            }
            catch (ArgumentException)
            {
                // Skip invalid regex patterns
            }
        }

        return result;
    }

    /// <summary>
    /// Returns how many matches each rule would find (for preview).
    /// </summary>
    public int CountMatches(string text, CustomRule rule)
    {
        try
        {
            if (rule.IsRegex)
                return Regex.Matches(text, rule.Pattern, RegexOptions.IgnoreCase,
                    TimeSpan.FromSeconds(1)).Count;
            else
                return CountOccurrences(text, rule.Pattern);
        }
        catch { return 0; }
    }

    // ─── CRUD Operations ───────────────────────────────────────────

    public void Add(string name, string pattern, string? replacement = null, bool isRegex = false)
    {
        _rules.Add(new CustomRule
        {
            Id = Guid.NewGuid().ToString("N")[..8],
            Name = name,
            Pattern = pattern,
            Replacement = replacement ?? $"[{name.ToUpperInvariant()}-REDACTED]",
            IsRegex = isRegex,
            Enabled = true,
            CreatedAt = DateTimeOffset.Now
        });
        Save();
    }

    public void Remove(string ruleId)
    {
        _rules.RemoveAll(r => r.Id == ruleId);
        Save();
    }

    public void Toggle(string ruleId)
    {
        var rule = _rules.FirstOrDefault(r => r.Id == ruleId);
        if (rule is not null)
        {
            rule.Enabled = !rule.Enabled;
            Save();
        }
    }

    public void Update(string ruleId, string? name = null, string? pattern = null,
        string? replacement = null, bool? isRegex = null)
    {
        var rule = _rules.FirstOrDefault(r => r.Id == ruleId);
        if (rule is null) return;

        if (name is not null) rule.Name = name;
        if (pattern is not null) rule.Pattern = pattern;
        if (replacement is not null) rule.Replacement = replacement;
        if (isRegex.HasValue) rule.IsRegex = isRegex.Value;
        Save();
    }

    /// <summary>
    /// Returns some pre-built templates users can start with.
    /// </summary>
    public static List<(string name, string pattern, bool isRegex)> GetTemplates() =>
    [
        ("Company name",        "YourCompanyName",              false),
        ("Internal IPs",        @"\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b", true),
        ("Internal domains",    @"\b\w+\.internal\.company\.com\b",    true),
        ("Employee names",      "John Doe",                     false),
        ("Project codename",    "Project Falcon",               false),
        ("Slack channels",      @"#[a-z0-9\-_]+",              true),
        ("JIRA tickets",        @"\b[A-Z]{2,10}-\d{1,6}\b",   true),
        ("Internal URLs",       @"https?://[a-z]+\.internal\.[a-z]+\.\w+[^\s]*", true),
    ];

    // ─── Persistence ───────────────────────────────────────────────

    private void Load()
    {
        if (!File.Exists(_rulesPath)) return;
        try
        {
            var json = File.ReadAllText(_rulesPath);
            _rules = JsonSerializer.Deserialize<List<CustomRule>>(json,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? [];
        }
        catch { _rules = []; }
    }

    private void Save()
    {
        var json = JsonSerializer.Serialize(_rules,
            new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(_rulesPath, json);
    }

    private static int CountOccurrences(string text, string pattern)
    {
        int count = 0, idx = 0;
        var lower = text.ToLowerInvariant();
        var lowerPattern = pattern.ToLowerInvariant();
        while ((idx = lower.IndexOf(lowerPattern, idx, StringComparison.Ordinal)) != -1)
        { count++; idx += lowerPattern.Length; }
        return count;
    }
}

public sealed class CustomRule
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Pattern { get; set; } = "";
    public string Replacement { get; set; } = "";
    public bool IsRegex { get; set; }
    public bool Enabled { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; }
}
