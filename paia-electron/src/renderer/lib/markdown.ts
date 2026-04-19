// Markdown rendering with code-block syntax highlighting.
//
// We use `marked` for the parser and `highlight.js` for the syntax
// highlighter. Output is plain HTML strings, set into a div via
// dangerouslySetInnerHTML — sources are LLM output, but the renderer
// has a strict CSP that disallows inline scripts, and `marked` itself
// escapes raw HTML by default.

import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js/lib/common';

export const marked = new Marked(
  markedHighlight({
    emptyLangClass: 'hljs',
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      try {
        return hljs.highlight(code, { language }).value;
      } catch {
        return code;
      }
    },
  }),
);

marked.setOptions({
  gfm: true,
  breaks: true,
});

export function renderMarkdown(text: string): string {
  if (!text) return '';
  try {
    return marked.parse(text) as string;
  } catch {
    // On parse failure (e.g. mid-stream malformed token), fall back to text.
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<p>${escaped}</p>`;
  }
}
