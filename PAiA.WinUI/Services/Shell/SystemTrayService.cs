using System.Runtime.InteropServices;
using Microsoft.UI.Xaml;

namespace PAiA.WinUI.Services.Shell;

/// <summary>
/// Manages PAiA's system tray icon and behaviour.
/// 
/// Features:
/// - Minimize to tray (instead of closing)
/// - Tray icon with context menu (Capture, Settings, Quit)
/// - Double-click tray icon to restore
/// - Tooltip showing status
/// - Close button minimizes to tray; right-click menu has real "Quit"
/// 
/// Uses H.NotifyIcon.WinUI for modern WinUI 3 tray integration.
/// </summary>
public sealed class SystemTrayService : IDisposable
{
    private readonly Window _window;
    private bool _disposed;
    private bool _isExiting;

    // Win32 for window state
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hWnd);
    private const int SW_HIDE = 0;
    private const int SW_SHOW = 5;
    private const int SW_RESTORE = 9;

    public bool MinimizeToTray { get; set; } = true;
    public event Action? CaptureRequested;
    public event Action? SettingsRequested;
    public event Action? QuitRequested;

    public SystemTrayService(Window window)
    {
        _window = window;
    }

    /// <summary>
    /// Initializes the system tray icon.
    /// Note: H.NotifyIcon.WinUI handles the actual tray icon creation.
    /// This service manages the window hide/show behaviour.
    /// </summary>
    public void Initialize()
    {
        // Override window close to minimize to tray instead
        _window.Closed += (_, args) =>
        {
            if (MinimizeToTray && !_isExiting)
            {
                args.Handled = true; // Prevent actual close
                HideToTray();
            }
        };
    }

    /// <summary>
    /// Hides the window to system tray.
    /// </summary>
    public void HideToTray()
    {
        var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(_window);
        ShowWindow(hwnd, SW_HIDE);
    }

    /// <summary>
    /// Restores the window from system tray.
    /// </summary>
    public void RestoreFromTray()
    {
        var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(_window);
        ShowWindow(hwnd, SW_RESTORE);
        SetForegroundWindow(hwnd);
    }

    /// <summary>
    /// Actually exits the application (bypasses minimize-to-tray).
    /// </summary>
    public void ExitApplication()
    {
        _isExiting = true;
        _window.Close();
    }

    // Context menu handlers (called from XAML or code-behind)
    public void OnTrayCapture() => CaptureRequested?.Invoke();
    public void OnTraySettings() => SettingsRequested?.Invoke();

    public void OnTrayQuit()
    {
        QuitRequested?.Invoke();
        ExitApplication();
    }

    public void OnTrayDoubleClick() => RestoreFromTray();

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
    }
}
