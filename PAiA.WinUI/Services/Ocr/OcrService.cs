using Windows.Graphics.Imaging;
using Windows.Media.Ocr;

namespace PAiA.WinUI.Services.Ocr;

/// <summary>
/// Extracts text from bitmaps using Windows built-in OCR.
/// Runs entirely on-device — no cloud calls.
/// </summary>
public sealed class OcrService
{
    private readonly OcrEngine _engine;

    public OcrService(string? language = null)
    {
        _engine = language is not null
            ? OcrEngine.TryCreateFromLanguage(new Windows.Globalization.Language(language))
              ?? OcrEngine.TryCreateFromUserProfileLanguages()
              ?? throw new InvalidOperationException("No OCR engine available")
            : OcrEngine.TryCreateFromUserProfileLanguages()
              ?? throw new InvalidOperationException("No OCR engine available");
    }

    /// <summary>
    /// Extracts text from a SoftwareBitmap.
    /// </summary>
    public async Task<string> ExtractTextAsync(SoftwareBitmap bitmap)
    {
        // OCR requires BGRA8 + premultiplied alpha
        SoftwareBitmap ocrBitmap;
        if (bitmap.BitmapPixelFormat != BitmapPixelFormat.Bgra8 ||
            bitmap.BitmapAlphaMode != BitmapAlphaMode.Premultiplied)
        {
            ocrBitmap = SoftwareBitmap.Convert(bitmap, BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied);
        }
        else
        {
            ocrBitmap = bitmap;
        }

        var result = await _engine.RecognizeAsync(ocrBitmap);
        return result.Text;
    }
}
