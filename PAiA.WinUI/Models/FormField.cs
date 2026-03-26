namespace PAiA.WinUI.Models;

/// <summary>
/// Represents a single form field detected by OCR + LLM analysis.
/// </summary>
public sealed class FormField
{
    public string Label { get; set; } = string.Empty;
    public string CurrentValue { get; set; } = string.Empty;
    public string Suggestion { get; set; } = string.Empty;
    public string FieldType { get; set; } = "text";
    public bool IsRequired { get; set; }
    public string Notes { get; set; } = string.Empty;
    public double Confidence { get; set; }
    public bool IsCopied { get; set; }
}
