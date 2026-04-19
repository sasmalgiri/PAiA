// Pure DuckDuckGo HTML results parser. Extracted from src/main/webSearch.ts
// so it can be unit-tested without booting Electron.
//
// The parser is a few targeted regex passes against DDG's lite results
// page. It does NOT use cheerio/jsdom — keeps the bundle lean and is
// fast enough for the ~50 KB pages DDG returns.

import type { WebSearchResult } from './types';

/**
 * Parse the HTML of a DuckDuckGo lite results page into structured
 * results. Returns at most `limit` items. Returns [] if the layout
 * doesn't match — caller should treat empty results as a soft failure.
 */
export function parseDuckDuckGoHtml(html: string, limit: number): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const blockRe = /<div[^>]*class="[^"]*\bresult\b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div[^>]*class="clear"/g;

  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(html)) !== null && results.length < limit) {
    const block = match[1];
    const titleMatch = block.match(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    const snippetMatch = block.match(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    if (!titleMatch) continue;
    results.push({
      url: cleanUrl(decodeHtml(titleMatch[1])),
      title: stripTags(decodeHtml(titleMatch[2])).trim(),
      snippet: snippetMatch ? stripTags(decodeHtml(snippetMatch[1])).trim() : '',
    });
  }

  if (results.length === 0) {
    // Fallback parser: just grab every result link.
    const linkRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
    while ((match = linkRe.exec(html)) !== null && results.length < limit) {
      results.push({
        url: cleanUrl(decodeHtml(match[1])),
        title: stripTags(decodeHtml(match[2])).trim(),
        snippet: '',
      });
    }
  }

  return results;
}

/** DDG sometimes returns redirector links like /l/?uddg=ENCODED. Unwrap them. */
export function cleanUrl(href: string): string {
  if (href.startsWith('//')) href = 'https:' + href;
  try {
    const u = new URL(href, 'https://duckduckgo.com');
    if (u.pathname === '/l/' || u.pathname === '//duckduckgo.com/l/') {
      const target = u.searchParams.get('uddg');
      if (target) return decodeURIComponent(target);
    }
    return u.toString();
  } catch {
    return href;
  }
}

export function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, '');
}

export function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([\da-f]+);/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}
