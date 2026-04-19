using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using PAiA.WinUI.Controls;
using PAiA.WinUI.Models;
using PAiA.WinUI.Services.Audit;
using PAiA.WinUI.Services.Capture;
using PAiA.WinUI.Services.Chat;
using PAiA.WinUI.Services.Clipboard;
using PAiA.WinUI.Services.Context;
using PAiA.WinUI.Services.FormHelper;
using PAiA.WinUI.Services.History;
using PAiA.WinUI.Services.Hotkey;
using PAiA.WinUI.Services.Llm;
using PAiA.WinUI.Services.Ocr;
using PAiA.WinUI.Services.Packs;
using PAiA.WinUI.Services.Privacy;
using PAiA.WinUI.Services.Redaction;
using PAiA.WinUI.Services.SecurityLab;
using PAiA.WinUI.Services.ScreenIntel;
using PAiA.WinUI.Services.Safety;
using PAiA.WinUI.Services.WebSearch;
using PAiA.WinUI.Services.Voice;
using PAiA.WinUI.Services.Assistant;
using PAiA.WinUI.Services.ActiveWindow;
using PAiA.WinUI.Services.Plugin;
using PAiA.WinUI.Services.Shell;
using Windows.ApplicationModel.DataTransfer;
using Windows.Graphics.Capture;
using System.Runtime.InteropServices;

namespace PAiA.WinUI;

public sealed partial class MainWindow : Window
{
    // ─── Win32 subclass proc for hotkey message interception ────────
    private delegate IntPtr WndProcDelegate(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);
    [DllImport("user32.dll")]
    private static extern IntPtr CallWindowProc(IntPtr lpPrevWndFunc, IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    private const int GWLP_WNDPROC = -4;
    private IntPtr _originalWndProc;
    private WndProcDelegate? _wndProcDelegate; // prevent GC collection
    // ─── ALL Services ──────────────────────────────────────────────
    private readonly ScreenCaptureService _capture;
    private readonly OcrService _ocr;
    private readonly RedactionService _redact;
    private readonly CustomRedactionRules _customRedact;
    private readonly OllamaClient _ollamaRaw;
    private readonly PrivacyGuard _guard;
    private readonly SecureOllamaClient _ollama;
    private readonly AuditLogService _audit;
    private readonly SmartContextService _context;
    private readonly ChatService _chat;
    private readonly PacksRegistry? _packs;
    private readonly FormAnalysisService _formAnalysis;
    private readonly ConsentManager _consent;
    private readonly GlobalHotkeyService _hotkey;
    private readonly SmartClipboardQueue _clipboard;
    private readonly ResponseHistory _history;
    private readonly SecurityLabOrchestrator _securityLab;
    private readonly DataWiper _wiper;
    private readonly LivePrivacyPulse _privacyPulse;
    private readonly OllamaBootstrapper _bootstrapper;
    private readonly SystemTrayService _tray;
    // ─── Screen Intelligence (wired) ──────────────────────────────
    private readonly ScreenIntelPipeline _pipeline;
    private readonly UIAutomationService _uiAutomation;
    private readonly VisionService _vision;
    private readonly NerService _ner;
    private readonly ActiveWindowMonitor _windowMonitor;
    private readonly PluginManager _plugins;
    private readonly WebSearchService _webSearch;
    private readonly SearchQuerySanitizer _searchSanitizer;
    private readonly VoiceService _voice;
    private readonly AssistantOrchestrator _assistant;
    private ProactiveContextEngine _proactiveContext;
    private CompactWidget? _widget;

    // ─── State ─────────────────────────────────────────────────────
    private GraphicsCaptureItem? _captureTarget;
    private ScreenContext? _currentScreen;
    private CancellationTokenSource? _streamCts;
    private bool _isProcessing;
    private TaskCompletionSource<bool>? _captureCompletion;
    private string _lastResponse = "";

    public MainWindow()
    {
        InitializeComponent();
        if (AppWindow is not null) AppWindow.Resize(new Windows.Graphics.SizeInt32(840, 720));

        // --- Initialize ALL services ---
        _capture = new ScreenCaptureService();
        _ocr = new OcrService();
        _redact = new RedactionService();
        _customRedact = new CustomRedactionRules();
        _guard = new PrivacyGuard();
        _ollamaRaw = new OllamaClient();
        _ollama = new SecureOllamaClient(_ollamaRaw, _guard, _redact);
        _audit = new AuditLogService();
        _context = new SmartContextService();
        _chat = new ChatService(_ollama);  // Uses SecureOllamaClient (endpoint + redaction enforced)
        _consent = new ConsentManager();
        _hotkey = new GlobalHotkeyService();
        _clipboard = new SmartClipboardQueue();
        _history = new ResponseHistory();
        _wiper = new DataWiper();
        _formAnalysis = new FormAnalysisService(_ollama);  // Uses SecureOllamaClient

        // Screen Intelligence services (all wired through pipeline)
        _uiAutomation = new UIAutomationService();
        _vision = new VisionService();
        _ner = new NerService();
        _windowMonitor = new ActiveWindowMonitor();
        _plugins = new PluginManager();
        _searchSanitizer = new SearchQuerySanitizer(_redact, _customRedact, _ner);
        _webSearch = new WebSearchService(_searchSanitizer);
        // Web search OFF by default — user enables in Settings
        _webSearch.OnSearchPerformed += query =>
            DispatcherQueue.TryEnqueue(() =>
                StatusLabel.Text = $"🌐 Searched: {query}");

        // Voice + Assistant (disabled by default, user enables in Settings)
        _voice = new VoiceService();
        _assistant = new AssistantOrchestrator(_voice);
        _assistant.StatusChanged += msg =>
            DispatcherQueue.TryEnqueue(() => StatusLabel.Text = msg);
        _assistant.ActionRequested += action =>
            DispatcherQueue.TryEnqueue(() => HandleAssistantAction(action));
        _assistant.SpeakRequested += async text => await SpeakTextAsync(text);

        _pipeline = new ScreenIntelPipeline(
            _ocr, _uiAutomation, _vision, _ner,
            _redact, _customRedact, _context);

        // Ollama bootstrapper (auto-detect + auto-start)
        _bootstrapper = new OllamaBootstrapper();

        // System tray (minimize to tray, context menu)
        _tray = new SystemTrayService(this);
        _tray.Initialize();
        _tray.CaptureRequested += () => DispatcherQueue.TryEnqueue(() => Capture_Click(this, new RoutedEventArgs()));
        _tray.SettingsRequested += () => DispatcherQueue.TryEnqueue(() => Settings_Click(this, new RoutedEventArgs()));

        // Security Lab
        _securityLab = new SecurityLabOrchestrator(_guard, _redact, _customRedact);
        _securityLab.Initialize();

        // Privacy Pulse (always-visible bar)
        _privacyPulse = new LivePrivacyPulse(_guard, PrivacyPulseBar);
        _privacyPulse.Initialize();

        // Packs
        var packsPath = Path.Combine(AppContext.BaseDirectory, "Services", "Packs", "packs.json");
        _packs = File.Exists(packsPath) ? new PacksRegistry(packsPath) : null;

        Activated += OnActivated;

        // Cleanup when app actually exits (not minimize-to-tray)
        _tray.QuitRequested += CleanupServices;
    }

    /// <summary>
    /// Disposes all IDisposable services on app exit.
    /// Called by system tray Quit, not by window close (which minimizes to tray).
    /// </summary>
    private void CleanupServices()
    {
        _windowMonitor.Dispose();
        _hotkey.Dispose();
        _securityLab.Dispose();
        _tray.Dispose();
        _ollama.Dispose();
        _ollamaRaw.Dispose();
        _capture.Dispose();
        _webSearch.Dispose();
        _voice.Dispose();
        _ttsPlayer?.Dispose();
    }

    /// <summary>
    /// Win32 window procedure subclass — intercepts WM_HOTKEY messages.
    /// Without this, RegisterHotKey registers the key but messages never arrive.
    /// </summary>
    private IntPtr SubclassWndProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam)
    {
        _hotkey.ProcessMessage(msg, wParam);
        return CallWindowProc(_originalWndProc, hWnd, msg, wParam, lParam);
    }

    // ═══ STARTUP ═══════════════════════════════════════════════════

    private bool _initialized;
    private async void OnActivated(object sender, WindowActivatedEventArgs e)
    {
        if (_initialized) return;
        _initialized = true;

        // 1. Show consent dialog on first run
        if (_consent.NeedsReconsent())
        {
            var accepted = await ShowConsentDialogAsync();
            if (!accepted)
            {
                Close();
                return;
            }
        }

        // 2. Register global hotkey
        var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
        var registered = _hotkey.Register(hwnd);
        _hotkey.HotkeyPressed += () => DispatcherQueue.TryEnqueue(() => Capture_Click(this, new RoutedEventArgs()));
        HotkeyHint.Text = registered
            ? "Press Ctrl+Shift+P from anywhere to capture"
            : "Hotkey registration failed — use the button";

        // ✅ Install Win32 subclass proc to intercept WM_HOTKEY messages
        // WinUI 3 doesn't expose WndProc — we subclass the window to receive hotkey messages
        if (registered)
        {
            _wndProcDelegate = SubclassWndProc;
            var newWndProc = Marshal.GetFunctionPointerForDelegate(_wndProcDelegate);
            _originalWndProc = SetWindowLongPtr(hwnd, GWLP_WNDPROC, newWndProc);
        }

        // 3. Detect hardware and connect to Ollama
        await ConnectOllamaAsync();

        // 3b. Show hardware profile + model recommendations if no models installed
        var hwProfile = ModelRecommender.DetectHardware();
        StatusLabel.Text = hwProfile.HasGpu
            ? $"Ready — {(hwProfile.HasNvidiaGpu ? "NVIDIA" : "AMD")} GPU detected"
            : "Ready — CPU-only mode (use smaller models for speed)";

        if (ModelPicker.Items.Count == 0)
        {
            await ShowModelRecommendationsAsync(hwProfile);
        }

        // 4. Run proactive hardening (adds missing redaction rules)
        _securityLab.RunProactiveHardening();

        // 5. Load plugins
        _plugins.LoadAll();
        _plugins.CreateSamplePlugin(); // Create sample if none exist

        // 6. Detect vision model (non-blocking)
        _ = _vision.DetectVisionModelAsync();

        // 6b. Start window monitor (provides active app context for captures)
        _windowMonitor.IsEnabled = true;
        _windowMonitor.Start();

        // 6c. Proactive context engine (drives widget quick actions)
        _proactiveContext = new ProactiveContextEngine(_windowMonitor);
        _proactiveContext.ContextChanged += ctx =>
            DispatcherQueue.TryEnqueue(() =>
            {
                // Update compact widget with context-aware actions
                _widget?.UpdateContext($"{ctx.Category}: {ctx.Label}", ctx.Actions);
                _widget?.SetPrivacyStatus(true, _webSearch.IsEnabled);

                // Show auto-suggestion if any
                if (ctx.AutoSuggestion is not null)
                    _widget?.SetStatus(ctx.AutoSuggestion);

                // Sensitive app warning
                if (ctx.SensitiveWarning)
                    StatusLabel.Text = $"⚠ Sensitive app: {ctx.Label}";
            });

        // 6d. Launch compact floating widget
        _widget = new CompactWidget();
        _widget.CaptureRequested += () =>
            DispatcherQueue.TryEnqueue(() => Capture_Click(this, new RoutedEventArgs()));
        _widget.QuickActionClicked += prompt =>
            DispatcherQueue.TryEnqueue(async () =>
            {
                if (_currentScreen is null)
                {
                    // Auto-capture first, then run the action
                    Capture_Click(this, new RoutedEventArgs());
                    // Wait for capture to actually complete (not arbitrary delay)
                    if (_captureCompletion is not null)
                        await _captureCompletion.Task;
                }
                if (_currentScreen is not null)
                    await SendMessageAsync(prompt);
            });
        _widget.MessageSent += msg =>
            DispatcherQueue.TryEnqueue(async () =>
            {
                _widget?.AddMessage(msg);
                if (_currentScreen is not null)
                    await SendMessageAsync(msg);
                else
                    _widget?.AddMessage("Capture a screen first (click 📷 or Ctrl+Shift+P)", true);
            });
        _widget.ExpandRequested += () =>
            DispatcherQueue.TryEnqueue(() =>
            {
                _tray.RestoreFromTray();
            });
        _widget.VoiceRequested += () =>
            DispatcherQueue.TryEnqueue(async () =>
            {
                if (_voice.IsEnabled)
                {
                    _widget?.SetVoiceListening(true);
                    var text = await _voice.ListenOnceAsync();
                    _widget?.SetVoiceListening(false);
                    if (text is not null)
                    {
                        _widget?.AddMessage($"🎤 {text}");
                        var cmd = VoiceService.ParseCommand(text);
                        if (cmd.Type != CommandType.Unknown)
                            HandleAssistantAction(new AssistantAction { Command = cmd, Source = "voice" });
                        else if (_currentScreen is not null)
                            await SendMessageAsync(text);
                    }
                }
                else
                {
                    _widget?.SetStatus("Voice disabled — enable in Settings");
                }
            });
        _widget.Activate();

        _windowMonitor.WindowChanged += (title, process) =>
            DispatcherQueue.TryEnqueue(() =>
            {
                // Pre-check sensitive apps even before capture
                var earlyWarning = SensitiveAppFilter.CheckWindowTitle(title);
                if (earlyWarning is not null)
                    StatusLabel.Text = $"⚠ Sensitive app in focus: {process}";
            });

        // 7. Wire security monitor alerts
        _securityLab.Monitor.AlertRaised += alert =>
            DispatcherQueue.TryEnqueue(() =>
                StatusLabel.Text = $"⚠ {alert.Title}");

        UpdateLogCount();
    }

    private async Task<bool> ShowConsentDialogAsync()
    {
        var dialog = new ContentDialog
        {
            Title = "PAiA — Privacy Disclosure",
            Content = new ScrollViewer
            {
                MaxHeight = 400,
                Content = new TextBlock
                {
                    Text = ConsentManager.GetConsentText(),
                    TextWrapping = TextWrapping.Wrap,
                    FontSize = 13,
                    IsTextSelectionEnabled = true
                }
            },
            PrimaryButtonText = "I Agree",
            CloseButtonText = "Decline",
            XamlRoot = Content.XamlRoot
        };

        var result = await dialog.ShowAsync();
        if (result == ContentDialogResult.Primary)
        {
            _consent.Accept();
            return true;
        }
        return false;
    }

    private async Task ConnectOllamaAsync()
    {
        StatusLabel.Text = "Detecting Ollama…";

        // Use bootstrapper: detect → auto-start → check models
        var result = await _bootstrapper.BootstrapAsync();

        switch (result.Status)
        {
            case BootstrapStatus.Ready:
                StatusDot.Fill = new SolidColorBrush(ColorHelper.FromArgb(255, 40, 167, 69));
                StatusLabel.Text = result.WasAutoStarted
                    ? $"Ollama auto-started — {result.InstalledModels.Count} model(s)"
                    : $"Ollama connected — {result.InstalledModels.Count} model(s)";
                ModelPicker.ItemsSource = result.InstalledModels;
                if (result.InstalledModels.Count > 0)
                {
                    ModelPicker.SelectedIndex = 0;
                    _ollama.Model = result.InstalledModels[0];
                    _ollamaRaw.Model = result.InstalledModels[0];
                }
                break;

            case BootstrapStatus.NoModels:
                StatusDot.Fill = new SolidColorBrush(ColorHelper.FromArgb(255, 255, 193, 7));
                StatusLabel.Text = "Ollama running but no models — pull one first";
                break;

            case BootstrapStatus.NotInstalled:
                StatusDot.Fill = new SolidColorBrush(ColorHelper.FromArgb(255, 220, 53, 69));
                StatusLabel.Text = "Ollama not found — install from ollama.com";
                await new ContentDialog
                {
                    Title = "Ollama Required",
                    Content = "PAiA needs Ollama to run AI models locally.\n\n" +
                              "1. Download from: ollama.com/download\n" +
                              "2. Install and restart PAiA\n" +
                              "3. Pull a model: ollama pull qwen3.5:9b",
                    CloseButtonText = "OK",
                    XamlRoot = Content.XamlRoot
                }.ShowAsync();
                break;

            case BootstrapStatus.FailedToStart:
                StatusDot.Fill = new SolidColorBrush(ColorHelper.FromArgb(255, 220, 53, 69));
                StatusLabel.Text = "Ollama couldn't start — run 'ollama serve' manually";
                break;
        }
    }

    private async Task ShowModelRecommendationsAsync(HardwareProfile hwProfile)
    {
        var content = new StackPanel { Spacing = 12, MaxWidth = 520 };

        content.Children.Add(new TextBlock
        {
            Text = hwProfile.GetSummary(),
            FontSize = 13, FontFamily = new FontFamily("Consolas"),
            TextWrapping = TextWrapping.Wrap
        });

        if (!hwProfile.HasGpu)
        {
            content.Children.Add(new TextBlock
            {
                Text = "⚠ No dedicated GPU detected. PAiA will work but responses will be slower.\nUse small models (3B or less) for usable speed.",
                FontSize = 13, Foreground = new SolidColorBrush(ColorHelper.FromArgb(255, 255, 193, 7)),
                TextWrapping = TextWrapping.Wrap
            });
        }

        var recommended = hwProfile.Recommendations.Where(r => r.Tier <= hwProfile.Tier).ToList();
        var recText = string.Join("\n\n", recommended.Select(r =>
            $"{(r.IsRecommended ? "⭐ " : "")}{r.DisplayName}\n" +
            $"   {r.BestFor}\n" +
            $"   Speed: {r.SpeedEstimate} | RAM: {r.RamRequired}\n" +
            $"   {r.PullCommand}"));

        content.Children.Add(new TextBlock
        {
            Text = "Recommended models for your hardware:\n\n" + recText,
            FontSize = 12, TextWrapping = TextWrapping.Wrap, IsTextSelectionEnabled = true
        });

        content.Children.Add(new TextBlock
        {
            Text = "Open PowerShell and run the pull command, then restart PAiA.",
            FontSize = 12, Foreground = new SolidColorBrush(Colors.Gray)
        });

        await new ContentDialog
        {
            Title = "No AI Models Installed",
            Content = new ScrollViewer { MaxHeight = 450, Content = content },
            CloseButtonText = "OK",
            XamlRoot = Content.XamlRoot
        }.ShowAsync();
    }

    // ═══ SCREEN CAPTURE (fully wired) ══════════════════════════════

    private async void Capture_Click(object sender, RoutedEventArgs e)
    {
        if (_isProcessing) return;
        _isProcessing = true;
        _captureCompletion = new TaskCompletionSource<bool>();
        CaptureBtn.IsEnabled = false;

        try
        {
            var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
            var (rawBitmap, item) = await _capture.CaptureAsync(hwnd);
            if (rawBitmap is null) return; // finally block resets _isProcessing + signals _captureCompletion

            // ✅ Wrap bitmap IMMEDIATELY — no gap where it could leak
            using var safeBitmap = new MemorySafeBitmap(rawBitmap);

            _captureTarget = item;
            _guard.RecordCapture();

            // ✅ Sensitive app warning
            var windowTitle = item?.DisplayName ?? "";
            var warning = SensitiveAppFilter.CheckWindowTitle(windowTitle);
            if (warning is not null)
            {
                var warnDialog = new ContentDialog
                {
                    Title = "Sensitive Application Detected",
                    Content = warning,
                    PrimaryButtonText = "Continue Anyway",
                    CloseButtonText = "Cancel",
                    XamlRoot = Content.XamlRoot
                };
                var warnResult = await warnDialog.ShowAsync();
                if (warnResult != ContentDialogResult.Primary)
                {
                    // safeBitmap auto-disposed by using statement, finally resets state
                    return;
                }
            }

            // ✅ Run full ScreenIntel pipeline
            StatusLabel.Text = "Analyzing screen…";
            var captureStart = System.Diagnostics.Stopwatch.StartNew();

            // Use the target window's handle for UI Automation (not PAiA's own window)
            var targetHwnd = _windowMonitor.GetForegroundWindowHandle();
            if (targetHwnd == IntPtr.Zero) targetHwnd = hwnd; // fallback
            ScreenIntelResult intelResult = await _pipeline.AnalyzeAsync(
                safeBitmap.Bitmap, targetHwnd);

            // safeBitmap auto-disposed when using block exits
            captureStart.Stop();
            _privacyPulse.ShowBitmapLifecycle(captureStart.ElapsedMilliseconds);
            _privacyPulse.ShowRedactionResult(intelResult.TotalRedactionCount);

            // Check if plugin matches
            var matchedPlugin = _plugins.DetectPlugin(intelResult.RawOcrText, windowTitle);

            // Redaction diff view
            var diffSummary = RedactionDiffView.GetSummary(intelResult.RawOcrText);

            // Use pipeline's context (built from all signals)
            _currentScreen = intelResult.Context ?? _context.Detect(intelResult.RedactedText, windowTitle);

            // Override system prompt if plugin matched
            if (matchedPlugin is not null)
            {
                _currentScreen.Summary = $"[{matchedPlugin.Name}] {_currentScreen.Summary}";
                // Plugin quick actions will be added in ShowContextBar
            }

            _chat.SetContext(_currentScreen);
            _securityLab.Monitor.RecordCapture();

            // Update UI
            ShowContextBar(_currentScreen, intelResult.TotalRedactionCount, diffSummary, matchedPlugin);
            EmptyState.Visibility = Visibility.Collapsed;
            ChatScroller.Visibility = Visibility.Visible;
            SendBtn.IsEnabled = true;
            PinBtn.IsEnabled = false;
            InputBox.PlaceholderText = $"Ask about this {_currentScreen.Type.ToString().ToLower()}…";

            // Show signal status in system message
            var signalInfo = intelResult.GetSignalSummary();
            AddChatBubble($"Captured: {_currentScreen.Summary}\n" +
                $"Signals: {signalInfo}" +
                (intelResult.TotalRedactionCount > 0 ? $"\n{diffSummary}" : "") +
                (intelResult.NerRedactionCount > 0 ? $"\nNER: {intelResult.NerRedactionCount} contextual items redacted" : ""),
                ChatRole.System);

            // ✅ Link safety warning — show BEFORE user clicks anything
            if (intelResult.LinkSafety is not null && intelResult.LinkSafety.FlaggedLinks.Count > 0)
            {
                var linkSummary = LinkSafetyService.GetSummaryText(intelResult.LinkSafety);
                AddChatBubble(linkSummary, ChatRole.System);

                // Show details for dangerous links
                foreach (var flagged in intelResult.LinkSafety.FlaggedLinks
                    .Where(f => f.RiskLevel >= RiskLevel.High))
                {
                    var detail = $"🔗 {flagged.Url}\n" +
                        string.Join("\n", flagged.Warnings.Select(w =>
                            $"   {(w.Severity == RiskLevel.Critical ? "🚨" : "⚠️")} {w.Message}"));
                    AddChatBubble(detail, ChatRole.System);
                }
            }

            StatusLabel.Text = "Ready";
            _privacyPulse.Refresh();

            _audit.Log(new AuditEvent(Action: "capture", Target: windowTitle,
                OcrRedacted: intelResult.RedactedText.Length > 500 ? intelResult.RedactedText[..500] + "…" : intelResult.RedactedText));
        }
        catch (Exception ex)
        {
            StatusLabel.Text = $"Capture failed: {ex.Message}";
        }
        finally
        {
            _isProcessing = false;
            CaptureBtn.IsEnabled = true;
            _captureCompletion?.TrySetResult(_currentScreen is not null);
        }
    }

    // ═══ CONTEXT BAR ═══════════════════════════════════════════════

    private void ShowContextBar(ScreenContext ctx, int redactCount, string diffSummary,
        PluginDefinition? plugin = null)
    {
        ContextBar.Visibility = Visibility.Visible;
        ContextTypeLabel.Text = plugin is not null ? plugin.Name : ctx.Type.ToString();
        ContextAppLabel.Text = string.IsNullOrEmpty(ctx.AppName) ? "" : $"— {ctx.AppName}";
        RedactionCountLabel.Text = redactCount > 0 ? $"🔒 {redactCount} redacted" : "";

        // ✅ Show redaction diff summary
        if (redactCount > 0)
        {
            RedactionDiffLabel.Visibility = Visibility.Visible;
            RedactionDiffLabel.Text = diffSummary;
        }
        else
        {
            RedactionDiffLabel.Visibility = Visibility.Collapsed;
        }

        ContextIcon.Glyph = ctx.Type switch
        {
            ContextType.Code => "\uE943", ContextType.Terminal => "\uE756",
            ContextType.Error => "\uEA39", ContextType.Form => "\uE8A5",
            ContextType.Browser => "\uE774", ContextType.Email => "\uE715",
            ContextType.Settings => "\uE713", ContextType.Installer => "\uE896",
            ContextType.FileManager => "\uE8B7", _ => "\uE946"
        };

        QuickActionsPanel.Children.Clear();

        // Use plugin actions if matched, otherwise default context actions
        var actions = plugin is not null
            ? _plugins.GetPluginActions(plugin)
            : ctx.QuickActions;

        foreach (var action in actions)
        {
            var btn = new Button { Padding = new Thickness(10, 6, 10, 6), Tag = action.Prompt };
            var panel = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
            panel.Children.Add(new FontIcon { Glyph = action.Icon, FontSize = 13 });
            panel.Children.Add(new TextBlock { Text = action.Label, FontSize = 12 });
            btn.Content = panel;
            btn.Click += async (s, _) =>
            {
                if (s is Button b && b.Tag is string prompt)
                    await SendMessageAsync(prompt);
            };
            QuickActionsPanel.Children.Add(btn);
        }

        // Add Form Helper button when form context detected
        if (ctx.Type == ContextType.Form)
        {
            var formBtn = new Button { Padding = new Thickness(10, 6, 10, 6) };
            var formPanel = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
            formPanel.Children.Add(new FontIcon { Glyph = "\uE8A5", FontSize = 13 });
            formPanel.Children.Add(new TextBlock { Text = "Form Helper Overlay", FontSize = 12 });
            formBtn.Content = formPanel;
            formBtn.Click += (_, _) =>
            {
                if (_currentScreen is not null)
                {
                    var overlay = new FormHelperOverlay(_formAnalysis, _audit, _currentScreen.RedactedOcr);
                    overlay.Activate();
                }
            };
            QuickActionsPanel.Children.Add(formBtn);
        }

        // ✅ Search Web button (always visible, works even when search is disabled — opens browser)
        var webBtn = new Button { Padding = new Thickness(10, 6, 10, 6) };
        var webPanel = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        webPanel.Children.Add(new FontIcon { Glyph = "\uE774", FontSize = 13 }); // Globe icon
        webPanel.Children.Add(new TextBlock { Text = "Search web", FontSize = 12 });
        webBtn.Content = webPanel;
        webBtn.Click += (_, _) =>
        {
            if (_currentScreen is not null)
            {
                var query = _currentScreen.Type == ContextType.Error
                    ? _currentScreen.RedactedOcr[..Math.Min(100, _currentScreen.RedactedOcr.Length)]
                    : _currentScreen.Summary;
                _webSearch.SearchInBrowser(query);
            }
        };
        QuickActionsPanel.Children.Add(webBtn);
    }

    // ═══ CHAT (with history + clipboard integration) ═══════════════

    private void InputBox_KeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key == Windows.System.VirtualKey.Enter && !_isProcessing && !string.IsNullOrWhiteSpace(InputBox.Text))
        { _ = SendMessageAsync(InputBox.Text.Trim()); e.Handled = true; }
    }

    private async void Send_Click(object sender, RoutedEventArgs e)
    {
        if (!string.IsNullOrWhiteSpace(InputBox.Text))
            await SendMessageAsync(InputBox.Text.Trim());
    }

    private async Task SendMessageAsync(string message)
    {
        if (_isProcessing || _currentScreen is null) return;

        // ✅ Handle slash commands (/capture, /search, /help, etc.)
        if (_assistant.TryProcessCommand(message))
        {
            InputBox.Text = "";
            return;
        }

        _isProcessing = true;
        SendBtn.IsEnabled = false;
        var userText = message;
        InputBox.Text = "";

        AddChatBubble(userText, ChatRole.User);
        var (_, textBlock) = AddStreamingBubble();
        _streamCts = new CancellationTokenSource();

        try
        {
            StatusLabel.Text = "Thinking…";
            _guard.RecordLlmCall();
            var fullResponse = new System.Text.StringBuilder();

            // ✅ Web search enrichment (if enabled)
            if (_webSearch.IsEnabled)
            {
                StatusLabel.Text = "🌐 Searching for latest info…";
                try
                {
                    // Ask LLM to generate a clean search query
                    var searchPrompt = SearchQuerySanitizer.BuildSearchPrompt(
                        userText, _currentScreen.Type.ToString());
                    var searchQuery = await _ollama.ChatAsync(
                        "Generate a web search query. Return ONLY the query, nothing else.",
                        searchPrompt, _streamCts.Token);
                    searchQuery = searchQuery.Trim().Trim('"').Trim('\'');

                    if (searchQuery.Length > 3 && searchQuery.Length < 200)
                    {
                        var results = await _webSearch.SearchAsync(searchQuery, 3, _streamCts.Token);
                        if (results.HasResults)
                        {
                            var searchContext = WebSearchService.BuildSearchContext(results);
                            _chat.InjectSearchContext(searchContext);
                            AddChatBubble($"🌐 Found {results.Results.Count} results for: {results.Query}" +
                                (results.PiiStripped > 0 ? $" ({results.PiiStripped} PII items stripped from query)" : ""),
                                ChatRole.System);
                        }
                    }
                }
                catch { /* Search failed — continue with local knowledge */ }
                StatusLabel.Text = "Thinking…";
            }

            await foreach (var chunk in _chat.SendStreamAsync(userText, _streamCts.Token))
            {
                fullResponse.Append(chunk);
                textBlock.Text = fullResponse.ToString();
                ChatScroller.ChangeView(null, ChatScroller.ScrollableHeight, null);
            }

            _lastResponse = fullResponse.ToString();
            PinBtn.IsEnabled = true;
            StatusLabel.Text = "Ready";
            _privacyPulse.Refresh();

            // ✅ Mirror response summary to compact widget
            var widgetSummary = _lastResponse.Length > 200
                ? _lastResponse[..197] + "…"
                : _lastResponse;
            _widget?.AddMessage(widgetSummary, true);
            _widget?.SetStatus("Ready");

            // ✅ Save to history
            _history.Save(new HistoryEntry
            {
                Question = userText,
                Answer = _lastResponse.Length > 2000 ? _lastResponse[..2000] + "…" : _lastResponse,
                ContextType = _currentScreen.Type.ToString(),
                AppName = _currentScreen.AppName
            });

            // ✅ Auto-queue code blocks to clipboard
            var codeBlocks = _clipboard.QueueCodeBlocks(_lastResponse);
            if (codeBlocks > 0)
                AddChatBubble($"📋 {codeBlocks} code block(s) queued — paste with Ctrl+V in order", ChatRole.System);

            _audit.Log(new AuditEvent(Action: "chat", Target: _currentScreen.Type.ToString(),
                Question: userText, Answer: _lastResponse.Length > 500 ? _lastResponse[..500] + "…" : _lastResponse));
        }
        catch (OperationCanceledException)
        {
            textBlock.Text += "\n[Cancelled]";
            StatusLabel.Text = "Cancelled";
        }
        catch (Exception ex)
        {
            textBlock.Text = $"Error: {ex.Message}";
            StatusLabel.Text = "Error — try again";
        }
        finally
        {
            _isProcessing = false;
            SendBtn.IsEnabled = true;
            _streamCts = null;
        }
    }

    // ═══ CHAT BUBBLES ══════════════════════════════════════════════

    private void AddChatBubble(string text, ChatRole role)
    {
        var isUser = role == ChatRole.User;
        var isSystem = role == ChatRole.System;

        var bubble = new Border
        {
            CornerRadius = new CornerRadius(12),
            Padding = new Thickness(14, 10, 14, 10),
            Margin = new Thickness(isUser ? 60 : 0, 2, isUser ? 0 : 60, 2),
            MaxWidth = 600,
            HorizontalAlignment = isUser ? HorizontalAlignment.Right : HorizontalAlignment.Left,
            Background = isSystem
                ? new SolidColorBrush(ColorHelper.FromArgb(30, 128, 128, 128))
                : isUser ? (Brush)Application.Current.Resources["AccentFillColorDefaultBrush"]
                         : new SolidColorBrush(ColorHelper.FromArgb(255, 40, 40, 40))
        };

        var panel = new StackPanel { Spacing = 4 };
        panel.Children.Add(new TextBlock
        {
            Text = text, TextWrapping = TextWrapping.Wrap, IsTextSelectionEnabled = true,
            FontSize = isSystem ? 12 : 14,
            Foreground = isSystem
                ? new SolidColorBrush(ColorHelper.FromArgb(180, 200, 200, 200))
                : new SolidColorBrush(Colors.White)
        });

        if (!isUser && !isSystem)
        {
            var copyBtn = new Button
            {
                Content = new FontIcon { Glyph = "\uE8C8", FontSize = 11 },
                Padding = new Thickness(4, 2, 4, 2),
                HorizontalAlignment = HorizontalAlignment.Right, Opacity = 0.6
            };
            var capturedText = text;
            copyBtn.Click += (_, _) =>
            {
                CopyToClipboard(capturedText);
                ((FontIcon)copyBtn.Content).Glyph = "\uE73E";
            };
            panel.Children.Add(copyBtn);
        }

        bubble.Child = panel;
        ChatPanel.Children.Add(bubble);
        ChatScroller.ChangeView(null, ChatScroller.ScrollableHeight + 200, null);
    }

    private (Border, TextBlock) AddStreamingBubble()
    {
        var textBlock = new TextBlock
        {
            Text = "", TextWrapping = TextWrapping.Wrap, IsTextSelectionEnabled = true,
            FontSize = 14, Foreground = new SolidColorBrush(Colors.White)
        };
        var copyBtn = new Button
        {
            Content = new FontIcon { Glyph = "\uE8C8", FontSize = 11 },
            Padding = new Thickness(4, 2, 4, 2),
            HorizontalAlignment = HorizontalAlignment.Right, Opacity = 0.6
        };
        copyBtn.Click += (_, _) =>
        {
            CopyToClipboard(textBlock.Text);
            ((FontIcon)copyBtn.Content).Glyph = "\uE73E";
        };

        var panel = new StackPanel { Spacing = 4 };
        panel.Children.Add(textBlock);
        panel.Children.Add(copyBtn);

        var bubble = new Border
        {
            CornerRadius = new CornerRadius(12),
            Padding = new Thickness(14, 10, 14, 10),
            Margin = new Thickness(0, 2, 60, 2), MaxWidth = 600,
            HorizontalAlignment = HorizontalAlignment.Left,
            Background = new SolidColorBrush(ColorHelper.FromArgb(255, 40, 40, 40)),
            Child = panel
        };
        ChatPanel.Children.Add(bubble);
        return (bubble, textBlock);
    }

    // ═══ TOOLBAR ACTIONS (all wired) ═══════════════════════════════

    private void ModelPicker_Changed(object sender, SelectionChangedEventArgs e)
    {
        if (ModelPicker.SelectedItem is string model)
        {
            _ollama.Model = model;       // SecureOllamaClient (propagates to raw)
            _ollamaRaw.Model = model;    // Raw client (used by pipeline internals)
        }
    }

    // ✅ Pin Overlay
    private void Pin_Click(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrEmpty(_lastResponse)) return;
        var label = _currentScreen?.Type.ToString() ?? "General";
        var overlay = new PinOverlay(_lastResponse, label);
        overlay.Activate();
    }

    // ✅ History dialog
    private async void History_Click(object sender, RoutedEventArgs e)
    {
        var (total, bookmarked, sizeBytes) = _history.GetStats();
        var recent = _history.GetRecent(10);
        var content = new StackPanel { Spacing = 8, MaxWidth = 500 };

        content.Children.Add(new TextBlock
        {
            Text = $"{total} responses saved ({sizeBytes / 1024.0:F1} KB) — {bookmarked} bookmarked",
            FontSize = 13, Foreground = new SolidColorBrush(Colors.Gray)
        });

        foreach (var entry in recent)
        {
            var entryText = $"[{entry.ContextType}] Q: {Truncate(entry.Question ?? "", 60)}\n" +
                            $"A: {Truncate(entry.Answer ?? "", 80)}";
            content.Children.Add(new TextBlock
            {
                Text = entryText, FontSize = 12, TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 4, 0, 4)
            });
        }

        if (total == 0) content.Children.Add(new TextBlock { Text = "No history yet. Start chatting!", Foreground = new SolidColorBrush(Colors.Gray) });

        var dialog = new ContentDialog
        {
            Title = "Response History",
            Content = new ScrollViewer { MaxHeight = 400, Content = content },
            PrimaryButtonText = "Clear All History",
            CloseButtonText = "Close",
            XamlRoot = Content.XamlRoot
        };
        var result = await dialog.ShowAsync();
        if (result == ContentDialogResult.Primary)
            _history.DeleteAll();
    }

    // ✅ Security Lab dashboard
    private async void SecurityLab_Click(object sender, RoutedEventArgs e)
    {
        var dashboard = _securityLab.GetDashboard();
        var summaryText = _securityLab.GetSummaryText();

        var content = new StackPanel { Spacing = 8, MaxWidth = 500 };
        content.Children.Add(new TextBlock
        {
            Text = summaryText, FontSize = 12, FontFamily = new FontFamily("Consolas"),
            TextWrapping = TextWrapping.Wrap, IsTextSelectionEnabled = true
        });

        var dialog = new ContentDialog
        {
            Title = "PAiA SecurityLab",
            Content = new ScrollViewer { MaxHeight = 500, Content = content },
            PrimaryButtonText = "Run Full Security Audit",
            SecondaryButtonText = "View Privacy Report",
            CloseButtonText = "Close",
            XamlRoot = Content.XamlRoot
        };

        var result = await dialog.ShowAsync();
        if (result == ContentDialogResult.Primary)
        {
            StatusLabel.Text = "Running security audit…";
            var auditResult = await _securityLab.RunFullAuditAsync();
            var report = _securityLab.GetSummaryText();

            await new ContentDialog
            {
                Title = $"Security Audit Complete — Score: {auditResult.OverallHealth}/100",
                Content = new ScrollViewer
                {
                    MaxHeight = 500,
                    Content = new TextBlock
                    {
                        Text = report, FontSize = 12, FontFamily = new FontFamily("Consolas"),
                        TextWrapping = TextWrapping.Wrap, IsTextSelectionEnabled = true
                    }
                },
                CloseButtonText = "OK",
                XamlRoot = Content.XamlRoot
            }.ShowAsync();

            StatusLabel.Text = "Ready";
        }
        else if (result == ContentDialogResult.Secondary)
        {
            var privacyReport = _guard.GenerateReport();
            await new ContentDialog
            {
                Title = $"Privacy Report — Score: {privacyReport.PrivacyScore}/100",
                Content = new ScrollViewer
                {
                    MaxHeight = 500,
                    Content = new TextBlock
                    {
                        Text = privacyReport.ToSummary(), FontSize = 12,
                        FontFamily = new FontFamily("Consolas"),
                        TextWrapping = TextWrapping.Wrap, IsTextSelectionEnabled = true
                    }
                },
                CloseButtonText = "OK",
                XamlRoot = Content.XamlRoot
            }.ShowAsync();
        }
    }

    // ✅ Audit log
    private async void AuditLog_Click(object sender, RoutedEventArgs e)
    {
        var (count, bytes) = _audit.GetStats();
        var dialog = new ContentDialog
        {
            Title = "Audit Log",
            Content = $"Entries: {count}\nSize: {bytes / 1024.0:F1} KB\n\nAll data is redacted. Stored locally only.\nPath: %LOCALAPPDATA%\\PAiA\\AuditLogs",
            PrimaryButtonText = "Delete All Logs",
            CloseButtonText = "Close",
            XamlRoot = Content.XamlRoot
        };
        if (await dialog.ShowAsync() == ContentDialogResult.Primary)
        { _audit.DeleteAll(); UpdateLogCount(); }
    }

    // ✅ Settings (with consent revoke, data wipe, custom redaction, Ollama config)
    // ═══ VOICE ASSISTANT ═══════════════════════════════════════════

    /// <summary>
    /// Handles actions dispatched by the AssistantOrchestrator.
    /// Maps voice/typed commands to existing MainWindow methods.
    /// </summary>
    private async void HandleAssistantAction(AssistantAction action)
    {
        switch (action.Command?.Type)
        {
            case CommandType.CaptureScreen:
                Capture_Click(this, new RoutedEventArgs());
                break;

            case CommandType.AskQuestion:
                if (action.Command.Argument is not null && _currentScreen is not null)
                    await SendMessageAsync(action.Command.Argument);
                break;

            case CommandType.WebSearch:
                if (action.Command.Argument is not null)
                {
                    _webSearch.SearchInBrowser(action.Command.Argument);
                }
                break;

            case CommandType.ReadResponse:
                if (!string.IsNullOrEmpty(_lastResponse))
                    await SpeakTextAsync(_lastResponse);
                break;

            case CommandType.OpenBrowser:
                var url = "https://duckduckgo.com";
                _webSearch.OpenInBrowser(url);
                break;

            case CommandType.CopyResponse:
                if (!string.IsNullOrEmpty(_lastResponse))
                {
                    var dp = new Windows.ApplicationModel.DataTransfer.DataPackage();
                    dp.SetText(_lastResponse);
                    Windows.ApplicationModel.DataTransfer.Clipboard.SetContent(dp);
                    StatusLabel.Text = "📋 Copied to clipboard";
                }
                break;

            case CommandType.PasteNext:
                var next = _clipboard.PasteNext();
                if (next is not null)
                {
                    var dp2 = new Windows.ApplicationModel.DataTransfer.DataPackage();
                    dp2.SetText(next.Text);
                    Windows.ApplicationModel.DataTransfer.Clipboard.SetContent(dp2);
                    StatusLabel.Text = $"📋 Pasted block {_clipboard.Count + 1}";
                }
                break;

            case CommandType.NewChat:
                NewChat_Click(this, new RoutedEventArgs());
                break;

            case CommandType.Stop:
                _streamCts?.Cancel();
                break;

            case CommandType.PrivacyStatus:
                var report = _guard.GenerateReport();
                var status = report.ToSummary();
                AddChatBubble(status, ChatRole.System);
                await SpeakTextAsync($"Privacy score is {report.PrivacyScore} out of 100. " +
                    $"{report.TotalCaptures} captures this session. " +
                    $"All data is local. {_webSearch.GetPrivacyStatus()}");
                break;

            case CommandType.SecurityCheck:
                SecurityLab_Click(this, new RoutedEventArgs());
                break;

            case CommandType.OpenSettings:
                Settings_Click(this, new RoutedEventArgs());
                break;
        }

        action.Completed = true;
    }

    /// <summary>
    /// Speaks text using Windows TTS. Plays audio through MediaPlayer.
    /// </summary>
    private Windows.Media.Playback.MediaPlayer? _ttsPlayer;
    private async Task SpeakTextAsync(string text)
    {
        try
        {
            var stream = await _voice.SpeakAsync(text);
            if (stream is not null)
            {
                _ttsPlayer?.Dispose();
                _ttsPlayer = new Windows.Media.Playback.MediaPlayer();
                _ttsPlayer.Source = Windows.Media.Core.MediaSource.CreateFromStream(stream, stream.ContentType);
                _ttsPlayer.Play();
            }
        }
        catch { /* TTS failed — silent fallback */ }
    }

    private async void Settings_Click(object sender, RoutedEventArgs e)
    {
        var content = new StackPanel { Spacing = 16, MaxWidth = 500 };

        // Privacy summary
        content.Children.Add(new TextBlock
        {
            Text = "Privacy Guarantees\n" +
                   "✅ All processing runs locally via Ollama\n" +
                   "✅ PII auto-redacted before LLM processing\n" +
                   "✅ Screen capture requires your explicit consent\n" +
                   "✅ No background monitoring or keylogging\n" +
                   "✅ Zero cloud transmission\n" +
                   $"✅ Consent given: {_consent.ConsentDate:yyyy-MM-dd}",
            FontSize = 13, TextWrapping = TextWrapping.Wrap
        });

        // Custom redaction rules count
        content.Children.Add(new TextBlock
        {
            Text = $"Custom redaction rules: {_customRedact.Rules.Count} active",
            FontSize = 13, Foreground = new SolidColorBrush(Colors.Gray)
        });

        // ── Web Search Settings ──
        content.Children.Add(new TextBlock
        {
            Text = "Online Search",
            FontSize = 15, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            Margin = new Thickness(0, 8, 0, 0)
        });

        var searchToggle = new ToggleSwitch
        {
            Header = "Allow web search for recent information",
            IsOn = _webSearch.IsEnabled,
            OnContent = "ON — sanitized queries sent to DuckDuckGo",
            OffContent = "OFF — fully offline (default)"
        };
        searchToggle.Toggled += (_, _) => _webSearch.IsEnabled = searchToggle.IsOn;
        content.Children.Add(searchToggle);

        content.Children.Add(new TextBlock
        {
            Text = "When enabled, PAiA can search the web for error fixes, documentation, and recent info.\n" +
                   "Only sanitized search queries go online — screen content and PII never leave your machine.\n" +
                   $"Searches this session: {_webSearch.GetStats().TotalSearches} | PII items stripped: {_webSearch.GetStats().TotalPiiItemsStripped}",
            FontSize = 12, Foreground = new SolidColorBrush(Colors.Gray),
            TextWrapping = TextWrapping.Wrap
        });

        // Browser picker
        var browserPicker = new ComboBox
        {
            Header = "Preferred browser for opening links",
            Width = 250,
            ItemsSource = new[] { "System Default", "Chrome", "Edge", "Firefox", "Brave" },
            SelectedIndex = (int)_webSearch.PreferredBrowser
        };
        browserPicker.SelectionChanged += (_, _) =>
            _webSearch.PreferredBrowser = (BrowserPreference)browserPicker.SelectedIndex;
        content.Children.Add(browserPicker);

        // ── Voice Assistant Settings ──
        content.Children.Add(new TextBlock
        {
            Text = "Voice Assistant",
            FontSize = 15, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            Margin = new Thickness(0, 8, 0, 0)
        });

        var voiceToggle = new ToggleSwitch
        {
            Header = "Enable voice commands",
            IsOn = _voice.IsEnabled,
            OnContent = "ON — say 'Hey PAiA' or hold Ctrl+Shift+V",
            OffContent = "OFF (default)"
        };
        voiceToggle.Toggled += async (_, _) =>
        {
            _voice.IsEnabled = voiceToggle.IsOn;
            if (voiceToggle.IsOn) await _voice.InitializeAsync();
        };
        content.Children.Add(voiceToggle);

        var voiceModePicker = new ComboBox
        {
            Header = "Voice mode",
            Width = 250,
            ItemsSource = new[] { "Push-to-Talk (Ctrl+Shift+V)", "Wake Word ('Hey PAiA')" },
            SelectedIndex = (int)_voice.Mode
        };
        voiceModePicker.SelectionChanged += (_, _) =>
            _voice.Mode = (VoiceMode)voiceModePicker.SelectedIndex;
        content.Children.Add(voiceModePicker);

        content.Children.Add(new TextBlock
        {
            Text = "Voice uses Windows Speech APIs — local, offline, no audio sent to cloud.\n" +
                   "Push-to-Talk is more reliable. Wake Word listens continuously on-device.\n" +
                   "Type /help in the input box for command list.",
            FontSize = 12, Foreground = new SolidColorBrush(Colors.Gray),
            TextWrapping = TextWrapping.Wrap
        });

        var dialog = new ContentDialog
        {
            Title = "PAiA Settings",
            Content = new ScrollViewer { MaxHeight = 400, Content = content },
            PrimaryButtonText = "Revoke Consent & Delete All Data",
            SecondaryButtonText = "Manage Redaction Rules",
            CloseButtonText = "Close",
            XamlRoot = Content.XamlRoot
        };

        var result = await dialog.ShowAsync();
        if (result == ContentDialogResult.Primary)
        {
            var confirm = new ContentDialog
            {
                Title = "Are you sure?",
                Content = "This will delete ALL PAiA data and revoke consent. The app will close.",
                PrimaryButtonText = "Yes, Delete Everything",
                CloseButtonText = "Cancel",
                XamlRoot = Content.XamlRoot
            };
            if (await confirm.ShowAsync() == ContentDialogResult.Primary)
            {
                _consent.Revoke();
                _wiper.WipeAll();
                Close();
            }
        }
        else if (result == ContentDialogResult.Secondary)
        {
            await ShowRedactionRulesEditorAsync();
        }
    }

    // ✅ Redaction rules editor
    private async Task ShowRedactionRulesEditorAsync()
    {
        var content = new StackPanel { Spacing = 8, MaxWidth = 500 };

        if (_customRedact.Rules.Count == 0)
        {
            content.Children.Add(new TextBlock
            {
                Text = "No custom rules yet. Templates available:\n" +
                       string.Join("\n", CustomRedactionRules.GetTemplates().Select(t => $"  • {t.name}: {t.pattern}")),
                FontSize = 12, TextWrapping = TextWrapping.Wrap
            });
        }
        else
        {
            foreach (var rule in _customRedact.Rules)
            {
                content.Children.Add(new TextBlock
                {
                    Text = $"{(rule.Enabled ? "✅" : "❌")} {rule.Name}: {rule.Pattern} → {rule.Replacement}",
                    FontSize = 12, TextWrapping = TextWrapping.Wrap
                });
            }
        }

        var dialog = new ContentDialog
        {
            Title = "Custom Redaction Rules",
            Content = new ScrollViewer { MaxHeight = 400, Content = content },
            PrimaryButtonText = "Add All Templates",
            CloseButtonText = "Close",
            XamlRoot = Content.XamlRoot
        };

        if (await dialog.ShowAsync() == ContentDialogResult.Primary)
        {
            foreach (var (name, pattern, isRegex) in CustomRedactionRules.GetTemplates())
            {
                if (!_customRedact.Rules.Any(r => r.Name == name))
                    _customRedact.Add(name, pattern, isRegex: isRegex);
            }
        }
    }

    // ✅ New chat
    private void NewChat_Click(object sender, RoutedEventArgs e)
    {
        _chat.Reset();
        _currentScreen = null;
        _lastResponse = "";
        ChatPanel.Children.Clear();
        ContextBar.Visibility = Visibility.Collapsed;
        EmptyState.Visibility = Visibility.Visible;
        SendBtn.IsEnabled = false;
        PinBtn.IsEnabled = false;
        InputBox.PlaceholderText = "Ask PAiA anything about your screen…";
        StatusLabel.Text = "Ready — capture a screen to start";
        _clipboard.Clear();
    }

    // ═══ Helpers ═══════════════════════════════════════════════════

    private void UpdateLogCount()
    {
        var (count, _) = _audit.GetStats();
        LogCountLabel.Text = count > 0 ? $"Logs ({count})" : "Logs";
    }

    private static void CopyToClipboard(string text)
    {
        var pkg = new DataPackage();
        pkg.SetText(text);
        Clipboard.SetContent(pkg);
        Clipboard.Flush();
    }

    private static string Truncate(string s, int max) =>
        s.Length > max ? s[..max] + "…" : s;
}
