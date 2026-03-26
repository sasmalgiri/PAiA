using System.Text.Json;

namespace PAiA.WinUI.Services.Privacy;

/// <summary>
/// Manages explicit user consent for PAiA operations.
/// 
/// ENFORCES:
/// - First-run consent dialog explaining exactly what PAiA does
/// - Per-session consent tracking (user must have accepted terms)
/// - Consent can be revoked at any time (wipes all data)
/// - Consent state is stored locally in a simple JSON file
/// 
/// Paddle/payment processors can audit this to verify user opted in.
/// </summary>
public sealed class ConsentManager
{
    private readonly string _consentFilePath;
    private ConsentRecord? _consent;

    public bool HasConsented => _consent?.Accepted == true;
    public DateTimeOffset? ConsentDate => _consent?.AcceptedAt;

    public ConsentManager()
    {
        var appData = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "PAiA");
        Directory.CreateDirectory(appData);
        _consentFilePath = Path.Combine(appData, "consent.json");
        Load();
    }

    /// <summary>
    /// Returns the consent text shown to the user on first run.
    /// This is the complete, honest disclosure of what PAiA does.
    /// </summary>
    public static string GetConsentText() => """
        PAiA — Privacy Disclosure & Consent

        PAiA is a screen assistant that runs entirely on your machine.
        Before using PAiA, please understand exactly what it does:

        WHAT PAiA DOES:
        ✅ Captures your screen ONLY when you click "Capture Screen"
        ✅ Extracts text from the capture using Windows built-in OCR
        ✅ Automatically removes sensitive data (credit cards, SSNs, emails, 
           API keys, passwords) before any AI processing
        ✅ Sends the cleaned text to your LOCAL Ollama AI instance (localhost only)
        ✅ Keeps an audit log of operations (redacted text only, no screenshots)
        ✅ Provides a transparency report you can check at any time

        WHAT PAiA NEVER DOES:
        ❌ Never captures your screen without you clicking the button
        ❌ Never runs in the background or monitors your activity
        ❌ Never records keystrokes
        ❌ Never saves screenshots to disk (images stay in RAM only)
        ❌ Never sends any data to the internet (only localhost)
        ❌ Never stores unredacted personal information
        ❌ Never transmits data to Anthropic, OpenAI, or any cloud service

        YOUR DATA:
        • All data is stored in: %LOCALAPPDATA%\PAiA
        • You can delete all data at any time from Settings
        • Revoking consent immediately deletes all PAiA data
        • PAiA's code can be audited — see the source in the install directory

        By clicking "I Agree", you consent to the operations described above.
        You can revoke consent at any time from PAiA's Settings menu.
        """;

    /// <summary>
    /// Records that the user accepted the consent terms.
    /// </summary>
    public void Accept()
    {
        _consent = new ConsentRecord
        {
            Accepted = true,
            AcceptedAt = DateTimeOffset.Now,
            Version = GetConsentVersion(),
            AppVersion = GetAppVersion()
        };
        Save();
    }

    /// <summary>
    /// Revokes consent and deletes ALL PAiA data.
    /// </summary>
    public void Revoke()
    {
        _consent = new ConsentRecord { Accepted = false };
        Save();

        // Delete all PAiA data
        var dataDir = Path.GetDirectoryName(_consentFilePath)!;
        foreach (var file in Directory.GetFiles(dataDir))
        {
            if (!file.EndsWith("consent.json", StringComparison.OrdinalIgnoreCase))
            {
                try { File.Delete(file); } catch { /* best effort */ }
            }
        }

        // Delete audit logs subdirectory
        var auditDir = Path.Combine(dataDir, "AuditLogs");
        if (Directory.Exists(auditDir))
        {
            try { Directory.Delete(auditDir, true); } catch { /* best effort */ }
        }
    }

    /// <summary>
    /// Checks if consent needs to be re-obtained (e.g., after consent text update).
    /// </summary>
    public bool NeedsReconsent()
    {
        if (_consent is null || !_consent.Accepted) return true;
        return _consent.Version != GetConsentVersion();
    }

    private void Load()
    {
        if (!File.Exists(_consentFilePath)) return;
        try
        {
            var json = File.ReadAllText(_consentFilePath);
            _consent = JsonSerializer.Deserialize<ConsentRecord>(json);
        }
        catch { _consent = null; }
    }

    private void Save()
    {
        var json = JsonSerializer.Serialize(_consent, new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(_consentFilePath, json);
    }

    /// <summary>
    /// Bump this when the consent text changes materially.
    /// Users will be re-prompted.
    /// </summary>
    private static string GetConsentVersion() => "1.0.0";

    private static string GetAppVersion() =>
        System.Reflection.Assembly.GetExecutingAssembly()?.GetName()?.Version?.ToString() ?? "0.0.0";

    private sealed class ConsentRecord
    {
        public bool Accepted { get; set; }
        public DateTimeOffset? AcceptedAt { get; set; }
        public string Version { get; set; } = "";
        public string AppVersion { get; set; } = "";
    }
}
