import { describe, expect, it } from 'vitest';
import { cleanUrl, decodeHtml, parseDuckDuckGoHtml, stripTags } from './ddgParser';

describe('parseDuckDuckGoHtml', () => {
  it('parses a typical results block', () => {
    const html = `
      <div class="result results_links results_links_deep web-result">
        <div class="result__title">
          <a class="result__a" href="//example.com/page">Example Title</a>
        </div>
        <a class="result__snippet">An example snippet here.</a>
      </div>
      <div class="clear"></div>
      <div class="result results_links results_links_deep web-result">
        <div class="result__title">
          <a class="result__a" href="https://other.example.org/x">Other Title</a>
        </div>
        <a class="result__snippet">Another snippet.</a>
      </div>
      <div class="clear"></div>
    `;
    const results = parseDuckDuckGoHtml(html, 10);
    expect(results.length).toBe(2);
    expect(results[0].title).toBe('Example Title');
    expect(results[0].url).toBe('https://example.com/page');
    expect(results[0].snippet).toBe('An example snippet here.');
    expect(results[1].url).toBe('https://other.example.org/x');
  });

  it('respects the limit', () => {
    const block = `
      <div class="result results_links results_links_deep web-result">
        <div class="result__title"><a class="result__a" href="//example.com">T</a></div>
        <a class="result__snippet">S</a>
      </div>
      <div class="clear"></div>
    `;
    const html = block.repeat(10);
    expect(parseDuckDuckGoHtml(html, 3).length).toBe(3);
  });

  it('returns empty array on unrelated HTML', () => {
    expect(parseDuckDuckGoHtml('<html><body>nothing</body></html>', 10)).toEqual([]);
  });

  it('falls back to extracting bare result__a links if blocks are missing', () => {
    const html = `
      <a class="result__a" href="https://x.example.com">Fallback Title</a>
    `;
    const results = parseDuckDuckGoHtml(html, 10);
    expect(results.length).toBe(1);
    expect(results[0].url).toBe('https://x.example.com/');
    expect(results[0].title).toBe('Fallback Title');
  });
});

describe('cleanUrl', () => {
  it('unwraps DDG redirector links', () => {
    const url = '//duckduckgo.com/l/?uddg=https%3A%2F%2Freal.example.com%2Fpath';
    expect(cleanUrl(url)).toBe('https://real.example.com/path');
  });

  it('passes through plain https URLs', () => {
    expect(cleanUrl('https://example.com/foo')).toBe('https://example.com/foo');
  });

  it('upgrades protocol-relative URLs to https', () => {
    expect(cleanUrl('//example.com/x')).toBe('https://example.com/x');
  });

  it('resolves relative paths against the duckduckgo base', () => {
    // Anything that the URL parser can handle gets canonicalised. This
    // is fine — DDG always emits well-formed hrefs in practice; the
    // try/catch is just defensive.
    expect(cleanUrl('not-a-url')).toContain('duckduckgo.com');
  });
});

describe('decodeHtml', () => {
  it('decodes named entities', () => {
    expect(decodeHtml('&amp;&lt;&gt;&quot;&#39;')).toBe(`&<>"'`);
  });
  it('decodes decimal numeric entities', () => {
    expect(decodeHtml('&#65;&#66;')).toBe('AB');
  });
  it('decodes hex numeric entities', () => {
    expect(decodeHtml('&#x41;&#x42;')).toBe('AB');
  });
});

describe('stripTags', () => {
  it('strips simple tags', () => {
    expect(stripTags('<b>hello</b> <i>world</i>')).toBe('hello world');
  });
  it('strips tags with attributes', () => {
    expect(stripTags('<a href="x">link</a>')).toBe('link');
  });
});
