using System.Text.Json;
using PAiA.WinUI.Models;
using PAiA.WinUI.Services.Llm;

namespace PAiA.WinUI.Services.FormHelper;

/// <summary>
/// Analyzes OCR text from a form and produces structured field suggestions.
/// </summary>
public sealed class FormAnalysisService
{
    private const string SystemPrompt = """
        You are a form-filling assistant. Identify every visible form field.
        NEVER invent personal data — describe what is needed.
        Respond ONLY with a JSON array. No markdown. Example:
        [{"label":"Email","currentValue":"","suggestion":"Enter valid email","fieldType":"email","isRequired":true,"notes":"For verification","confidence":0.9}]
        If no fields found, return: []
        """;

    private readonly ILlmClient _ollama;
    public FormAnalysisService(ILlmClient ollama) => _ollama = ollama;

    public async Task<List<FormField>> AnalyzeFormAsync(string redactedOcr, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(redactedOcr)) return [];
        var response = await _ollama.ChatAsync(SystemPrompt,
            $"OCR text (PII redacted):\n\n{redactedOcr}\n\nIdentify all form fields. JSON array only.", ct);
        return ParseFields(response);
    }

    private static List<FormField> ParseFields(string response)
    {
        if (string.IsNullOrWhiteSpace(response)) return [];
        var json = response.Trim();
        if (json.StartsWith("```"))
        {
            var nl = json.IndexOf('\n');
            if (nl > 0) json = json[(nl + 1)..];
            var lf = json.LastIndexOf("```");
            if (lf > 0) json = json[..lf];
        }
        json = json.Trim();
        var s = json.IndexOf('['); var e = json.LastIndexOf(']');
        if (s < 0 || e <= s) return [];
        json = json[s..(e + 1)];
        try
        {
            var dtos = JsonSerializer.Deserialize<List<FormFieldDto>>(json,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            return dtos?.Select(d => new FormField
            {
                Label = d.Label ?? "Unknown", CurrentValue = d.CurrentValue ?? "",
                Suggestion = d.Suggestion ?? "", FieldType = d.FieldType ?? "text",
                IsRequired = d.IsRequired, Notes = d.Notes ?? "",
                Confidence = Math.Clamp(d.Confidence, 0, 1)
            }).ToList() ?? [];
        }
        catch (JsonException) { return []; }
    }

    private sealed class FormFieldDto
    {
        public string? Label { get; set; } public string? CurrentValue { get; set; }
        public string? Suggestion { get; set; } public string? FieldType { get; set; }
        public bool IsRequired { get; set; } public string? Notes { get; set; }
        public double Confidence { get; set; }
    }
}
