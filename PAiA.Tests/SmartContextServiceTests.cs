using PAiA.WinUI.Models;
using PAiA.WinUI.Services.Context;
using Xunit;

namespace PAiA.Tests;

public class SmartContextServiceTests
{
    private readonly SmartContextService _svc = new();

    [Theory]
    [InlineData("public class MyApp { }", "", ContextType.Code)]
    [InlineData("def hello():\n    print('hi')", "", ContextType.Code)]
    [InlineData("import React from 'react'", "", ContextType.Code)]
    [InlineData("function main() { return 0; }", "Visual Studio", ContextType.Code)]
    [InlineData("namespace MyApp", "code.cs - VS Code", ContextType.Code)]
    public void Detects_Code(string ocr, string title, ContextType expected)
    {
        var ctx = _svc.Detect(ocr, title);
        Assert.Equal(expected, ctx.Type);
    }

    [Theory]
    [InlineData("Exception: NullReferenceException", "", ContextType.Error)]
    [InlineData("Error: failed to connect", "", ContextType.Error)]
    [InlineData("Fatal error 0x80070005", "", ContextType.Error)]
    [InlineData("Unhandled exception in module", "", ContextType.Error)]
    public void Detects_Errors(string ocr, string title, ContextType expected)
    {
        var ctx = _svc.Detect(ocr, title);
        Assert.Equal(expected, ctx.Type);
    }

    [Theory]
    [InlineData("C:\\> dir", "", ContextType.Terminal)]
    [InlineData("PS C:\\Users> Get-Process", "PowerShell", ContextType.Terminal)]
    [InlineData("$ npm install express", "Terminal", ContextType.Terminal)]
    [InlineData("git push origin main", "Command Prompt", ContextType.Terminal)]
    public void Detects_Terminal(string ocr, string title, ContextType expected)
    {
        var ctx = _svc.Detect(ocr, title);
        Assert.Equal(expected, ctx.Type);
    }

    [Fact]
    public void Detects_Form()
    {
        var ocr = "First Name: \nLast Name: \nEmail Address: \nRequired\nSubmit\nSign Up";
        var ctx = _svc.Detect(ocr, "");
        Assert.Equal(ContextType.Form, ctx.Type);
    }

    [Theory]
    [InlineData("https://www.google.com search results", "Chrome")]
    [InlineData("Bookmark Tab History", "Firefox")]
    public void Detects_Browser(string ocr, string title)
    {
        var ctx = _svc.Detect(ocr, title);
        Assert.Equal(ContextType.Browser, ctx.Type);
    }

    [Theory]
    [InlineData("From: boss@company.com Subject: Q3 Review", "Outlook")]
    [InlineData("Reply Forward Inbox Sent", "Gmail")]
    public void Detects_Email(string ocr, string title)
    {
        var ctx = _svc.Detect(ocr, title);
        Assert.Equal(ContextType.Email, ctx.Type);
    }

    [Theory]
    [InlineData("Enable Disable Toggle On Off", "Settings")]
    [InlineData("Display brightness", "Preferences")]
    public void Detects_Settings(string ocr, string title)
    {
        var ctx = _svc.Detect(ocr, title);
        Assert.Equal(ContextType.Settings, ctx.Type);
    }

    [Fact]
    public void Detects_Installer()
    {
        var ctx = _svc.Detect("I accept the license agreement Next Cancel Back", "Setup Wizard");
        Assert.Equal(ContextType.Installer, ctx.Type);
    }

    [Fact]
    public void Detects_Spreadsheet()
    {
        var ctx = _svc.Detect("=SUM(A1:A10) VLOOKUP", "Budget.xlsx - Excel");
        Assert.Equal(ContextType.Spreadsheet, ctx.Type);
    }

    [Fact]
    public void Returns_General_ForUnknown()
    {
        var ctx = _svc.Detect("Hello world", "Random App");
        Assert.Equal(ContextType.General, ctx.Type);
    }

    [Fact]
    public void Always_HasQuickActions()
    {
        foreach (ContextType type in Enum.GetValues<ContextType>())
        {
            var prompt = SmartContextService.GetSystemPrompt(type);
            Assert.NotNull(prompt);
            Assert.NotEmpty(prompt);
            Assert.Contains("PAiA", prompt);
        }
    }

    [Fact]
    public void QuickActions_HaveLabelsAndPrompts()
    {
        var ctx = _svc.Detect("public class Test { }", "VS Code");
        Assert.NotEmpty(ctx.QuickActions);
        foreach (var action in ctx.QuickActions)
        {
            Assert.NotEmpty(action.Label);
            Assert.NotEmpty(action.Prompt);
            Assert.NotEmpty(action.Icon);
        }
    }

    [Fact]
    public void Stores_AppName()
    {
        var ctx = _svc.Detect("some text", "MyApp - Window Title");
        Assert.Equal("MyApp - Window Title", ctx.AppName);
    }

    [Fact]
    public void Stores_RedactedOcr()
    {
        var ocr = "captured screen text";
        var ctx = _svc.Detect(ocr, "");
        Assert.Equal(ocr, ctx.RedactedOcr);
    }
}
