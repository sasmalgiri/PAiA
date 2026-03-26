using System.Diagnostics;
using System.Runtime.InteropServices;

namespace PAiA.WinUI.Services.ActiveWindow;

/// <summary>
/// Monitors which application window is currently active (foreground).
/// 
/// PURPOSE: Enables PAiA to know what the user is working on WITHOUT
/// capturing the screen. When the user presses Ctrl+Shift+P, PAiA
/// already knows the app context and can pre-select the best model
/// and system prompt.
/// 
/// PRIVACY: This only tracks the WINDOW TITLE and PROCESS NAME.
/// It does NOT read screen content, capture screenshots, or log keystrokes.
/// It's the same info visible in the Windows taskbar.
/// 
/// This is OPT-IN — disabled by default. User enables it in Settings.
/// </summary>
public sealed class ActiveWindowMonitor : IDisposable
{
    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    private Timer? _pollTimer;
    private string _lastWindowTitle = "";
    private string _lastProcessName = "";
    private bool _disposed;

    public bool IsEnabled { get; set; }

    /// <summary>Current active window title.</summary>
    public string CurrentWindowTitle => _lastWindowTitle;

    /// <summary>Current active process name.</summary>
    public string CurrentProcessName => _lastProcessName;

    /// <summary>Fires when the user switches to a different application.</summary>
    public event Action<string, string>? WindowChanged; // title, processName

    /// <summary>
    /// Starts polling the foreground window (every 500ms).
    /// Low overhead — just one Win32 call per tick.
    /// </summary>
    public void Start()
    {
        if (!IsEnabled) return;

        _pollTimer = new Timer(_ =>
        {
            try
            {
                var hwnd = GetForegroundWindow();
                if (hwnd == IntPtr.Zero) return;

                var sb = new System.Text.StringBuilder(512);
                GetWindowText(hwnd, sb, 512);
                var title = sb.ToString();

                GetWindowThreadProcessId(hwnd, out var pid);
                var processName = "";
                try { processName = Process.GetProcessById((int)pid).ProcessName; } catch { }

                // Only fire event on actual change
                if (title != _lastWindowTitle || processName != _lastProcessName)
                {
                    _lastWindowTitle = title;
                    _lastProcessName = processName;
                    WindowChanged?.Invoke(title, processName);
                }
            }
            catch { /* Never crash the monitor */ }
        }, null, TimeSpan.FromSeconds(1), TimeSpan.FromMilliseconds(500));
    }

    /// <summary>
    /// Stops monitoring.
    /// </summary>
    public void Stop()
    {
        _pollTimer?.Dispose();
        _pollTimer = null;
    }

    /// <summary>
    /// Gets the handle of the current foreground window.
    /// Useful when the user triggers a capture — we already know the target.
    /// </summary>
    public IntPtr GetForegroundWindowHandle() => GetForegroundWindow();

    /// <summary>
    /// Returns recent window history (for context).
    /// Not stored to disk — RAM only.
    /// </summary>
    public List<(string title, string process, DateTimeOffset time)> RecentWindows { get; } = [];

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _pollTimer?.Dispose();
    }
}
