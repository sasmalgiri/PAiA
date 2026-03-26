namespace PAiA.WinUI.Services.Privacy;

/// <summary>
/// Detects and blocks capture of sensitive applications.
/// Even though capture is user-initiated, we add an extra safety layer
/// to warn before capturing banking apps, password managers, etc.
/// 
/// The user can still proceed (it's their machine), but they get
/// a clear warning first.
/// </summary>
public sealed class SensitiveAppFilter
{
    /// <summary>
    /// Window title patterns that trigger a privacy warning.
    /// Case-insensitive matching.
    /// </summary>
    private static readonly string[] SensitivePatterns =
    [
        // Banking
        "bank", "banking", "chase", "wells fargo", "citibank", "hdfc",
        "icici", "sbi ", "axis bank", "kotak", "barclays",
        "net banking", "internet banking", "online banking",

        // Password managers
        "1password", "lastpass", "bitwarden", "keepass", "dashlane",
        "nordpass", "enpass", "roboform",

        // Payment / finance
        "paypal", "venmo", "stripe dashboard", "razorpay", "paytm",
        "gpay", "phonepe", "credit card", "debit card",

        // Authentication
        "authenticator", "two-factor", "2fa", "otp",
        "security code", "verification code",

        // Healthcare
        "patient portal", "medical record", "health record",
        "mychart", "epic ", "ehr ",

        // Crypto
        "metamask", "ledger", "trezor", "coinbase", "binance wallet",
        "seed phrase", "recovery phrase", "private key",

        // Tax / legal
        "tax return", "itr filing", "turbotax", "h&r block",

        // VPN / Security tools
        "vpn", "tor browser",
    ];

    /// <summary>
    /// Process names that are inherently sensitive.
    /// </summary>
    private static readonly string[] SensitiveProcesses =
    [
        "1password", "lastpass", "bitwarden", "keepass",
        "dashlane", "nordpass",
    ];

    /// <summary>
    /// Checks if a captured window title suggests sensitive content.
    /// Returns a warning message if sensitive, null if safe.
    /// </summary>
    public static string? CheckWindowTitle(string windowTitle)
    {
        if (string.IsNullOrWhiteSpace(windowTitle)) return null;

        var lower = windowTitle.ToLowerInvariant();
        foreach (var pattern in SensitivePatterns)
        {
            if (lower.Contains(pattern))
            {
                return $"⚠️ This looks like a sensitive application ({pattern}).\n\n" +
                       "PAiA will redact detected PII, but some sensitive information " +
                       "might not be caught by automatic redaction.\n\n" +
                       "Do you want to continue?";
            }
        }

        return null;
    }

    /// <summary>
    /// Checks a process name against the sensitive apps list.
    /// </summary>
    public static bool IsSensitiveProcess(string processName)
    {
        if (string.IsNullOrWhiteSpace(processName)) return false;
        var lower = processName.ToLowerInvariant();
        return SensitiveProcesses.Any(p => lower.Contains(p));
    }
}
