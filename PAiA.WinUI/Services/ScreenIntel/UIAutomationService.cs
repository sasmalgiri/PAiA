using System.Runtime.InteropServices;
using System.Text;

namespace PAiA.WinUI.Services.ScreenIntel;

/// <summary>
/// Extracts structured UI data from any Windows application using
/// the UI Automation framework — the same API screen readers use.
/// 
/// WHY THIS IS BETTER THAN OCR ALONE:
/// - OCR sees pixels → text. UI Automation sees the ACTUAL UI tree.
/// - OCR can't tell a button from a label. UIA knows the control type.
/// - OCR misreads formatted text. UIA gets the exact string value.
/// - OCR can't see disabled/enabled state. UIA reports it.
/// - OCR can't read dropdown values. UIA enumerates them.
/// - OCR fails on custom-rendered controls. UIA still works if app supports it.
/// 
/// LIMITATIONS:
/// - Only works for apps that implement UI Automation providers
/// - Remote desktop / game windows fall back to OCR
/// - Some Electron apps have poor UIA support
/// 
/// PAiA uses BOTH — UIA for structured data, OCR as fallback.
/// </summary>
public sealed class UIAutomationService
{
    // COM interop for UI Automation
    [DllImport("UIAutomationCore.dll")]
    private static extern int UiaGetRootElement(out IntPtr element);

    /// <summary>
    /// Extracts the UI tree from a window, returning structured elements.
    /// Uses .NET System.Windows.Automation via reflection to avoid
    /// direct WPF dependency in WinUI 3.
    /// </summary>
    public UITreeSnapshot CaptureUITree(IntPtr windowHandle)
    {
        var snapshot = new UITreeSnapshot
        {
            CapturedAt = DateTimeOffset.Now,
            WindowHandle = windowHandle
        };

        try
        {
            // Use System.Windows.Automation via the AutomationElement API
            var element = System.Windows.Automation.AutomationElement.FromHandle(windowHandle);
            if (element is null)
            {
                snapshot.Success = false;
                snapshot.FallbackReason = "Window not found in UI Automation tree";
                return snapshot;
            }

            snapshot.WindowName = element.Current.Name;
            snapshot.ProcessName = GetProcessName(element.Current.ProcessId);
            snapshot.Success = true;

            // Walk the tree
            WalkTree(element, snapshot.Elements, depth: 0, maxDepth: 8);

            // Generate structured text representation
            snapshot.StructuredText = GenerateStructuredText(snapshot.Elements);
        }
        catch (Exception ex)
        {
            snapshot.Success = false;
            snapshot.FallbackReason = $"UI Automation failed: {ex.Message}";
        }

        return snapshot;
    }

    /// <summary>
    /// Recursively walks the UI Automation tree.
    /// </summary>
    private void WalkTree(
        System.Windows.Automation.AutomationElement element,
        List<UIElement> elements,
        int depth,
        int maxDepth)
    {
        if (depth > maxDepth) return;

        try
        {
            var current = element.Current;
            var uiElement = new UIElement
            {
                Name = current.Name ?? "",
                ControlType = current.LocalizedControlType ?? "",
                AutomationId = current.AutomationId ?? "",
                ClassName = current.ClassName ?? "",
                IsEnabled = current.IsEnabled,
                IsOffscreen = current.IsOffscreen,
                Depth = depth,
                BoundingRect = new UIRect
                {
                    X = current.BoundingRectangle.X,
                    Y = current.BoundingRectangle.Y,
                    Width = current.BoundingRectangle.Width,
                    Height = current.BoundingRectangle.Height
                }
            };

            // Extract value if available (text boxes, sliders, etc.)
            try
            {
                if (element.TryGetCurrentPattern(
                    System.Windows.Automation.ValuePattern.Pattern, out var valuePattern))
                {
                    var vp = (System.Windows.Automation.ValuePattern)valuePattern;
                    uiElement.Value = vp.Current.Value;
                    uiElement.IsReadOnly = vp.Current.IsReadOnly;
                }
            }
            catch { /* Value not available for this element */ }

            // Extract selection state
            try
            {
                if (element.TryGetCurrentPattern(
                    System.Windows.Automation.SelectionItemPattern.Pattern, out var selPattern))
                {
                    var sp = (System.Windows.Automation.SelectionItemPattern)selPattern;
                    uiElement.IsSelected = sp.Current.IsSelected;
                }
            }
            catch { }

            // Extract toggle state (checkboxes, toggle buttons)
            try
            {
                if (element.TryGetCurrentPattern(
                    System.Windows.Automation.TogglePattern.Pattern, out var togglePattern))
                {
                    var tp = (System.Windows.Automation.TogglePattern)togglePattern;
                    uiElement.ToggleState = tp.Current.ToggleState.ToString();
                }
            }
            catch { }

            // Don't include empty/offscreen elements
            if (!uiElement.IsOffscreen &&
                (!string.IsNullOrEmpty(uiElement.Name) || !string.IsNullOrEmpty(uiElement.Value)))
            {
                elements.Add(uiElement);
            }

            // Recurse into children
            var children = element.FindAll(
                System.Windows.Automation.TreeScope.Children,
                System.Windows.Automation.Condition.TrueCondition);

            foreach (System.Windows.Automation.AutomationElement child in children)
            {
                WalkTree(child, elements, depth + 1, maxDepth);
            }
        }
        catch { /* Skip elements that throw */ }
    }

    /// <summary>
    /// Generates a human-readable structured text from the UI tree.
    /// This is much richer than raw OCR because it includes control types,
    /// states, and hierarchy.
    /// </summary>
    private static string GenerateStructuredText(List<UIElement> elements)
    {
        var sb = new StringBuilder();

        foreach (var el in elements)
        {
            var indent = new string(' ', el.Depth * 2);
            var type = el.ControlType;
            var name = el.Name;
            var value = el.Value;
            var state = new List<string>();

            if (!el.IsEnabled) state.Add("disabled");
            if (el.IsSelected) state.Add("selected");
            if (!string.IsNullOrEmpty(el.ToggleState)) state.Add(el.ToggleState);
            if (el.IsReadOnly) state.Add("readonly");

            var stateStr = state.Count > 0 ? $" [{string.Join(", ", state)}]" : "";

            if (!string.IsNullOrEmpty(value) && value != name)
                sb.AppendLine($"{indent}[{type}] {name}: {value}{stateStr}");
            else if (!string.IsNullOrEmpty(name))
                sb.AppendLine($"{indent}[{type}] {name}{stateStr}");
        }

        return sb.ToString();
    }

    private static string GetProcessName(int processId)
    {
        try
        {
            return System.Diagnostics.Process.GetProcessById(processId).ProcessName;
        }
        catch { return "unknown"; }
    }
}

// ═══ Models ═══════════════════════════════════════════════════════

/// <summary>
/// Complete snapshot of a window's UI tree.
/// </summary>
public sealed class UITreeSnapshot
{
    public bool Success { get; set; }
    public string? FallbackReason { get; set; }
    public DateTimeOffset CapturedAt { get; set; }
    public IntPtr WindowHandle { get; set; }
    public string WindowName { get; set; } = "";
    public string ProcessName { get; set; } = "";
    public List<UIElement> Elements { get; set; } = [];
    public string StructuredText { get; set; } = "";

    /// <summary>Quick count of interactive elements.</summary>
    public int InteractiveCount => Elements.Count(e =>
        e.ControlType is "button" or "edit" or "combo box" or "check box" or
        "radio button" or "slider" or "tab item" or "menu item" or "list item");
}

/// <summary>
/// A single UI element from the automation tree.
/// </summary>
public sealed class UIElement
{
    public string Name { get; set; } = "";
    public string ControlType { get; set; } = "";
    public string AutomationId { get; set; } = "";
    public string ClassName { get; set; } = "";
    public string? Value { get; set; }
    public bool IsEnabled { get; set; } = true;
    public bool IsOffscreen { get; set; }
    public bool IsSelected { get; set; }
    public bool IsReadOnly { get; set; }
    public string? ToggleState { get; set; }
    public int Depth { get; set; }
    public UIRect BoundingRect { get; set; } = new();
}

public sealed class UIRect
{
    public double X { get; set; }
    public double Y { get; set; }
    public double Width { get; set; }
    public double Height { get; set; }
}
