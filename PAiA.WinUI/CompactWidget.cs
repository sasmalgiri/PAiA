using Microsoft.UI;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using System.Runtime.InteropServices;
using Windows.Graphics;

namespace PAiA.WinUI;

/// <summary>
/// PAiA's compact floating widget — the primary interaction point.
/// 
/// FORM FACTORS (user switches between):
/// 
/// 1. BUBBLE (default) — 48x48 circle at screen edge
///    Shows: green privacy dot + context icon
///    Click: expands to mini panel
///    
/// 2. MINI PANEL (expanded) — 320x400 slim panel
///    Shows: context bar, quick actions, compact chat, voice button
///    Docks: right edge of screen, always on top
///    
/// 3. FULL WINDOW — MainWindow (existing)
///    Opens: via "Expand" button in mini panel, or for settings/security
///
/// WHY THIS MATTERS:
/// Users don't want to leave their app to use PAiA.
/// The floating widget lets them get AI help without switching windows.
/// Quick actions update based on which app is in focus RIGHT NOW.
/// </summary>
public sealed class CompactWidget : Window
{
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    private static readonly IntPtr HWND_TOPMOST = new(-1);
    private const uint SWP_NOMOVE = 0x0002;
    private const uint SWP_NOSIZE = 0x0001;
    private const uint SWP_SHOWWINDOW = 0x0040;

    private bool _isExpanded;
    private readonly StackPanel _quickActionsPanel;
    private readonly TextBlock _statusText;
    private readonly TextBlock _contextLabel;
    private readonly Border _privacyDot;
    private readonly Border _voiceIndicator;
    private readonly StackPanel _chatArea;
    private readonly TextBox _inputBox;
    private readonly ScrollViewer _chatScroller;
    private readonly StackPanel _chatMessages;

    /// <summary>Fires when user clicks a quick action.</summary>
    public event Action<string>? QuickActionClicked;

    /// <summary>Fires when user sends a message from mini chat.</summary>
    public event Action<string>? MessageSent;

    /// <summary>Fires when user clicks Capture.</summary>
    public event Action? CaptureRequested;

    /// <summary>Fires when user wants the full window.</summary>
    public event Action? ExpandRequested;

    /// <summary>Fires when voice button is pressed.</summary>
    public event Action? VoiceRequested;

    public CompactWidget()
    {
        // Frameless compact window
        Title = "PAiA";

        var presenter = AppWindow.Presenter as OverlappedPresenter;
        if (presenter is not null)
        {
            presenter.IsResizable = false;
            presenter.IsMaximizable = false;
            presenter.IsMinimizable = false;
            presenter.SetBorderAndTitleBar(false, false);
        }

        // Start as bubble size
        AppWindow.Resize(new SizeInt32(320, 56));

        // Root container
        var root = new Grid
        {
            Background = new SolidColorBrush(ColorHelper.FromArgb(240, 20, 20, 24)),
            CornerRadius = new CornerRadius(16),
            Padding = new Thickness(0)
        };

        // ── COLLAPSED VIEW (bubble bar) ──
        var bubbleBar = new Grid
        {
            Height = 48,
            Padding = new Thickness(12, 0, 8, 0)
        };
        bubbleBar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // Privacy dot
        bubbleBar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) }); // Context
        bubbleBar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // Capture btn
        bubbleBar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // Voice btn
        bubbleBar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // Expand

        // Privacy dot
        _privacyDot = new Border
        {
            Width = 10, Height = 10, CornerRadius = new CornerRadius(5),
            Background = new SolidColorBrush(ColorHelper.FromArgb(255, 40, 167, 69)),
            Margin = new Thickness(0, 0, 10, 0),
            VerticalAlignment = VerticalAlignment.Center
        };
        Grid.SetColumn(_privacyDot, 0);
        bubbleBar.Children.Add(_privacyDot);

        // Context label
        _contextLabel = new TextBlock
        {
            Text = "PAiA Ready",
            FontSize = 13,
            Foreground = new SolidColorBrush(ColorHelper.FromArgb(255, 200, 200, 195)),
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis
        };
        Grid.SetColumn(_contextLabel, 1);
        bubbleBar.Children.Add(_contextLabel);

        // Capture button
        var captureBtn = new Button
        {
            Content = new FontIcon { Glyph = "\uE722", FontSize = 14 },
            Padding = new Thickness(8, 4, 8, 4),
            Background = new SolidColorBrush(Colors.Transparent),
            BorderBrush = new SolidColorBrush(Colors.Transparent),
            Margin = new Thickness(4, 0, 0, 0)
        };
        captureBtn.Click += (_, _) => CaptureRequested?.Invoke();
        ToolTipService.SetToolTip(captureBtn, "Capture screen (Ctrl+Shift+P)");
        Grid.SetColumn(captureBtn, 2);
        bubbleBar.Children.Add(captureBtn);

        // Voice button
        _voiceIndicator = new Border
        {
            Width = 28, Height = 28, CornerRadius = new CornerRadius(14),
            Background = new SolidColorBrush(Colors.Transparent),
            BorderBrush = new SolidColorBrush(ColorHelper.FromArgb(80, 255, 255, 255)),
            BorderThickness = new Thickness(1),
            Margin = new Thickness(4, 0, 0, 0),
            Child = new FontIcon { Glyph = "\uE720", FontSize = 12,
                Foreground = new SolidColorBrush(ColorHelper.FromArgb(200, 255, 255, 255)) }
        };
        _voiceIndicator.Tapped += (_, _) => VoiceRequested?.Invoke();
        ToolTipService.SetToolTip(_voiceIndicator, "Voice command (Ctrl+Shift+V)");
        Grid.SetColumn(_voiceIndicator, 3);
        bubbleBar.Children.Add(_voiceIndicator);

        // Expand/collapse toggle
        var expandBtn = new Button
        {
            Content = new FontIcon { Glyph = "\uE70D", FontSize = 12 },
            Padding = new Thickness(6, 4, 6, 4),
            Background = new SolidColorBrush(Colors.Transparent),
            BorderBrush = new SolidColorBrush(Colors.Transparent),
            Margin = new Thickness(4, 0, 0, 0)
        };
        expandBtn.Click += (_, _) => ToggleExpand();
        ToolTipService.SetToolTip(expandBtn, "Expand panel");
        Grid.SetColumn(expandBtn, 4);
        bubbleBar.Children.Add(expandBtn);

        root.Children.Add(bubbleBar);

        // ── EXPANDED VIEW (mini panel) ──
        _chatArea = new StackPanel
        {
            Visibility = Visibility.Collapsed,
            Margin = new Thickness(0, 52, 0, 0),
            Spacing = 0
        };

        // Status text
        _statusText = new TextBlock
        {
            Text = "",
            FontSize = 11,
            Foreground = new SolidColorBrush(ColorHelper.FromArgb(150, 255, 255, 255)),
            Margin = new Thickness(14, 0, 14, 6),
            TextTrimming = TextTrimming.CharacterEllipsis
        };
        _chatArea.Children.Add(_statusText);

        // Quick actions (horizontal scroll)
        _quickActionsPanel = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
            Margin = new Thickness(12, 0, 12, 8)
        };
        var quickScroller = new ScrollViewer
        {
            Content = _quickActionsPanel,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Hidden,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
            HorizontalScrollMode = ScrollMode.Auto,
            Height = 32
        };
        _chatArea.Children.Add(quickScroller);

        // Chat messages
        _chatMessages = new StackPanel { Spacing = 6 };
        _chatScroller = new ScrollViewer
        {
            Content = _chatMessages,
            MaxHeight = 220,
            Margin = new Thickness(12, 0, 12, 8),
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto
        };
        _chatArea.Children.Add(_chatScroller);

        // Input row
        var inputRow = new Grid
        {
            Margin = new Thickness(12, 0, 12, 10)
        };
        inputRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        inputRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        _inputBox = new TextBox
        {
            PlaceholderText = "Ask anything…",
            FontSize = 12,
            Padding = new Thickness(8, 6, 8, 6)
        };
        _inputBox.KeyDown += (_, e) =>
        {
            if (e.Key == Windows.System.VirtualKey.Enter && !string.IsNullOrWhiteSpace(_inputBox.Text))
            {
                MessageSent?.Invoke(_inputBox.Text.Trim());
                _inputBox.Text = "";
                e.Handled = true;
            }
        };
        Grid.SetColumn(_inputBox, 0);
        inputRow.Children.Add(_inputBox);

        var sendBtn = new Button
        {
            Content = new FontIcon { Glyph = "\uE724", FontSize = 13 },
            Padding = new Thickness(8, 5, 8, 5),
            Margin = new Thickness(6, 0, 0, 0)
        };
        sendBtn.Click += (_, _) =>
        {
            if (!string.IsNullOrWhiteSpace(_inputBox.Text))
            {
                MessageSent?.Invoke(_inputBox.Text.Trim());
                _inputBox.Text = "";
            }
        };
        Grid.SetColumn(sendBtn, 1);
        inputRow.Children.Add(sendBtn);

        _chatArea.Children.Add(inputRow);

        // Full window button
        var fullBtn = new HyperlinkButton
        {
            Content = "Open full window",
            FontSize = 11,
            Margin = new Thickness(12, 0, 12, 8),
            Foreground = new SolidColorBrush(ColorHelper.FromArgb(200, 34, 197, 94))
        };
        fullBtn.Click += (_, _) => ExpandRequested?.Invoke();
        _chatArea.Children.Add(fullBtn);

        root.Children.Add(_chatArea);
        Content = root;

        // Position at bottom-right of screen
        Activated += OnActivated;
    }

    private void OnActivated(object sender, WindowActivatedEventArgs e)
    {
        MakeTopmost();
        PositionBottomRight();
    }

    // ═══ PUBLIC API ════════════════════════════════════════════════

    /// <summary>
    /// Updates the context label and quick actions based on the active app.
    /// Called by ProactiveContextEngine when the foreground app changes.
    /// </summary>
    public void UpdateContext(string contextLabel, List<(string label, string prompt, string icon)> actions)
    {
        _contextLabel.Text = contextLabel;

        _quickActionsPanel.Children.Clear();
        foreach (var (label, prompt, icon) in actions)
        {
            var btn = new Button
            {
                Padding = new Thickness(8, 3, 8, 3),
                Background = new SolidColorBrush(ColorHelper.FromArgb(30, 255, 255, 255)),
                BorderBrush = new SolidColorBrush(ColorHelper.FromArgb(40, 255, 255, 255)),
                CornerRadius = new CornerRadius(12)
            };
            var panel = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
            panel.Children.Add(new FontIcon
            {
                Glyph = icon, FontSize = 11,
                Foreground = new SolidColorBrush(ColorHelper.FromArgb(200, 34, 197, 94))
            });
            panel.Children.Add(new TextBlock
            {
                Text = label, FontSize = 11,
                Foreground = new SolidColorBrush(ColorHelper.FromArgb(220, 255, 255, 255))
            });
            btn.Content = panel;
            btn.Click += (_, _) => QuickActionClicked?.Invoke(prompt);
            _quickActionsPanel.Children.Add(btn);
        }
    }

    /// <summary>Updates privacy status indicator.</summary>
    public void SetPrivacyStatus(bool isSecure, bool isSearchEnabled)
    {
        _privacyDot.Background = new SolidColorBrush(
            isSecure
                ? (isSearchEnabled
                    ? ColorHelper.FromArgb(255, 234, 179, 8)   // amber = search on
                    : ColorHelper.FromArgb(255, 40, 167, 69))  // green = fully local
                : ColorHelper.FromArgb(255, 220, 53, 69));     // red = issue
    }

    /// <summary>Shows voice listening animation.</summary>
    public void SetVoiceListening(bool isListening)
    {
        _voiceIndicator.BorderBrush = new SolidColorBrush(
            isListening
                ? ColorHelper.FromArgb(255, 34, 197, 94)
                : ColorHelper.FromArgb(80, 255, 255, 255));
        _voiceIndicator.BorderThickness = new Thickness(isListening ? 2 : 1);
    }

    /// <summary>Sets the status text in expanded view.</summary>
    public void SetStatus(string text) => _statusText.Text = text;

    /// <summary>Adds a message to the compact chat.</summary>
    public void AddMessage(string text, bool isSystem = false)
    {
        var msg = new TextBlock
        {
            Text = text,
            FontSize = 12,
            TextWrapping = TextWrapping.Wrap,
            Foreground = new SolidColorBrush(
                isSystem
                    ? ColorHelper.FromArgb(160, 255, 255, 255)
                    : ColorHelper.FromArgb(240, 255, 255, 255)),
            Padding = new Thickness(8, 4, 8, 4),
            MaxWidth = 280
        };

        if (!isSystem)
        {
            var bubble = new Border
            {
                Background = new SolidColorBrush(ColorHelper.FromArgb(30, 34, 197, 94)),
                CornerRadius = new CornerRadius(8),
                Child = msg,
                HorizontalAlignment = HorizontalAlignment.Right,
                Margin = new Thickness(0, 2, 0, 2)
            };
            _chatMessages.Children.Add(bubble);
        }
        else
        {
            _chatMessages.Children.Add(msg);
        }

        // Keep last 20 messages
        while (_chatMessages.Children.Count > 20)
            _chatMessages.Children.RemoveAt(0);

        _chatScroller.ChangeView(null, _chatScroller.ScrollableHeight, null);
    }

    /// <summary>Clears the compact chat.</summary>
    public void ClearChat() => _chatMessages.Children.Clear();

    // ═══ INTERNAL ══════════════════════════════════════════════════

    private void ToggleExpand()
    {
        _isExpanded = !_isExpanded;
        _chatArea.Visibility = _isExpanded ? Visibility.Visible : Visibility.Collapsed;
        AppWindow.Resize(new SizeInt32(320, _isExpanded ? 420 : 56));
    }

    private void MakeTopmost()
    {
        var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
        SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
    }

    private void PositionBottomRight()
    {
        var area = DisplayArea.GetFromWindowId(AppWindow.Id, DisplayAreaFallback.Primary);
        if (area is not null)
        {
            var workArea = area.WorkArea;
            AppWindow.Move(new PointInt32(
                workArea.X + workArea.Width - 340,
                workArea.Y + workArea.Height - ((_isExpanded ? 420 : 56) + 20)));
        }
    }
}
