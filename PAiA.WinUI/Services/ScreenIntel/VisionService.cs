using System.Net.Http.Json;
using System.Text.Json;
using Windows.Graphics.Imaging;
using Windows.Storage.Streams;

namespace PAiA.WinUI.Services.ScreenIntel;

/// <summary>
/// Sends screenshots to vision-capable LLMs for understanding
/// that goes beyond text extraction.
/// 
/// WHAT VISION ADDS OVER OCR:
/// - Understands layout (sidebar vs main content vs toolbar)
/// - Reads charts and graphs
/// - Identifies icons and visual indicators (red X, green check)
/// - Understands UI patterns (modal dialog, settings panel, error state)
/// - Reads handwritten text
/// - Describes images embedded in the UI
/// 
/// Requires a vision-capable model: qwen3-vl, llava, llama-vision, etc.
/// Falls back gracefully if no vision model is available.
/// </summary>
public sealed class VisionService
{
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromMinutes(2) };
    private const string BaseUrl = "http://localhost:11434";
    private string? _visionModel;

    public bool IsAvailable => _visionModel is not null;
    public string? ActiveModel => _visionModel;

    /// <summary>
    /// Auto-detects if a vision-capable model is installed.
    /// Call once at startup.
    /// </summary>
    public async Task DetectVisionModelAsync()
    {
        try
        {
            var resp = await _http.GetFromJsonAsync<JsonDocument>($"{BaseUrl}/api/tags");
            if (resp is null) return;

            var models = resp.RootElement.GetProperty("models").EnumerateArray();
            var visionModels = new[] { "qwen3-vl", "qwen2-vl", "llava", "llama-vision",
                                       "moondream", "bakllava", "minicpm-v" };

            foreach (var model in models)
            {
                var name = model.GetProperty("name").GetString() ?? "";
                if (visionModels.Any(v => name.Contains(v, StringComparison.OrdinalIgnoreCase)))
                {
                    _visionModel = name;
                    return;
                }
            }
        }
        catch { }
    }

    /// <summary>
    /// Sends a screenshot to the vision model for description.
    /// </summary>
    public async Task<string> DescribeScreenAsync(SoftwareBitmap bitmap, CancellationToken ct = default)
    {
        if (_visionModel is null)
            return "";

        // Convert bitmap to base64 JPEG
        var base64 = await BitmapToBase64Async(bitmap);
        if (string.IsNullOrEmpty(base64)) return "";

        var payload = new
        {
            model = _visionModel,
            stream = false,
            messages = new[]
            {
                new
                {
                    role = "user",
                    content = "Describe what you see on this screen. Focus on: " +
                              "1) What application/page is this? " +
                              "2) What is the user currently doing? " +
                              "3) Are there any errors, warnings, or important notifications? " +
                              "4) What are the main interactive elements (buttons, fields, tabs)?",
                    images = new[] { base64 }
                }
            }
        };

        var response = await _http.PostAsJsonAsync($"{BaseUrl}/api/chat", payload, ct);
        response.EnsureSuccessStatusCode();

        var result = await response.Content.ReadFromJsonAsync<JsonDocument>(cancellationToken: ct);
        return result?.RootElement
            .GetProperty("message")
            .GetProperty("content")
            .GetString() ?? "";
    }

    /// <summary>
    /// Asks the vision model a specific question about the screen.
    /// </summary>
    public async Task<string> AskAboutScreenAsync(
        SoftwareBitmap bitmap, string question, CancellationToken ct = default)
    {
        if (_visionModel is null) return "";

        var base64 = await BitmapToBase64Async(bitmap);
        if (string.IsNullOrEmpty(base64)) return "";

        var payload = new
        {
            model = _visionModel,
            stream = false,
            messages = new[]
            {
                new
                {
                    role = "user",
                    content = question,
                    images = new[] { base64 }
                }
            }
        };

        var response = await _http.PostAsJsonAsync($"{BaseUrl}/api/chat", payload, ct);
        response.EnsureSuccessStatusCode();

        var result = await response.Content.ReadFromJsonAsync<JsonDocument>(cancellationToken: ct);
        return result?.RootElement
            .GetProperty("message")
            .GetProperty("content")
            .GetString() ?? "";
    }

    /// <summary>
    /// Converts a SoftwareBitmap to a base64-encoded JPEG string.
    /// </summary>
    private static async Task<string> BitmapToBase64Async(SoftwareBitmap bitmap)
    {
        try
        {
            using var stream = new InMemoryRandomAccessStream();
            var encoder = await BitmapEncoder.CreateAsync(BitmapEncoder.JpegEncoderId, stream);

            // Ensure correct pixel format
            var convertedBitmap = bitmap.BitmapPixelFormat != BitmapPixelFormat.Bgra8
                ? SoftwareBitmap.Convert(bitmap, BitmapPixelFormat.Bgra8)
                : bitmap;

            encoder.SetSoftwareBitmap(convertedBitmap);
            encoder.BitmapTransform.ScaledWidth = (uint)Math.Min(1920, bitmap.PixelWidth);
            encoder.BitmapTransform.ScaledHeight = (uint)Math.Min(1080, bitmap.PixelHeight);
            encoder.BitmapTransform.InterpolationMode = BitmapInterpolationMode.Linear;

            await encoder.FlushAsync();

            var bytes = new byte[stream.Size];
            var reader = new DataReader(stream.GetInputStreamAt(0));
            await reader.LoadAsync((uint)stream.Size);
            reader.ReadBytes(bytes);

            return Convert.ToBase64String(bytes);
        }
        catch
        {
            return "";
        }
    }
}
