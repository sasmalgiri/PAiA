using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using PAiA.WinUI.Models;
using PAiA.WinUI.Services.Audit;
using PAiA.WinUI.Services.FormHelper;
using Windows.ApplicationModel.DataTransfer;

namespace PAiA.WinUI;

public sealed partial class FormHelperOverlay : Window
{
    private readonly FormAnalysisService _formAnalysis;
    private readonly AuditLogService _audit;
    private readonly string _redactedOcr;
    private List<FormField> _fields = [];
    private int _copiedCount;

    public FormHelperOverlay(FormAnalysisService formAnalysis, AuditLogService audit, string redactedOcrText)
    {
        InitializeComponent();
        _formAnalysis = formAnalysis;
        _audit = audit;
        _redactedOcr = redactedOcrText;

        if (AppWindow is not null)
            AppWindow.Resize(new Windows.Graphics.SizeInt32(420, 600));

        Activated += async (_, _) => await AnalyzeAsync();
    }

    private async Task AnalyzeAsync()
    {
        try
        {
            _fields = await _formAnalysis.AnalyzeFormAsync(_redactedOcr);
            if (_fields.Count == 0)
            {
                StatusText.Text = "No form fields detected. Try a clearer capture.";
                Spinner.IsActive = false;
                return;
            }

            StatusText.Text = $"Found {_fields.Count} field{(_fields.Count != 1 ? "s" : "")}";
            Spinner.IsActive = false;
            RenderFieldCards();

            _audit.Log(new AuditEvent(Action: "form_analysis", Target: "overlay",
                OcrRedacted: _redactedOcr.Length > 200 ? _redactedOcr[..200] + "…" : _redactedOcr,
                Answer: $"Detected {_fields.Count} fields"));
        }
        catch (Exception ex)
        {
            StatusText.Text = $"Analysis failed: {ex.Message}";
            Spinner.IsActive = false;
        }
    }

    private void RenderFieldCards()
    {
        FieldsPanel.Children.Clear();
        foreach (var field in _fields)
            FieldsPanel.Children.Add(CreateFieldCard(field));
    }

    private Border CreateFieldCard(FormField field)
    {
        var headerPanel = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        headerPanel.Children.Add(new TextBlock
        {
            Text = field.Label, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            FontSize = 14, VerticalAlignment = VerticalAlignment.Center
        });

        if (field.IsRequired)
        {
            headerPanel.Children.Add(new Border
            {
                Background = new SolidColorBrush(ColorHelper.FromArgb(255, 220, 53, 69)),
                CornerRadius = new CornerRadius(3), Padding = new Thickness(5, 1, 5, 1),
                VerticalAlignment = VerticalAlignment.Center,
                Child = new TextBlock { Text = "Required", FontSize = 10, Foreground = new SolidColorBrush(Colors.White) }
            });
        }

        if (!string.IsNullOrEmpty(field.FieldType) && field.FieldType != "text")
        {
            headerPanel.Children.Add(new Border
            {
                Background = new SolidColorBrush(ColorHelper.FromArgb(255, 108, 117, 125)),
                CornerRadius = new CornerRadius(3), Padding = new Thickness(5, 1, 5, 1),
                VerticalAlignment = VerticalAlignment.Center,
                Child = new TextBlock { Text = field.FieldType, FontSize = 10, Foreground = new SolidColorBrush(Colors.White) }
            });
        }

        // Suggestion row with copy button
        var suggestionGrid = new Grid
        {
            ColumnDefinitions = { new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) }, new ColumnDefinition { Width = GridLength.Auto } }
        };

        var suggestionText = new TextBlock
        {
            Text = field.Suggestion, TextWrapping = TextWrapping.Wrap,
            IsTextSelectionEnabled = true, FontSize = 13, VerticalAlignment = VerticalAlignment.Center
        };
        Grid.SetColumn(suggestionText, 0);

        var copyBtn = new Button { Padding = new Thickness(8, 4, 8, 4), VerticalAlignment = VerticalAlignment.Top };
        ToolTipService.SetToolTip(copyBtn, "Copy suggestion");
        var copyIcon = new FontIcon { Glyph = "\uE8C8", FontSize = 14 };
        copyBtn.Content = copyIcon;
        Grid.SetColumn(copyBtn, 1);

        var capturedField = field;
        var capturedIcon = copyIcon;
        var capturedBtn = copyBtn;
        copyBtn.Click += (_, _) =>
        {
            CopyToClipboard(capturedField.Suggestion);
            capturedField.IsCopied = true;
            capturedIcon.Glyph = "\uE73E";
            capturedBtn.IsEnabled = false;
            _copiedCount++;
            CopiedCountText.Text = $"{_copiedCount} of {_fields.Count} copied";
        };

        suggestionGrid.Children.Add(suggestionText);
        suggestionGrid.Children.Add(copyBtn);

        var cardContent = new StackPanel { Spacing = 6 };
        cardContent.Children.Add(headerPanel);

        if (!string.IsNullOrEmpty(field.CurrentValue))
        {
            var cvPanel = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
            cvPanel.Children.Add(new TextBlock { Text = "Current:", Foreground = new SolidColorBrush(Colors.Gray), FontSize = 12 });
            cvPanel.Children.Add(new TextBlock { Text = field.CurrentValue, FontSize = 12, IsTextSelectionEnabled = true });
            cardContent.Children.Add(cvPanel);
        }

        cardContent.Children.Add(suggestionGrid);

        if (!string.IsNullOrEmpty(field.Notes))
        {
            cardContent.Children.Add(new TextBlock
            {
                Text = $"💡 {field.Notes}", FontSize = 11,
                Foreground = new SolidColorBrush(ColorHelper.FromArgb(255, 100, 149, 237)),
                TextWrapping = TextWrapping.Wrap
            });
        }

        var borderColor = field.Confidence switch
        {
            >= 0.8 => ColorHelper.FromArgb(255, 40, 167, 69),
            >= 0.5 => ColorHelper.FromArgb(255, 255, 193, 7),
            _ => ColorHelper.FromArgb(255, 220, 53, 69)
        };

        return new Border
        {
            BorderBrush = new SolidColorBrush(borderColor),
            BorderThickness = new Thickness(3, 0, 0, 0),
            Background = (Brush)Application.Current.Resources["CardBackgroundFillColorDefaultBrush"],
            CornerRadius = new CornerRadius(4), Padding = new Thickness(12, 10, 12, 10),
            Child = cardContent
        };
    }

    private void CopyAll_Click(object sender, RoutedEventArgs e)
    {
        if (_fields.Count == 0) return;
        var lines = _fields.Select(f => $"{f.Label}: {f.Suggestion}" +
            (string.IsNullOrEmpty(f.Notes) ? "" : $" ({f.Notes})"));
        CopyToClipboard(string.Join(Environment.NewLine, lines));
        _copiedCount = _fields.Count;
        CopiedCountText.Text = $"All {_fields.Count} copied ✓";
    }

    private void Close_Click(object sender, RoutedEventArgs e) => Close();

    private static void CopyToClipboard(string text)
    {
        var pkg = new DataPackage();
        pkg.SetText(text);
        Clipboard.SetContent(pkg);
        Clipboard.Flush();
    }
}
