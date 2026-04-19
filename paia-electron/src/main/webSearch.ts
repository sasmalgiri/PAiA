// Web search service.
//
// Backend: DuckDuckGo's HTML endpoint (html.duckduckgo.com/html). No key,
// no tracking, no JS execution required. We POST a form-encoded query
// and parse the resulting HTML for result titles, URLs, and snippets.
//
// Privacy notes:
//   - The user's query is PII-redacted before being sent.
//   - The query goes to DuckDuckGo over HTTPS. DDG promises not to log
//     personally identifiable info, but it is still a network call to
//     a third party. Users who need full local-only mode should not
//     enable this feature.
//   - Result snippets are returned to the LLM as context — they are
//     NOT redacted (they're public web text).

import { redact } from '../shared/redaction';
import { parseDuckDuckGoHtml } from '../shared/ddgParser';
import type { WebSearchResponse, WebSearchResult } from '../shared/types';
import { isFeatureEnabled } from './license';
import { logger } from './logger';

const DDG_HTML = 'https://html.duckduckgo.com/html/';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 PAiA/0.2';

export async function search(query: string, limit = 8): Promise<WebSearchResponse> {
  const start = Date.now();
  if (!query.trim()) {
    return { query, results: [], redactedCount: 0, durationMs: 0 };
  }
  if (!isFeatureEnabled('web-search')) {
    return {
      query,
      results: [],
      redactedCount: 0,
      durationMs: Date.now() - start,
      error: 'Web search requires PAiA Pro. Start a trial or activate a license.',
    };
  }

  const redacted = redact(query);
  const safeQuery = redacted.redacted;

  try {
    const body = new URLSearchParams({ q: safeQuery, kl: 'wt-wt' }).toString();
    const res = await fetch(DDG_HTML, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
        Accept: 'text/html',
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return {
        query: safeQuery,
        results: [],
        redactedCount: redacted.matchCount,
        durationMs: Date.now() - start,
        error: `HTTP ${res.status}`,
      };
    }
    const html = await res.text();
    const results = parseDuckDuckGoHtml(html, limit);
    return {
      query: safeQuery,
      results,
      redactedCount: redacted.matchCount,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    logger.warn('web search failed', err);
    return {
      query: safeQuery,
      results: [],
      redactedCount: redacted.matchCount,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Format a search response as a context block to inject into the LLM
 * system prompt. Used by the /search slash command path.
 */
export function formatResultsForPrompt(query: string, results: WebSearchResult[]): string {
  if (results.length === 0) return `(web search for "${query}" returned no results)`;
  const blocks = results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`);
  return [
    `Web search results for "${query}":`,
    '',
    ...blocks,
    '',
    'Cite sources by their bracket number.',
  ].join('\n');
}
