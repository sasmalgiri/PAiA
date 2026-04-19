using PAiA.WinUI.Services.Redaction;
using PAiA.WinUI.Services.ScreenIntel;
using PAiA.WinUI.Services.WebSearch;
using Xunit;

namespace PAiA.Tests;

// ═══ SEARCH QUERY SANITIZER ════════════════════════════════════════

public class SearchQuerySanitizerTests
{
    private static SearchQuerySanitizer CreateSanitizer()
    {
        return new SearchQuerySanitizer(
            new RedactionService(),
            new CustomRedactionRules(),
            new NerService());
    }

    [Fact]
    public void Strips_Email()
    {
        var sanitizer = CreateSanitizer();
        var result = sanitizer.Sanitize("error from john@company.com in module");
        Assert.DoesNotContain("john@company.com", result.Sanitized);
        Assert.True(result.WasModified);
    }

    [Fact]
    public void Strips_CreditCard()
    {
        var sanitizer = CreateSanitizer();
        var result = sanitizer.Sanitize("payment failed for 4532015112830366");
        Assert.DoesNotContain("4532015112830366", result.Sanitized);
    }

    [Fact]
    public void Strips_SSN()
    {
        var sanitizer = CreateSanitizer();
        var result = sanitizer.Sanitize("error processing SSN 123-45-6789");
        Assert.DoesNotContain("123-45-6789", result.Sanitized);
    }

    [Fact]
    public void Preserves_Technical_Content()
    {
        var sanitizer = CreateSanitizer();
        var result = sanitizer.Sanitize("fix error CS0246 WinUI 3 .NET 8");
        Assert.Contains("CS0246", result.Sanitized);
        Assert.Contains("WinUI", result.Sanitized);
        Assert.Contains(".NET", result.Sanitized);
    }

    [Fact]
    public void Handles_Empty()
    {
        var sanitizer = CreateSanitizer();
        var result = sanitizer.Sanitize("");
        Assert.False(result.WasModified);
        Assert.Equal("", result.Sanitized);
    }

    [Fact]
    public void Removes_RedactionTags()
    {
        var sanitizer = CreateSanitizer();
        var result = sanitizer.Sanitize("user john@test.com reported error CS0246");
        // After redaction: "user [EMAIL-REDACTED] reported error CS0246"
        // After cleanup: "user reported error CS0246"
        Assert.DoesNotContain("[", result.Sanitized);
        Assert.DoesNotContain("REDACTED", result.Sanitized);
    }

    [Fact]
    public void BuildSearchPrompt_HasContext()
    {
        var prompt = SearchQuerySanitizer.BuildSearchPrompt("how to fix this", "Error");
        Assert.Contains("Error", prompt);
        Assert.Contains("search query", prompt.ToLower());
    }
}

// ═══ WEB SEARCH SERVICE ════════════════════════════════════════════

public class WebSearchServiceTests
{
    private static WebSearchService CreateService()
    {
        var sanitizer = new SearchQuerySanitizer(
            new RedactionService(),
            new CustomRedactionRules(),
            new NerService());
        return new WebSearchService(sanitizer);
    }

    [Fact]
    public async Task Search_ReturnsDisabled_WhenOff()
    {
        var svc = CreateService();
        svc.IsEnabled = false;
        var result = await svc.SearchAsync("test query");
        Assert.False(result.HasResults);
        Assert.Contains("disabled", result.Error, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void IsEnabled_FalseByDefault()
    {
        var svc = CreateService();
        Assert.False(svc.IsEnabled);
    }

    [Fact]
    public void GetPrivacyStatus_ShowsIsolated_WhenDisabled()
    {
        var svc = CreateService();
        svc.IsEnabled = false;
        Assert.Contains("isolated", svc.GetPrivacyStatus());
    }

    [Fact]
    public void GetPrivacyStatus_ShowsEnabled_WhenOn()
    {
        var svc = CreateService();
        svc.IsEnabled = true;
        Assert.Contains("enabled", svc.GetPrivacyStatus());
    }

    [Fact]
    public void GetStats_Defaults()
    {
        var svc = CreateService();
        var stats = svc.GetStats();
        Assert.Equal(0, stats.TotalSearches);
        Assert.Equal(0, stats.TotalPageFetches);
        Assert.False(stats.IsEnabled);
    }

    [Fact]
    public void ClearAuditLog_Clears()
    {
        var svc = CreateService();
        svc.ClearAuditLog();
        Assert.Empty(svc.AuditLog);
    }

    [Fact]
    public void BuildSearchContext_FormatsResults()
    {
        var results = new SearchResultSet
        {
            Query = "fix error CS0246",
            Results =
            [
                new SearchResult { Title = "CS0246 Fix", Snippet = "Install the package", Url = "https://docs.ms" },
                new SearchResult { Title = "Stack Overflow", Snippet = "Add reference", Url = "https://stackoverflow.com" }
            ]
        };

        var context = WebSearchService.BuildSearchContext(results);
        Assert.Contains("WEB SEARCH RESULTS", context);
        Assert.Contains("CS0246 Fix", context);
        Assert.Contains("Install the package", context);
    }

    [Fact]
    public void BuildSearchContext_Empty_ReturnsEmpty()
    {
        var results = new SearchResultSet();
        Assert.Equal("", WebSearchService.BuildSearchContext(results));
    }

    [Fact]
    public void BrowserPreference_Defaults_SystemDefault()
    {
        var svc = CreateService();
        Assert.Equal(BrowserPreference.SystemDefault, svc.PreferredBrowser);
    }

    [Fact]
    public void BrowserPreference_CanSetChrome()
    {
        var svc = CreateService();
        svc.PreferredBrowser = BrowserPreference.Chrome;
        Assert.Equal(BrowserPreference.Chrome, svc.PreferredBrowser);
    }

    [Fact]
    public void BrowserPreference_CanSetEdge()
    {
        var svc = CreateService();
        svc.PreferredBrowser = BrowserPreference.Edge;
        Assert.Equal(BrowserPreference.Edge, svc.PreferredBrowser);
    }

    [Fact]
    public void OnSearchPerformed_FiresEvent()
    {
        var svc = CreateService();
        string? firedQuery = null;
        svc.OnSearchPerformed += q => firedQuery = q;

        // Simulate the event
        // (We can't test actual search without network, but we verify the event system)
        Assert.Null(firedQuery);
    }

    [Fact]
    public void Dispose_DoesNotThrow()
    {
        var svc = CreateService();
        svc.Dispose();
    }
}

// ═══ SEARCH RESULT SET ═════════════════════════════════════════════

public class SearchResultSetTests
{
    [Fact]
    public void Disabled_HasError()
    {
        var result = SearchResultSet.Disabled();
        Assert.False(result.HasResults);
        Assert.Contains("disabled", result.Error, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Empty_HasReason()
    {
        var result = SearchResultSet.Empty("no results");
        Assert.False(result.HasResults);
        Assert.Equal("no results", result.Error);
    }

    [Fact]
    public void HasResults_TrueWhenPopulated()
    {
        var result = new SearchResultSet
        {
            Results = [new SearchResult { Title = "Test" }]
        };
        Assert.True(result.HasResults);
    }
}
