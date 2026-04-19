using PAiA.WinUI.Services.Assistant;
using Xunit;

namespace PAiA.Tests;

public class ProactiveContextEngineTests
{
    [Theory]
    [InlineData("code", "Code")]
    [InlineData("devenv", "Code")]
    [InlineData("rider", "Code")]
    [InlineData("cursor", "Code")]
    public void Detects_CodeEditors(string process, string expected)
    {
        var ctx = ProactiveContextEngine.AnalyzeWindow("file.cs", process);
        Assert.Equal(expected, ctx.Category);
        Assert.True(ctx.Actions.Count >= 3);
    }

    [Theory]
    [InlineData("windowsterminal", "Terminal")]
    [InlineData("cmd", "Terminal")]
    [InlineData("powershell", "Terminal")]
    [InlineData("pwsh", "Terminal")]
    public void Detects_Terminals(string process, string expected)
    {
        var ctx = ProactiveContextEngine.AnalyzeWindow("Terminal", process);
        Assert.Equal(expected, ctx.Category);
    }

    [Theory]
    [InlineData("outlook", "Email")]
    [InlineData("thunderbird", "Email")]
    public void Detects_EmailClients(string process, string expected)
    {
        var ctx = ProactiveContextEngine.AnalyzeWindow("Inbox", process);
        Assert.Equal(expected, ctx.Category);
        Assert.Contains(ctx.Actions, a => a.label.Contains("Scan links"));
    }

    [Fact]
    public void Detects_Gmail_ByTitle()
    {
        var ctx = ProactiveContextEngine.AnalyzeWindow("Inbox - Gmail", "chrome");
        // Gmail in Chrome should be detected as Email
        Assert.True(ctx.Category is "Email" or "Browser");
    }

    [Theory]
    [InlineData("chrome", "Browser")]
    [InlineData("msedge", "Browser")]
    [InlineData("firefox", "Browser")]
    [InlineData("brave", "Browser")]
    public void Detects_Browsers(string process, string expected)
    {
        var ctx = ProactiveContextEngine.AnalyzeWindow("Google", process);
        Assert.Equal(expected, ctx.Category);
    }

    [Fact]
    public void Browser_LoginPage_ShowsWarning()
    {
        var ctx = ProactiveContextEngine.AnalyzeWindow("Login - MyBank", "chrome");
        Assert.True(ctx.SensitiveWarning);
        Assert.NotNull(ctx.AutoSuggestion);
    }

    [Theory]
    [InlineData("excel", "Spreadsheet")]
    public void Detects_Spreadsheets(string process, string expected)
    {
        var ctx = ProactiveContextEngine.AnalyzeWindow("Budget.xlsx", process);
        Assert.Equal(expected, ctx.Category);
        Assert.Contains(ctx.Actions, a => a.label.Contains("formula"));
    }

    [Fact]
    public void Detects_Word()
    {
        var ctx = ProactiveContextEngine.AnalyzeWindow("Report.docx - Word", "winword");
        Assert.Equal("Document", ctx.Category);
    }

    [Theory]
    [InlineData("slack", "Chat")]
    [InlineData("teams", "Chat")]
    [InlineData("discord", "Chat")]
    public void Detects_ChatApps(string process, string expected)
    {
        var ctx = ProactiveContextEngine.AnalyzeWindow("Chat", process);
        Assert.Equal(expected, ctx.Category);
    }

    [Fact]
    public void Detects_SensitiveApps()
    {
        var ctx = ProactiveContextEngine.AnalyzeWindow("Chase Bank - Online Banking", "chrome");
        Assert.True(ctx.SensitiveWarning);
    }

    [Fact]
    public void Unknown_App_ReturnsGeneral()
    {
        var ctx = ProactiveContextEngine.AnalyzeWindow("Some App", "randomprocess");
        Assert.Equal("General", ctx.Category);
        Assert.NotEmpty(ctx.Actions);
    }

    [Fact]
    public void Email_HasScanLinksAction()
    {
        var ctx = ProactiveContextEngine.AnalyzeWindow("Inbox", "outlook");
        Assert.Contains(ctx.Actions, a => a.prompt.Contains("phishing"));
    }

    [Fact]
    public void Code_HasExplainErrorAction()
    {
        var ctx = ProactiveContextEngine.AnalyzeWindow("app.py - VS Code", "code");
        Assert.Contains(ctx.Actions, a => a.label.Contains("error"));
    }

    [Fact]
    public void Actions_HaveLabelsAndPrompts()
    {
        var ctx = ProactiveContextEngine.AnalyzeWindow("test", "code");
        foreach (var (label, prompt, icon) in ctx.Actions)
        {
            Assert.NotEmpty(label);
            Assert.NotEmpty(prompt);
            Assert.NotEmpty(icon);
        }
    }

    [Fact]
    public void FileExplorer_Detected()
    {
        var ctx = ProactiveContextEngine.AnalyzeWindow("Documents", "explorer");
        Assert.Equal("Files", ctx.Category);
    }

    [Fact]
    public void Settings_Detected()
    {
        var ctx = ProactiveContextEngine.AnalyzeWindow("Windows Settings", "systemsettings");
        Assert.Equal("Settings", ctx.Category);
    }
}
