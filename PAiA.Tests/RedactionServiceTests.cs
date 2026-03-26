using PAiA.WinUI.Services.Redaction;
using Xunit;

namespace PAiA.Tests;

/// <summary>
/// Tests for RedactionService — the most critical security component.
/// A missed PII item is a privacy incident. These tests must ALL pass.
/// </summary>
public class RedactionServiceTests
{
    private readonly RedactionService _svc = new();

    // ═══ CREDIT CARDS ══════════════════════════════════════════════

    [Theory]
    [InlineData("4532015112830366")]                    // Visa no spaces
    [InlineData("4532 0151 1283 0366")]                 // Visa with spaces
    [InlineData("4532-0151-1283-0366")]                 // Visa with dashes
    [InlineData("5425233430109903")]                    // Mastercard
    [InlineData("374245455400126")]                     // Amex (15 digits)
    [InlineData("6011000990139424")]                    // Discover
    public void Redacts_CreditCards(string card)
    {
        var input = $"Pay with card {card} please";
        var result = _svc.Redact(input);
        Assert.DoesNotContain(card, result);
        Assert.Contains("[CARD-REDACTED]", result);
    }

    [Theory]
    [InlineData("Card: 4532015112830366 is expired")]
    [InlineData("Use 5425 2334 3010 9903 for payment")]
    public void Redacts_CardsInContext(string input)
    {
        var result = _svc.Redact(input);
        Assert.Contains("[CARD-REDACTED]", result);
    }

    // ═══ SSN ═══════════════════════════════════════════════════════

    [Theory]
    [InlineData("123-45-6789")]
    [InlineData("000-12-3456")]
    [InlineData("999-99-9999")]
    public void Redacts_SSN(string ssn)
    {
        var input = $"SSN is {ssn}";
        var result = _svc.Redact(input);
        Assert.DoesNotContain(ssn, result);
        Assert.Contains("[SSN-REDACTED]", result);
    }

    // ═══ EMAIL ═════════════════════════════════════════════════════

    [Theory]
    [InlineData("user@example.com")]
    [InlineData("first.last@company.co.uk")]
    [InlineData("name+tag@gmail.com")]
    [InlineData("admin@sub.domain.org")]
    [InlineData("user123@test-domain.com")]
    public void Redacts_Emails(string email)
    {
        var input = $"Contact: {email}";
        var result = _svc.Redact(input);
        Assert.DoesNotContain(email, result);
        Assert.Contains("[EMAIL-REDACTED]", result);
    }

    // ═══ PHONE ═════════════════════════════════════════════════════

    [Theory]
    [InlineData("(555) 123-4567")]
    [InlineData("555-123-4567")]
    [InlineData("555.123.4567")]
    [InlineData("+1-555-123-4567")]
    [InlineData("1 (555) 123-4567")]
    public void Redacts_PhoneNumbers(string phone)
    {
        var input = $"Call me at {phone}";
        var result = _svc.Redact(input);
        Assert.Contains("[PHONE-REDACTED]", result);
    }

    // ═══ IP ADDRESSES ══════════════════════════════════════════════

    [Theory]
    [InlineData("192.168.1.1")]
    [InlineData("10.0.0.1")]
    [InlineData("172.16.0.100")]
    [InlineData("8.8.8.8")]
    public void Redacts_IpAddresses(string ip)
    {
        var input = $"Server at {ip} is down";
        var result = _svc.Redact(input);
        Assert.DoesNotContain(ip, result);
        Assert.Contains("[IP-REDACTED]", result);
    }

    // ═══ AWS KEYS ══════════════════════════════════════════════════

    [Fact]
    public void Redacts_AwsKeys()
    {
        var input = "AWS_KEY=AKIAIOSFODNN7EXAMPLE";
        var result = _svc.Redact(input);
        Assert.DoesNotContain("AKIAIOSFODNN7EXAMPLE", result);
        Assert.Contains("[AWS-KEY-REDACTED]", result);
    }

    // ═══ GITHUB TOKENS ═════════════════════════════════════════════

    [Theory]
    [InlineData("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklm")]
    [InlineData("ghs_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklm")]
    public void Redacts_GithubTokens(string token)
    {
        var input = $"Token: {token}";
        var result = _svc.Redact(input);
        Assert.DoesNotContain(token, result);
        Assert.Contains("[GITHUB-TOKEN-REDACTED]", result);
    }

    // ═══ API KEYS ══════════════════════════════════════════════════

    [Theory]
    [InlineData("api_key=sk_live_abc123def456ghijklmnopqrst")]
    [InlineData("secret_key: abcdefghijklmnopqrstuvwxyz123456")]
    [InlineData("access_token=eyabc123def456ghijklmnop")]
    public void Redacts_ApiKeys(string key)
    {
        var result = _svc.Redact(key);
        Assert.Contains("[API-KEY-REDACTED]", result);
    }

    // ═══ JWT TOKENS ════════════════════════════════════════════════

    [Fact]
    public void Redacts_JwtTokens()
    {
        var jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
        var input = $"Bearer {jwt}";
        var result = _svc.Redact(input);
        Assert.DoesNotContain("eyJhbGci", result);
        Assert.Contains("[JWT-REDACTED]", result);
    }

    // ═══ PRIVATE KEYS ══════════════════════════════════════════════

    [Fact]
    public void Redacts_PrivateKeys()
    {
        var input = "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----";
        var result = _svc.Redact(input);
        Assert.DoesNotContain("PRIVATE KEY", result);
        Assert.Contains("[PRIVATE-KEY-REDACTED]", result);
    }

    // ═══ CONNECTION STRINGS ════════════════════════════════════════

    [Theory]
    [InlineData("Server=myserver;Database=mydb;Password=secret123")]
    [InlineData("Data Source=10.0.0.5;pwd=hunter2")]
    [InlineData("host=db.internal.com;password=abc123")]
    public void Redacts_ConnectionStrings(string connStr)
    {
        var result = _svc.Redact(connStr);
        Assert.Contains("[CONN-STRING-REDACTED]", result);
    }

    // ═══ MULTIPLE PII IN ONE STRING ════════════════════════════════

    [Fact]
    public void Redacts_MultiplePiiInOneString()
    {
        var input = "Name: John, Email: john@test.com, SSN: 123-45-6789, Card: 4532015112830366";
        var result = _svc.Redact(input);
        Assert.DoesNotContain("john@test.com", result);
        Assert.DoesNotContain("123-45-6789", result);
        Assert.DoesNotContain("4532015112830366", result);
        Assert.Contains("[EMAIL-REDACTED]", result);
        Assert.Contains("[SSN-REDACTED]", result);
        Assert.Contains("[CARD-REDACTED]", result);
    }

    // ═══ FALSE POSITIVES (should NOT redact) ═══════════════════════

    [Theory]
    [InlineData("The year 2024 was great")]
    [InlineData("Version 3.14.159")]
    [InlineData("Page 42 of 100")]
    [InlineData("Score: 95/100")]
    [InlineData("Temperature is 72.5 degrees")]
    [InlineData("Meeting at 2:30 PM")]
    [InlineData("Windows 10 build 19041")]
    public void DoesNotRedact_InnocentText(string input)
    {
        var result = _svc.Redact(input);
        Assert.Equal(input, result);
    }

    // ═══ EDGE CASES ════════════════════════════════════════════════

    [Fact]
    public void Handles_EmptyString() => Assert.Equal("", _svc.Redact(""));

    [Fact]
    public void Handles_NullString() => Assert.Null(_svc.Redact(null!));

    [Fact]
    public void Handles_WhitespaceOnly() => Assert.Equal("   ", _svc.Redact("   "));

    [Fact]
    public void CountMatches_ReturnsCorrectCount()
    {
        var input = "Email: a@b.com and 123-45-6789";
        var count = _svc.CountMatches(input);
        Assert.True(count >= 2, $"Expected at least 2 matches, got {count}");
    }

    [Fact]
    public void Preserves_SurroundingText()
    {
        var input = "Before john@test.com After";
        var result = _svc.Redact(input);
        Assert.StartsWith("Before ", result);
        Assert.EndsWith(" After", result);
    }
}
