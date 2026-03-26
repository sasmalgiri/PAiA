using System.Runtime.InteropServices;

namespace PAiA.WinUI.Services.Hotkey;

/// <summary>
/// Registers a global hotkey (Ctrl+Shift+P) that works from any application.
/// When pressed, PAiA activates and starts a capture — no Alt+Tab needed.
/// 
/// This is the convenience feature that makes PAiA feel like a native OS tool
/// rather than "another app I have to switch to."
/// </summary>
public sealed class GlobalHotkeyService : IDisposable
{
    private const int HOTKEY_ID = 9001;
    private const int MOD_CONTROL = 0x0002;
    private const int MOD_SHIFT = 0x0004;
    private const int MOD_NOREPEAT = 0x4000;
    private const int VK_P = 0x50;
    private const int WM_HOTKEY = 0x0312;

    private IntPtr _hwnd;
    private bool _registered;
    private bool _disposed;

    public event Action? HotkeyPressed;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterHotKey(IntPtr hWnd, int id, int fsModifiers, int vk);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    /// <summary>
    /// Registers Ctrl+Shift+P as the global capture hotkey.
    /// </summary>
    public bool Register(IntPtr windowHandle)
    {
        _hwnd = windowHandle;
        _registered = RegisterHotKey(_hwnd, HOTKEY_ID,
            MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT, VK_P);
        return _registered;
    }

    /// <summary>
    /// Call this from your window's message handler (subclass proc).
    /// Returns true if the message was a hotkey press.
    /// </summary>
    public bool ProcessMessage(uint msg, IntPtr wParam)
    {
        if (msg == WM_HOTKEY && wParam.ToInt32() == HOTKEY_ID)
        {
            HotkeyPressed?.Invoke();
            return true;
        }
        return false;
    }

    /// <summary>
    /// Changes the hotkey combination. Unregisters old, registers new.
    /// </summary>
    public bool ChangeHotkey(int modifiers, int virtualKey)
    {
        if (_registered)
            UnregisterHotKey(_hwnd, HOTKEY_ID);

        _registered = RegisterHotKey(_hwnd, HOTKEY_ID,
            modifiers | MOD_NOREPEAT, virtualKey);
        return _registered;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        if (_registered && _hwnd != IntPtr.Zero)
            UnregisterHotKey(_hwnd, HOTKEY_ID);
    }
}
