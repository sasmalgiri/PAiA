using Vortice.Direct3D11;
using Vortice.DXGI;
using Windows.Graphics;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX;
using Windows.Graphics.DirectX.Direct3D11;

namespace PAiA.WinUI.Services.Capture;

/// <summary>
/// Captures a screen region chosen by the user via the system picker.
/// Uses Direct3D11 interop — no stealth, no background capture.
/// </summary>
public sealed class ScreenCaptureService : IDisposable
{
    private ID3D11Device? _d3dDevice;
    private IDirect3DDevice? _winrtDevice;
    private bool _disposed;

    public async Task<(SoftwareBitmap? bitmap, GraphicsCaptureItem? item)> CaptureAsync(IntPtr hwnd)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        EnsureDevice();

        var picker = new GraphicsCapturePicker();
        var initializeWithWindow = picker.As<IInitializeWithWindow>();
        initializeWithWindow.Initialize(hwnd);

        var captureItem = await picker.PickSingleItemAsync();
        if (captureItem is null) return (null, null);

        using var framePool = Direct3D11CaptureFramePool.Create(
            _winrtDevice!, DirectXPixelFormat.B8G8R8A8UIntNormalized, 1, captureItem.Size);

        var session = framePool.CreateCaptureSession(captureItem);

        var tcs = new TaskCompletionSource<Direct3D11CaptureFrame?>();
        framePool.FrameArrived += (pool, _) =>
        {
            var frame = pool.TryGetNextFrame();
            tcs.TrySetResult(frame);
        };

        session.StartCapture();
        var frame = await tcs.Task;
        session.Dispose();

        if (frame is null) return (null, captureItem);

        var bitmap = await SoftwareBitmap.CreateCopyFromSurfaceAsync(frame.Surface);
        frame.Dispose();

        return (bitmap, captureItem);
    }

    private void EnsureDevice()
    {
        if (_d3dDevice is not null) return;

        D3D11.D3D11CreateDevice(
            null, Vortice.Direct3D.DriverType.Hardware, DeviceCreationFlags.BgraSupport,
            null, out _d3dDevice, out _);

        using var dxgiDevice = _d3dDevice!.QueryInterface<IDXGIDevice>();
        _winrtDevice = Direct3D11Interop.CreateDirect3DDeviceFromDxgi(dxgiDevice.NativePointer);
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _winrtDevice?.Dispose();
        _d3dDevice?.Dispose();
    }

    [System.Runtime.InteropServices.ComImport]
    [System.Runtime.InteropServices.Guid("3E68D4BD-7135-4D10-8018-9FB6D9F33FA1")]
    [System.Runtime.InteropServices.InterfaceType(System.Runtime.InteropServices.ComInterfaceType.InterfaceIsIUnknown)]
    private interface IInitializeWithWindow
    {
        void Initialize(IntPtr hwnd);
    }
}
