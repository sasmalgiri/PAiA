using PAiA.WinUI.Models;
using PAiA.WinUI.Services.Context;
using PAiA.WinUI.Services.Ocr;
using PAiA.WinUI.Services.Redaction;
using PAiA.WinUI.Services.Safety;
using Windows.Graphics.Imaging;

namespace PAiA.WinUI.Services.ScreenIntel;

/// <summary>
/// PAiA's unified screen intelligence pipeline.
/// 
/// OLD APPROACH (fragile):
///   Screenshot → OCR → Regex redact → Send text to LLM
///   Problems: misses layout, can't see icons, no control types,
///   bad with non-text content, regex misses contextual PII
/// 
/// NEW APPROACH (multi-signal fusion):
///   Screenshot → [4 parallel signals] → Fuse → Enrich → Send to LLM
///   
///   Signal 1: OCR (text content — works on everything)
///   Signal 2: UI Automation (structured controls — works on native apps)
///   Signal 3: Vision model (visual understanding — works on any content)
///   Signal 4: Active window metadata (app name, URL, file path)
///   
///   Fusion: Combine all signals into a rich ScreenIntelResult
///   Enrich: Run NER for contextual PII, detect layout, classify content
/// 
/// Each signal has fallbacks — if one fails, others compensate.
/// </summary>
public sealed class ScreenIntelPipeline
{
    private readonly OcrService _ocr;
    private readonly UIAutomationService _uiAutomation;
    private readonly VisionService _vision;
    private readonly NerService _ner;
    private readonly RedactionService _redact;
    private readonly CustomRedactionRules _customRedact;
    private readonly SmartContextService _context;

    public ScreenIntelPipeline(
        OcrService ocr,
        UIAutomationService uiAutomation,
        VisionService vision,
        NerService ner,
        RedactionService redact,
        CustomRedactionRules customRedact,
        SmartContextService context)
    {
        _ocr = ocr;
        _uiAutomation = uiAutomation;
        _vision = vision;
        _ner = ner;
        _redact = redact;
        _customRedact = customRedact;
        _context = context;
    }

    /// <summary>
    /// Runs the full multi-signal pipeline on a captured screenshot.
    /// </summary>
    public async Task<ScreenIntelResult> AnalyzeAsync(
        SoftwareBitmap bitmap,
        IntPtr windowHandle,
        CancellationToken ct = default)
    {
        var result = new ScreenIntelResult
        {
            CapturedAt = DateTimeOffset.Now,
            WindowHandle = windowHandle
        };

        var sw = System.Diagnostics.Stopwatch.StartNew();

        // ═══ Run signals in parallel where possible ═══

        // Signal 1: OCR (always runs — universal fallback)
        // NOTE: bitmap lifecycle managed by caller (MainWindow) — do NOT wrap again
        result.RawOcrText = await _ocr.ExtractTextAsync(bitmap);
        result.Signals.Add("OCR", !string.IsNullOrEmpty(result.RawOcrText));

        // Signal 2: UI Automation (parallel — structured data)
        try
        {
            result.UITree = _uiAutomation.CaptureUITree(windowHandle);
            result.Signals.Add("UIAutomation", result.UITree.Success);
        }
        catch
        {
            result.UITree = new UITreeSnapshot { Success = false, FallbackReason = "Exception" };
            result.Signals.Add("UIAutomation", false);
        }

        // Signal 3: Active window metadata
        try
        {
            result.WindowInfo = ActiveWindowInfo.FromHandle(windowHandle);
            result.Signals.Add("WindowInfo", true);
        }
        catch
        {
            result.WindowInfo = new ActiveWindowInfo();
            result.Signals.Add("WindowInfo", false);
        }

        // Signal 4: Vision model (if available — async)
        if (_vision.IsAvailable)
        {
            try
            {
                result.VisionDescription = await _vision.DescribeScreenAsync(bitmap, ct);
                result.Signals.Add("Vision", !string.IsNullOrEmpty(result.VisionDescription));
            }
            catch
            {
                result.Signals.Add("Vision", false);
            }
        }

        // ═══ Fuse signals ═══
        result.FusedText = FuseSignals(result);

        // ═══ Multi-layer redaction ═══
        // Layer 1: Custom rules (company-specific)
        result.RedactedText = _customRedact.Apply(result.FusedText);
        // Layer 2: Built-in regex patterns
        result.RegexRedactionCount = _redact.CountMatches(result.RedactedText);
        result.RedactedText = _redact.Redact(result.RedactedText);
        // Layer 3: NER-based contextual PII detection
        var nerResults = _ner.DetectEntities(result.RedactedText);
        result.NerEntities = nerResults;
        result.RedactedText = _ner.RedactEntities(result.RedactedText, nerResults);
        result.NerRedactionCount = nerResults.Count(e => e.IsRedacted);

        result.TotalRedactionCount = result.RegexRedactionCount + result.NerRedactionCount;

        // ═══ Link Safety Scan (runs on raw text to catch URLs) ═══
        var linkScanner = new Safety.LinkSafetyService();
        result.LinkSafety = linkScanner.AnalyzeText(result.RawOcrText);

        // ═══ Smart context detection (uses all signals) ═══
        result.Context = DetectContextFromAllSignals(result);

        sw.Stop();
        result.ProcessingTime = sw.Elapsed;

        return result;
    }

    /// <summary>
    /// Combines all signals into a single rich text representation
    /// that gives the LLM maximum context.
    /// </summary>
    private static string FuseSignals(ScreenIntelResult result)
    {
        var sb = new System.Text.StringBuilder();

        // Start with window metadata
        if (result.WindowInfo is not null && !string.IsNullOrEmpty(result.WindowInfo.Title))
        {
            sb.AppendLine($"[Window: {result.WindowInfo.Title}]");
            if (!string.IsNullOrEmpty(result.WindowInfo.ProcessName))
                sb.AppendLine($"[App: {result.WindowInfo.ProcessName}]");
            if (!string.IsNullOrEmpty(result.WindowInfo.Url))
                sb.AppendLine($"[URL: {result.WindowInfo.Url}]");
        }

        // Prefer UI Automation data when available (more structured)
        if (result.UITree?.Success == true && result.UITree.Elements.Count > 3)
        {
            sb.AppendLine();
            sb.AppendLine("=== UI STRUCTURE ===");
            sb.AppendLine(result.UITree.StructuredText);
        }

        // Always include OCR (catches things UIA misses)
        if (!string.IsNullOrEmpty(result.RawOcrText))
        {
            sb.AppendLine();
            sb.AppendLine("=== SCREEN TEXT (OCR) ===");
            sb.AppendLine(result.RawOcrText);
        }

        // Add vision description if available
        if (!string.IsNullOrEmpty(result.VisionDescription))
        {
            sb.AppendLine();
            sb.AppendLine("=== VISUAL DESCRIPTION ===");
            sb.AppendLine(result.VisionDescription);
        }

        return sb.ToString();
    }

    /// <summary>
    /// Enhanced context detection using ALL signals, not just OCR text.
    /// </summary>
    private ScreenContext DetectContextFromAllSignals(ScreenIntelResult result)
    {
        var windowTitle = result.WindowInfo?.Title ?? "";
        var processName = result.WindowInfo?.ProcessName ?? "";

        // Use UI Automation data for better detection
        var hasTextInputs = result.UITree?.Elements.Count(e =>
            e.ControlType is "edit" or "document") > 0;
        var hasButtons = result.UITree?.Elements.Count(e =>
            e.ControlType is "button") > 0;
        var hasMenu = result.UITree?.Elements.Count(e =>
            e.ControlType is "menu item" or "menu bar") > 0;

        // Fall back to heuristic detection with enriched signals
        var ctx = _context.Detect(result.RedactedText, windowTitle);

        // Enhance with UIA data
        if (result.UITree?.Success == true)
        {
            ctx.Summary += $" ({result.UITree.InteractiveCount} interactive elements)";
        }

        return ctx;
    }
}

/// <summary>
/// Complete result of the multi-signal screen intelligence pipeline.
/// </summary>
public sealed class ScreenIntelResult
{
    public DateTimeOffset CapturedAt { get; set; }
    public IntPtr WindowHandle { get; set; }
    public TimeSpan ProcessingTime { get; set; }

    // Raw signals
    public string RawOcrText { get; set; } = "";
    public UITreeSnapshot? UITree { get; set; }
    public ActiveWindowInfo? WindowInfo { get; set; }
    public string? VisionDescription { get; set; }

    // Signal status
    public Dictionary<string, bool> Signals { get; set; } = [];

    // Fused + redacted
    public string FusedText { get; set; } = "";
    public string RedactedText { get; set; } = "";
    public int RegexRedactionCount { get; set; }
    public int NerRedactionCount { get; set; }
    public int TotalRedactionCount { get; set; }
    public List<NerEntity> NerEntities { get; set; } = [];

    // Context
    public ScreenContext? Context { get; set; }

    // Link safety
    public LinkSafetyReport? LinkSafety { get; set; }

    public string GetSignalSummary()
    {
        var active = Signals.Where(s => s.Value).Select(s => s.Key);
        var failed = Signals.Where(s => !s.Value).Select(s => s.Key);
        return $"Active: {string.Join(", ", active)}" +
               (failed.Any() ? $" | Unavailable: {string.Join(", ", failed)}" : "");
    }
}

/// <summary>
/// Information about the active window from Win32 APIs.
/// </summary>
public sealed class ActiveWindowInfo
{
    public string Title { get; set; } = "";
    public string ProcessName { get; set; } = "";
    public string? Url { get; set; }
    public string? FilePath { get; set; }
    public int ProcessId { get; set; }

    [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    public static ActiveWindowInfo FromHandle(IntPtr hwnd)
    {
        var info = new ActiveWindowInfo();

        // Get window title
        var sb = new System.Text.StringBuilder(512);
        GetWindowText(hwnd, sb, 512);
        info.Title = sb.ToString();

        // Get process info
        GetWindowThreadProcessId(hwnd, out var pid);
        info.ProcessId = (int)pid;
        try
        {
            var proc = System.Diagnostics.Process.GetProcessById((int)pid);
            info.ProcessName = proc.ProcessName;

            // Try to get file path from main module
            try { info.FilePath = proc.MainModule?.FileName; } catch { }
        }
        catch { }

        // Extract URL from browser title (common pattern: "Page Title - Browser")
        if (info.ProcessName is "chrome" or "firefox" or "msedge" or "brave" or "opera")
        {
            // Browser titles often contain the URL or page title
            // We can use UI Automation to get the actual URL from the address bar
            info.Url = ExtractBrowserUrl(hwnd);
        }

        return info;
    }

    private static string? ExtractBrowserUrl(IntPtr hwnd)
    {
        // NOTE: WinUI 3 / .NET 8 cannot reference System.Windows.Automation (WPF-only).
        // The COM-based UIAutomationService provides equivalent functionality and is the
        // intended path for address-bar extraction. Returning null here lets callers fall
        // back to the window-title heuristic without crashing.
        _ = hwnd;
        return null;
    }
}
