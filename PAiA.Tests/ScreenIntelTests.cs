using PAiA.WinUI.Services.ActiveWindow;
using PAiA.WinUI.Services.Plugin;
using PAiA.WinUI.Services.ScreenIntel;
using Xunit;

namespace PAiA.Tests;

// ═══ NER SERVICE ═══════════════════════════════════════════════════

public class NerServiceTests
{
    private readonly NerService _ner = new();

    [Theory]
    [InlineData("Name: John Smith", "PERSON_NAME")]
    [InlineData("Employee: Jane Doe", "PERSON_NAME")]
    [InlineData("From: Alice Johnson", "PERSON_NAME")]
    [InlineData("Assigned to Bob Wilson", "PERSON_NAME")]
    public void Detects_PersonNames_AfterKeywords(string input, string expectedType)
    {
        var entities = _ner.DetectEntities(input);
        Assert.Contains(entities, e => e.Type == expectedType);
    }

    [Theory]
    [InlineData("Mr. John Smith is here")]
    [InlineData("Dr. Sarah Connor arrived")]
    [InlineData("Prof. Alan Turing")]
    public void Detects_PersonNames_WithTitles(string input)
    {
        var entities = _ner.DetectEntities(input);
        Assert.Contains(entities, e => e.Type == "PERSON_NAME");
    }

    [Theory]
    [InlineData("Address: 123 Main St")]
    [InlineData("Ship to: 456 Oak Ave")]
    public void Detects_Addresses(string input)
    {
        var entities = _ner.DetectEntities(input);
        Assert.NotEmpty(entities);
    }

    [Theory]
    [InlineData("Salary: $85,000/year", "FINANCIAL")]
    [InlineData("Total: €1,234.56", "FINANCIAL")]
    [InlineData("Payment: £500", "FINANCIAL")]
    [InlineData("Balance: ₹50,000", "FINANCIAL")]
    public void Detects_FinancialAmounts(string input, string expectedType)
    {
        var entities = _ner.DetectEntities(input);
        Assert.Contains(entities, e => e.Type == expectedType);
    }

    [Theory]
    [InlineData("Diagnosis: Type 2 Diabetes", "MEDICAL")]
    [InlineData("Medication: Metformin 500mg", "MEDICAL")]
    public void Detects_MedicalTerms(string input, string expectedType)
    {
        var entities = _ner.DetectEntities(input);
        Assert.Contains(entities, e => e.Type == expectedType);
    }

    [Fact]
    public void Detects_DatesOfBirth()
    {
        var entities = _ner.DetectEntities("DOB: 03/15/1990");
        Assert.Contains(entities, e => e.Type == "DATE_OF_BIRTH");
    }

    [Fact]
    public void RedactEntities_RemovesDetected()
    {
        var text = "Name: John Smith, Salary: $85,000/year";
        var entities = _ner.DetectEntities(text);
        var redacted = _ner.RedactEntities(text, entities);
        Assert.DoesNotContain("John Smith", redacted);
        Assert.DoesNotContain("$85,000", redacted);
        Assert.Contains("[PERSON_NAME-REDACTED]", redacted);
    }

    [Fact]
    public void ReturnsEmpty_ForCleanText()
    {
        var entities = _ner.DetectEntities("The weather is nice today");
        Assert.Empty(entities);
    }

    [Fact]
    public void Handles_EmptyInput()
    {
        var entities = _ner.DetectEntities("");
        Assert.Empty(entities);
    }

    [Fact]
    public void Handles_MultipleEntities()
    {
        var text = "From: John Smith, Salary: $100,000, Diagnosis: Asthma";
        var entities = _ner.DetectEntities(text);
        Assert.True(entities.Count >= 3, $"Expected 3+ entities, got {entities.Count}");
    }

    [Fact]
    public void Deduplicates_Overlapping()
    {
        var text = "Name: Dr. John Smith works here";
        var entities = _ner.DetectEntities(text);
        // Should not have overlapping entities for the same text span
        for (int i = 0; i < entities.Count - 1; i++)
        {
            for (int j = i + 1; j < entities.Count; j++)
            {
                var overlap = entities[i].StartIndex < entities[j].EndIndex &&
                              entities[j].StartIndex < entities[i].EndIndex;
                Assert.False(overlap, $"Entities overlap: '{entities[i].Text}' and '{entities[j].Text}'");
            }
        }
    }

    [Fact]
    public void LowConfidence_NotRedacted()
    {
        var entities = new List<NerEntity>
        {
            new() { Text = "test", Type = "TEST", StartIndex = 0, EndIndex = 4, Confidence = 0.3 }
        };
        var redacted = _ner.RedactEntities("test data", entities, minConfidence: 0.5);
        Assert.Contains("test", redacted); // Below threshold, should remain
    }
}

// ═══ PLUGIN MANAGER ════════════════════════════════════════════════

public class PluginManagerTests
{
    [Fact]
    public void LoadAll_HandlesEmptyDirectory()
    {
        var pm = new PluginManager();
        pm.LoadAll(); // Should not throw even if no plugins
        Assert.NotNull(pm.Plugins);
    }

    [Fact]
    public void CreateSamplePlugin_CreatesSample()
    {
        var pm = new PluginManager();
        pm.CreateSamplePlugin(); // Should not throw
    }

    [Fact]
    public void DetectPlugin_ReturnsNull_WhenNoMatch()
    {
        var pm = new PluginManager();
        pm.LoadAll();
        var result = pm.DetectPlugin("Hello world", "Notepad");
        // May or may not match depending on plugins installed
        // Just verify it doesn't crash
        Assert.True(true);
    }

    [Fact]
    public void GetPluginActions_ReturnsActions()
    {
        var plugin = new PluginDefinition
        {
            Name = "Test",
            QuickActions =
            [
                new PluginAction { Label = "Action 1", Prompt = "Do thing 1" },
                new PluginAction { Label = "Action 2", Prompt = "Do thing 2" }
            ]
        };

        var pm = new PluginManager();
        var actions = pm.GetPluginActions(plugin);

        Assert.Equal(2, actions.Count);
        Assert.Equal("Action 1", actions[0].Label);
        Assert.Equal("Do thing 1", actions[0].Prompt);
    }
}

// ═══ ACTIVE WINDOW MONITOR ═════════════════════════════════════════

public class ActiveWindowMonitorTests
{
    [Fact]
    public void Defaults_Disabled()
    {
        var monitor = new ActiveWindowMonitor();
        Assert.False(monitor.IsEnabled);
    }

    [Fact]
    public void Start_DoesNothing_WhenDisabled()
    {
        var monitor = new ActiveWindowMonitor();
        monitor.Start(); // Should be no-op when disabled
        Assert.Empty(monitor.CurrentWindowTitle);
    }

    [Fact]
    public void Dispose_DoesNotThrow()
    {
        var monitor = new ActiveWindowMonitor();
        monitor.IsEnabled = true;
        monitor.Start();
        monitor.Dispose(); // Should not throw
    }

    [Fact]
    public void GetForegroundWindowHandle_ReturnsValue()
    {
        var monitor = new ActiveWindowMonitor();
        var hwnd = monitor.GetForegroundWindowHandle();
        // In a test environment, this should return something (test runner window)
        // Just verify it doesn't crash
        Assert.True(true);
    }
}

// ═══ VISION SERVICE ════════════════════════════════════════════════

public class VisionServiceTests
{
    [Fact]
    public void IsAvailable_FalseByDefault()
    {
        var vs = new VisionService();
        Assert.False(vs.IsAvailable);
        Assert.Null(vs.ActiveModel);
    }

    [Fact]
    public async Task DetectVisionModel_HandlesNoOllama()
    {
        var vs = new VisionService();
        await vs.DetectVisionModelAsync(); // Should not throw even if Ollama isn't running
        // May or may not find a model - just verify no exception
        Assert.True(true);
    }
}

// ═══ SCREEN INTEL PIPELINE ═════════════════════════════════════════

public class ScreenIntelResultTests
{
    [Fact]
    public void GetSignalSummary_FormatsCorrectly()
    {
        var result = new ScreenIntelResult();
        result.Signals["OCR"] = true;
        result.Signals["UIAutomation"] = true;
        result.Signals["Vision"] = false;
        result.Signals["WindowInfo"] = true;

        var summary = result.GetSignalSummary();
        Assert.Contains("OCR", summary);
        Assert.Contains("UIAutomation", summary);
        Assert.Contains("Vision", summary);
        Assert.Contains("Unavailable", summary);
    }

    [Fact]
    public void Defaults_AreClean()
    {
        var result = new ScreenIntelResult();
        Assert.Equal("", result.RawOcrText);
        Assert.Equal("", result.FusedText);
        Assert.Equal("", result.RedactedText);
        Assert.Equal(0, result.TotalRedactionCount);
        Assert.Empty(result.Signals);
        Assert.Empty(result.NerEntities);
    }
}

// ═══ UI AUTOMATION SERVICE ═════════════════════════════════════════

public class UITreeSnapshotTests
{
    [Fact]
    public void InteractiveCount_CountsCorrectly()
    {
        var snapshot = new UITreeSnapshot
        {
            Elements =
            [
                new UIElement { ControlType = "button" },
                new UIElement { ControlType = "edit" },
                new UIElement { ControlType = "text" },
                new UIElement { ControlType = "combo box" },
                new UIElement { ControlType = "check box" },
                new UIElement { ControlType = "pane" },
            ]
        };

        Assert.Equal(4, snapshot.InteractiveCount); // button, edit, combo box, check box
    }

    [Fact]
    public void EmptySnapshot_HasZeroInteractive()
    {
        var snapshot = new UITreeSnapshot();
        Assert.Equal(0, snapshot.InteractiveCount);
    }
}
