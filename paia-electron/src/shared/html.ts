// Pure HTML-to-text helper used by the Agent's web.fetch tool and the
// Deep Research pipeline. Kept in `shared/` so it can be unit-tested
// without pulling in Electron or Node built-ins.

/**
 * Strip scripts, styles, nav chrome, and tags from an HTML blob and
 * return the readable plaintext that remains. Decodes a handful of
 * common entities and collapses whitespace.
 *
 * This is intentionally lightweight — good enough to hand the LLM
 * something to read. If you need a proper reader view (Reader-like
 * heuristics, main-content detection), wire in a dedicated library.
 */
export function extractReadableText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(nav|header|footer|aside|form|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/?[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
