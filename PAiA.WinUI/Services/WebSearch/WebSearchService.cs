using System.Net.Http;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Web;

namespace PAiA.WinUI.Services.WebSearch;

/// <summary>
/// Provides web search and page fetching for PAiA.
/// 
/// DESIGN PRINCIPLES:
/// - OFF by default. User explicitly enables in Settings.
/// - Only SANITIZED search queries go online (PII stripped).
/// - Screen content, OCR text, chat history NEVER go online.
/// - Every outgoing request is logged in the audit trail.
/// - User sees "🌐 Searched: ..." for every online request.
/// - Uses DuckDuckGo (no tracking, no API key needed).
/// - Can open results in Chrome or Edge (user's choice).
/// 
/// WHAT GOES ONLINE:
/// - Search queries like "fix error CS0246 WinUI 3"
/// - URL fetches for documentation pages
/// 
/// WHAT NEVER GOES ONLINE:
/// - Screenshot data, OCR text, UI Automation tree
/// - User's typed questions (verbatim)
/// - Any PII (redaction runs before query generation)
/// - Chat history or response history
/// </summary>
public sealed class WebSearchService : IDisposable
{
    private readonly HttpClient _http;
    private readonly SearchQuerySanitizer _sanitizer;
    private readonly List<SearchAuditEntry> _auditLog = [];
    private bool _disposed;

    /// <summary>
    /// Master switch — OFF by default. User must explicitly enable.
    /// </summary>
    public bool IsEnabled { get; set; }

    /// <summary>
    /// User's preferred browser for opening links.
    /// </summary>
    public BrowserPreference PreferredBrowser { get; set; } = BrowserPreference.SystemDefault;

    /// <summary>
    /// Audit trail of every outgoing request.
    /// </summary>
    public IReadOnlyList<SearchAuditEntry> AuditLog => _auditLog;

    /// <summary>
    /// Fires when an online request is made (for UI indicator).
    /// </summary>
    public event Action<string>? OnSearchPerformed;

    public WebSearchService(SearchQuerySanitizer sanitizer)
    {
        _sanitizer = sanitizer;
        _http = new HttpClient
        {
            Timeout = TimeSpan.FromSeconds(15),
            DefaultRequestHeaders =
            {
                { "User-Agent", "PAiA/1.0 (Privacy-first screen assistant)" }
            }
        };
    }

    // ═══ SEARCH ════════════════════════════════════════════════════

    /// <summary>
    /// Searches DuckDuckGo with a sanitized query.
    /// Returns parsed results (title + snippet + URL).
    /// </summary>
    public async Task<SearchResultSet> SearchAsync(string rawQuery, int maxResults = 5, CancellationToken ct = default)
    {
        if (!IsEnabled)
            return SearchResultSet.Disabled();

        // Sanitize the query — strip all PII before it goes online
        var sanitized = _sanitizer.Sanitize(rawQuery);

        if (string.IsNullOrWhiteSpace(sanitized.Sanitized))
            return SearchResultSet.Empty("Query was empty after PII removal");

        // Log the outgoing request
        var auditEntry = new SearchAuditEntry
        {
            Timestamp = DateTimeOffset.Now,
            OriginalQuery = sanitized.WasModified ? "[PII removed]" : rawQuery,
            SanitizedQuery = sanitized.Sanitized,
            PiiItemsRemoved = sanitized.ItemsRemoved,
            Source = "DuckDuckGo"
        };

        try
        {
            // DuckDuckGo HTML search (no API key needed)
            var encoded = HttpUtility.UrlEncode(sanitized.Sanitized);
            var url = $"https://html.duckduckgo.com/html/?q={encoded}";

            var response = await _http.GetStringAsync(url, ct);
            var results = ParseDuckDuckGoHtml(response, maxResults);

            auditEntry.ResultCount = results.Count;
            auditEntry.Success = true;
            _auditLog.Add(auditEntry);

            OnSearchPerformed?.Invoke(sanitized.Sanitized);

            return new SearchResultSet
            {
                Query = sanitized.Sanitized,
                Results = results,
                Source = "DuckDuckGo",
                PiiStripped = sanitized.ItemsRemoved
            };
        }
        catch (Exception ex)
        {
            auditEntry.Success = false;
            auditEntry.Error = ex.Message;
            _auditLog.Add(auditEntry);

            return SearchResultSet.Empty($"Search failed: {ex.Message}");
        }
    }

    // ═══ PAGE FETCH ════════════════════════════════════════════════

    /// <summary>
    /// Fetches a web page and extracts readable text.
    /// For feeding documentation/Stack Overflow content to the LLM.
    /// </summary>
    public async Task<WebPageContent> FetchPageAsync(string url, CancellationToken ct = default)
    {
        if (!IsEnabled)
            return new WebPageContent { Success = false, Error = "Online search is disabled" };

        // Log the outgoing request
        var auditEntry = new SearchAuditEntry
        {
            Timestamp = DateTimeOffset.Now,
            SanitizedQuery = url,
            Source = "PageFetch"
        };

        try
        {
            var response = await _http.GetStringAsync(url, ct);

            // Strip HTML tags, scripts, styles — extract text only
            var text = StripHtml(response);

            // Truncate to prevent overwhelming the LLM
            if (text.Length > 8000)
                text = text[..8000] + "\n\n[Truncated — page content too long]";

            auditEntry.Success = true;
            _auditLog.Add(auditEntry);

            OnSearchPerformed?.Invoke($"Fetched: {TruncateUrl(url)}");

            return new WebPageContent
            {
                Url = url,
                Text = text,
                Success = true,
                FetchedAt = DateTimeOffset.Now
            };
        }
        catch (Exception ex)
        {
            auditEntry.Success = false;
            auditEntry.Error = ex.Message;
            _auditLog.Add(auditEntry);

            return new WebPageContent { Url = url, Success = false, Error = ex.Message };
        }
    }

    // ═══ BROWSER INTEGRATION ═══════════════════════════════════════

    /// <summary>
    /// Opens a URL in the user's preferred browser.
    /// </summary>
    public void OpenInBrowser(string url)
    {
        var browserPath = PreferredBrowser switch
        {
            BrowserPreference.Chrome => FindBrowser("chrome.exe",
                @"C:\Program Files\Google\Chrome\Application\chrome.exe",
                @"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
            BrowserPreference.Edge => FindBrowser("msedge.exe",
                @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                @"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
            BrowserPreference.Firefox => FindBrowser("firefox.exe",
                @"C:\Program Files\Mozilla Firefox\firefox.exe",
                @"C:\Program Files (x86)\Mozilla Firefox\firefox.exe"),
            BrowserPreference.Brave => FindBrowser("brave.exe",
                @"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe",
                @"C:\Program Files (x86)\BraveSoftware\Brave-Browser\Application\brave.exe"),
            _ => null // System default
        };

        var psi = new System.Diagnostics.ProcessStartInfo
        {
            UseShellExecute = true
        };

        if (browserPath is not null)
        {
            psi.FileName = browserPath;
            psi.Arguments = url;
        }
        else
        {
            // System default browser
            psi.FileName = url;
        }

        System.Diagnostics.Process.Start(psi);

        _auditLog.Add(new SearchAuditEntry
        {
            Timestamp = DateTimeOffset.Now,
            SanitizedQuery = $"Opened in browser: {TruncateUrl(url)}",
            Source = PreferredBrowser.ToString(),
            Success = true
        });
    }

    /// <summary>
    /// Searches in the user's preferred browser directly.
    /// Opens a new tab with search results.
    /// </summary>
    public void SearchInBrowser(string rawQuery)
    {
        var sanitized = _sanitizer.Sanitize(rawQuery);
        var encoded = HttpUtility.UrlEncode(sanitized.Sanitized);

        // Use DuckDuckGo in browser too (privacy-consistent)
        var searchUrl = $"https://duckduckgo.com/?q={encoded}";
        OpenInBrowser(searchUrl);
    }

    // ═══ LLM INTEGRATION ═══════════════════════════════════════════

    /// <summary>
    /// Builds a context block from search results for the LLM.
    /// The LLM gets search snippets to answer with fresh information.
    /// </summary>
    public static string BuildSearchContext(SearchResultSet results)
    {
        if (results.Results.Count == 0)
            return "";

        var sb = new System.Text.StringBuilder();
        sb.AppendLine("=== WEB SEARCH RESULTS (for reference) ===");
        sb.AppendLine($"Query: {results.Query}");
        sb.AppendLine();

        foreach (var r in results.Results)
        {
            sb.AppendLine($"[{r.Title}]");
            sb.AppendLine(r.Snippet);
            sb.AppendLine($"Source: {r.Url}");
            sb.AppendLine();
        }

        sb.AppendLine("=== END SEARCH RESULTS ===");
        sb.AppendLine("Use the above search results to provide an up-to-date answer.");
        return sb.ToString();
    }

    // ═══ SETTINGS ══════════════════════════════════════════════════

    /// <summary>
    /// Gets the current online search status for the privacy pulse bar.
    /// </summary>
    public string GetPrivacyStatus()
    {
        if (!IsEnabled)
            return "Network: isolated ✓";

        var recentCount = _auditLog.Count(e =>
            e.Timestamp > DateTimeOffset.Now.AddHours(-1));

        return $"Network: search enabled 🌐 ({recentCount} queries this hour)";
    }

    /// <summary>
    /// Clears the search audit log.
    /// </summary>
    public void ClearAuditLog() => _auditLog.Clear();

    /// <summary>
    /// Gets search statistics for the transparency report.
    /// </summary>
    public SearchStats GetStats() => new()
    {
        TotalSearches = _auditLog.Count(e => e.Source == "DuckDuckGo"),
        TotalPageFetches = _auditLog.Count(e => e.Source == "PageFetch"),
        TotalBrowserOpens = _auditLog.Count(e => e.Source != "DuckDuckGo" && e.Source != "PageFetch"),
        TotalPiiItemsStripped = _auditLog.Sum(e => e.PiiItemsRemoved),
        IsEnabled = IsEnabled
    };

    // ═══ HELPERS ═══════════════════════════════════════════════════

    /// <summary>
    /// Parses DuckDuckGo HTML search results.
    /// </summary>
    private static List<SearchResult> ParseDuckDuckGoHtml(string html, int maxResults)
    {
        var results = new List<SearchResult>();

        // DuckDuckGo HTML results are in <a class="result__a"> tags
        var titlePattern = new Regex(
            @"<a[^>]*class=""result__a""[^>]*href=""([^""]*?)""[^>]*>(.*?)</a>",
            RegexOptions.Singleline);
        var snippetPattern = new Regex(
            @"<a[^>]*class=""result__snippet""[^>]*>(.*?)</a>",
            RegexOptions.Singleline);

        var titles = titlePattern.Matches(html);
        var snippets = snippetPattern.Matches(html);

        for (int i = 0; i < Math.Min(titles.Count, maxResults); i++)
        {
            var url = titles[i].Groups[1].Value;
            // DuckDuckGo wraps URLs in a redirect — extract the real URL
            if (url.Contains("uddg="))
            {
                var uddgMatch = Regex.Match(url, @"uddg=([^&]+)");
                if (uddgMatch.Success)
                    url = HttpUtility.UrlDecode(uddgMatch.Groups[1].Value);
            }

            results.Add(new SearchResult
            {
                Title = StripHtmlTags(titles[i].Groups[2].Value),
                Url = url,
                Snippet = i < snippets.Count
                    ? StripHtmlTags(snippets[i].Groups[1].Value)
                    : ""
            });
        }

        return results;
    }

    private static string StripHtml(string html)
    {
        // Remove script and style blocks
        var noScript = Regex.Replace(html, @"<script[^>]*>.*?</script>", "", RegexOptions.Singleline);
        var noStyle = Regex.Replace(noScript, @"<style[^>]*>.*?</style>", "", RegexOptions.Singleline);
        // Remove HTML tags
        var text = StripHtmlTags(noStyle);
        // Decode entities
        text = HttpUtility.HtmlDecode(text);
        // Collapse whitespace
        text = Regex.Replace(text, @"\s+", " ").Trim();
        // Restore paragraph breaks
        text = Regex.Replace(text, @"\s*\.\s+", ".\n");
        return text;
    }

    private static string StripHtmlTags(string html) =>
        Regex.Replace(html, @"<[^>]+>", "").Trim();

    private static string TruncateUrl(string url) =>
        url.Length > 80 ? url[..80] + "..." : url;

    private static string? FindBrowser(string exeName, params string[] knownPaths)
    {
        // Check known install paths
        foreach (var path in knownPaths)
            if (File.Exists(path)) return path;

        // Check PATH
        var pathDirs = Environment.GetEnvironmentVariable("PATH")?.Split(Path.PathSeparator) ?? [];
        foreach (var dir in pathDirs)
        {
            var full = Path.Combine(dir, exeName);
            if (File.Exists(full)) return full;
        }

        return null;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _http.Dispose();
    }
}

// ═══ Models ═══════════════════════════════════════════════════════

public sealed class SearchResultSet
{
    public string Query { get; set; } = "";
    public List<SearchResult> Results { get; set; } = [];
    public string Source { get; set; } = "";
    public int PiiStripped { get; set; }
    public string? Error { get; set; }

    public bool HasResults => Results.Count > 0;

    public static SearchResultSet Disabled() => new()
        { Error = "Online search is disabled. Enable in Settings." };
    public static SearchResultSet Empty(string reason) => new()
        { Error = reason };
}

public sealed class SearchResult
{
    public string Title { get; set; } = "";
    public string Snippet { get; set; } = "";
    public string Url { get; set; } = "";
}

public sealed class WebPageContent
{
    public string Url { get; set; } = "";
    public string Text { get; set; } = "";
    public bool Success { get; set; }
    public string? Error { get; set; }
    public DateTimeOffset FetchedAt { get; set; }
}

public sealed class SearchAuditEntry
{
    public DateTimeOffset Timestamp { get; set; }
    public string OriginalQuery { get; set; } = "";
    public string SanitizedQuery { get; set; } = "";
    public int PiiItemsRemoved { get; set; }
    public string Source { get; set; } = "";
    public int ResultCount { get; set; }
    public bool Success { get; set; }
    public string? Error { get; set; }
}

public sealed class SearchStats
{
    public int TotalSearches { get; set; }
    public int TotalPageFetches { get; set; }
    public int TotalBrowserOpens { get; set; }
    public int TotalPiiItemsStripped { get; set; }
    public bool IsEnabled { get; set; }
}

public enum BrowserPreference
{
    SystemDefault,
    Chrome,
    Edge,
    Firefox,
    Brave
}
