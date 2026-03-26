using System.Runtime.InteropServices;
using Windows.Graphics.DirectX.Direct3D11;

namespace PAiA.WinUI.Services.Capture;

/// <summary>
/// Interop to create WinRT IDirect3DDevice from DXGI device.
/// </summary>
internal static class Direct3D11Interop
{
    [DllImport("d3d11.dll", EntryPoint = "CreateDirect3D11DeviceFromDXGIDevice", ExactSpelling = true)]
    private static extern int CreateDirect3D11DeviceFromDXGIDevice(IntPtr dxgiDevice, out IntPtr graphicsDevice);

    public static IDirect3DDevice CreateDirect3DDeviceFromDxgi(IntPtr dxgiDevicePtr)
    {
        var hr = CreateDirect3D11DeviceFromDXGIDevice(dxgiDevicePtr, out var pInspectable);
        Marshal.ThrowExceptionForHR(hr);

        var device = Marshal.GetObjectForIUnknown(pInspectable) as IDirect3DDevice
            ?? throw new InvalidOperationException("Failed to obtain IDirect3DDevice");
        Marshal.Release(pInspectable);
        return device;
    }
}
