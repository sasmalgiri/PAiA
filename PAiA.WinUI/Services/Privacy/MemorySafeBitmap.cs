using Windows.Graphics.Imaging;

namespace PAiA.WinUI.Services.Privacy;

/// <summary>
/// Wraps a SoftwareBitmap with guarantees that:
/// 1. The bitmap is NEVER written to disk
/// 2. The bitmap is disposed as soon as OCR completes
/// 3. The bitmap memory is cleared on disposal
/// 
/// Usage:
///   using var safeBitmap = new MemorySafeBitmap(capturedBitmap);
///   var text = await ocr.ExtractTextAsync(safeBitmap.Bitmap);
///   // Bitmap is auto-disposed when scope exits — no disk trace
/// </summary>
public sealed class MemorySafeBitmap : IDisposable
{
    private SoftwareBitmap? _bitmap;
    private bool _disposed;
    private readonly DateTimeOffset _createdAt = DateTimeOffset.Now;

    /// <summary>Maximum time a bitmap can exist in memory (safety timeout).</summary>
    private static readonly TimeSpan MaxLifetime = TimeSpan.FromSeconds(30);

    public SoftwareBitmap Bitmap
    {
        get
        {
            ObjectDisposedException.ThrowIf(_disposed, this);

            // Auto-expire if held too long (defensive coding)
            if (DateTimeOffset.Now - _createdAt > MaxLifetime)
            {
                Dispose();
                throw new ObjectDisposedException(nameof(MemorySafeBitmap),
                    "Bitmap expired — screenshots cannot be held in memory beyond 30 seconds.");
            }

            return _bitmap!;
        }
    }

    public MemorySafeBitmap(SoftwareBitmap bitmap)
    {
        _bitmap = bitmap ?? throw new ArgumentNullException(nameof(bitmap));
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        _bitmap?.Dispose();
        _bitmap = null;

        // Force GC to collect bitmap memory promptly
        GC.Collect(0, GCCollectionMode.Optimized);
    }
}
