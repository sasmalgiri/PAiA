using System.Runtime.InteropServices;
using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Windows.ApplicationModel.DataTransfer;

namespace PAiA.WinUI;

/// <summary>
/// Compact, always-on-top floating panel that shows PAiA's response
/// while you work in another application.
/// 
/// Problem: You ask PAiA how to fix something, get the answer, but then
/// you have to keep switching between PAiA and the app to follow the steps.
/// 
/// Solution: Pin the response. A small overlay stays on top with the answer
/// visible. Copy buttons for each step. Dismiss when done.
/// </summary>
public sealed partial class PinOverlay : Window
{
    private const int GWL_EXSTYLE = -20;
    private const int WS_EX_TOPMOST = 0x00000008;

    [DllImport("user32.dll")]
    private static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll")]
    private static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter,
        int x, int y, int cx, int cy, uint uFlags);

    private static readonly IntPtr HWND_TOPMOST = new(-1);

    public PinOverlay(string responseText, string contextLabel)
    {
        // Build UI in code since this is a simple overlay
        var root = new Grid
        {
            Background = (Brush)Application.Current.Resources["ApplicationPageBackgroundThemeBrush"],
            Padding = new Thickness(12),
            RowDefinitions =
            {
                new RowDefinition { Height = GridLength.Auto },
                new RowDefinition { Height = new GridLength(1, GridUnitType.Star) },
                new RowDefinition { Height = GridLength.Auto }
            }
        };

        // Header
        var header = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        header.Children.Add(new FontIcon
        {
            Glyph = "\uE718",
            FontSize = 14,
            Foreground = new SolidColorBrush(ColorHelper.FromArgb(255, 100, 149, 237))
        });
        header.Children.Add(new TextBlock
        {
            Text = $"Pinned — {contextLabel}",
            FontSize = 12,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            Foreground = new SolidColorBrush(ColorHelper.FromArgb(180, 200, 200, 200))
        });
        Grid.SetRow(header, 0);
        root.Children.Add(header);

        // Response text (scrollable)
        var scroller = new ScrollViewer
        {
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            Margin = new Thickness(0, 8, 0, 8)
        };
        var responseBlock = new TextBlock
        {
            Text = responseText,
            TextWrapping = TextWrapping.Wrap,
            IsTextSelectionEnabled = true,
            FontSize = 13,
            LineHeight = 20
        };
        scroller.Content = responseBlock;
        Grid.SetRow(scroller, 1);
        root.Children.Add(scroller);

        // Footer buttons
        var footer = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Right
        };

        var copyBtn = new Button
        {
            Content = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 6,
                Children =
                {
                    new FontIcon { Glyph = "\uE8C8", FontSize = 12 },
                    new TextBlock { Text = "Copy", FontSize = 12 }
                }
            },
            Padding = new Thickness(10, 4, 10, 4)
        };
        copyBtn.Click += (_, _) =>
        {
            var pkg = new DataPackage();
            pkg.SetText(responseText);
            Windows.ApplicationModel.DataTransfer.Clipboard.SetContent(pkg);
            Windows.ApplicationModel.DataTransfer.Clipboard.Flush();
            ((FontIcon)((StackPanel)copyBtn.Content).Children[0]).Glyph = "\uE73E";
        };

        var closeBtn = new Button
        {
            Content = new TextBlock { Text = "Unpin", FontSize = 12 },
            Padding = new Thickness(10, 4, 10, 4)
        };
        closeBtn.Click += (_, _) => Close();

        footer.Children.Add(copyBtn);
        footer.Children.Add(closeBtn);
        Grid.SetRow(footer, 2);
        root.Children.Add(footer);

        Content = root;
        Title = "PAiA — Pinned";

        // Size and position
        if (AppWindow is not null)
        {
            AppWindow.Resize(new Windows.Graphics.SizeInt32(360, 400));
        }

        Activated += (_, _) => MakeTopmost();
    }

    /// <summary>
    /// Sets the window as always-on-top using Win32 APIs.
    /// </summary>
    private void MakeTopmost()
    {
        var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);

        var style = GetWindowLong(hwnd, GWL_EXSTYLE);
        SetWindowLong(hwnd, GWL_EXSTYLE, style | WS_EX_TOPMOST);
        SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0,
            0x0001 | 0x0002 | 0x0040); // SWP_NOSIZE | SWP_NOMOVE | SWP_SHOWWINDOW
    }
}
