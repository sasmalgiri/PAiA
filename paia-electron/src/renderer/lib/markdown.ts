// Markdown rendering with code-block syntax highlighting, LaTeX math,
// Mermaid diagrams, and chemical-structure rendering from SMILES codes.
//
// Math runs synchronously at parse-time via KaTeX.
// Mermaid and SMILES need DOM access, so we only mark them here and a
// post-mount pass (see `renderDiagramsInside`) swaps in the real SVG.
//
// Output is a plain HTML string set via dangerouslySetInnerHTML. `marked`
// escapes raw HTML; the renderer's CSP disallows inline scripts.

import { Marked, type Tokens } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js/lib/common';
import katex from 'katex';

export const marked = new Marked(
  markedHighlight({
    emptyLangClass: 'hljs',
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      if (lang === 'mermaid' || lang === 'smiles' || lang === 'chem' || lang === 'math') {
        return code; // these are handled as diagram placeholders below.
      }
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

// ─── Diagram / math placeholder extensions ────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// PAiA sets data-theme="light"|"dark" on <html> for explicit themes, and
// removes the attribute entirely in "system" mode. Detect accordingly.
function isLightMode(): boolean {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'light') return true;
  if (attr === 'dark') return false;
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-color-scheme: light)').matches === true;
}

function renderMath(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      strict: 'ignore',
      output: 'html',
    });
  } catch (err) {
    // Fall back to a visible placeholder so the user can see what went wrong.
    const msg = err instanceof Error ? err.message : String(err);
    return `<code class="math-error" title="${escapeHtml(msg)}">${escapeHtml(latex)}</code>`;
  }
}

// Custom renderer: replace fenced code blocks tagged `mermaid` / `smiles` /
// `math` with special placeholders. For every other language, delegate back
// to marked-highlight's default so normal code still gets syntax coloring.
marked.use({
  renderer: {
    code(this: { parser?: { options?: unknown } } | unknown, token: Tokens.Code): string {
      const lang = (token.lang ?? '').trim().toLowerCase();
      const raw = token.text;
      if (lang === 'mermaid') {
        return `<div class="mermaid-src" data-source="${escapeHtml(raw)}"><pre class="mermaid-fallback"><code>${escapeHtml(raw)}</code></pre></div>`;
      }
      if (lang === 'smiles' || lang === 'chem') {
        return `<div class="smiles-src" data-source="${escapeHtml(raw)}"><code class="smiles-fallback">${escapeHtml(raw)}</code></div>`;
      }
      if (lang === 'math' || lang === 'latex') {
        return `<div class="math-block">${renderMath(raw, true)}</div>`;
      }
      // Default path — replicate marked-highlight's output shape: a <pre>
      // wrapping a <code> with `hljs language-XXX` so our CSS picks it up.
      // The `highlight()` callback at the top of the file already produced
      // the highlighted HTML fragment when marked ran the tokenizer.
      const cls = lang ? `hljs language-${escapeHtml(lang)}` : 'hljs';
      return `<pre><code class="${cls}">${token.escaped ? raw : escapeHtml(raw)}</code></pre>`;
    },
  },
});

// Inline + block math via $...$ / $$...$$. Handled as a pre-parse pass
// rather than a marked tokenizer because LaTeX happily contains underscores,
// asterisks, and backslashes that confuse the markdown inline lexer.
function protectMath(text: string): { out: string; restore: (html: string) => string } {
  const slots: string[] = [];
  const seal = (html: string): string => {
    const i = slots.length;
    slots.push(html);
    return `\u0000MATH${i}\u0000`;
  };
  // Display math: $$...$$ (non-greedy, allow newlines).
  let out = text.replace(/\$\$([\s\S]+?)\$\$/g, (_m, body: string) =>
    seal(`<div class="math-block">${renderMath(body.trim(), true)}</div>`),
  );
  // Inline math: $...$ on one line. Skip escaped \$ and price-looking $5.
  out = out.replace(/(^|[^\\$])\$([^\n$]+?)\$(?!\d)/g, (_m, pre: string, body: string) =>
    pre + seal(`<span class="math-inline">${renderMath(body.trim(), false)}</span>`),
  );
  return {
    out,
    restore: (html: string) => html.replace(/\u0000MATH(\d+)\u0000/g, (_m, i: string) => slots[+i] ?? ''),
  };
}

export function renderMarkdown(text: string): string {
  if (!text) return '';
  try {
    const { out, restore } = protectMath(text);
    const html = marked.parse(out) as string;
    return restore(html);
  } catch {
    // On parse failure (e.g. mid-stream malformed token), fall back to text.
    const escaped = escapeHtml(text);
    return `<p>${escaped}</p>`;
  }
}

// ─── Post-mount rendering ─────────────────────────────────────────
//
// Mermaid + SMILES both need a real DOM to run. Callers should invoke this
// once they've injected the HTML into the document.

let mermaidInitPromise: Promise<void> | null = null;
let mermaidCounter = 0;

async function ensureMermaid(): Promise<typeof import('mermaid').default> {
  const mod = await import('mermaid');
  if (!mermaidInitPromise) {
    mermaidInitPromise = Promise.resolve().then(() => {
      mod.default.initialize({
        startOnLoad: false,
        theme: isLightMode() ? 'neutral' : 'dark',
        securityLevel: 'strict',
        fontFamily: 'inherit',
      });
    });
  }
  await mermaidInitPromise;
  return mod.default;
}

async function ensureSmiles(): Promise<typeof import('smiles-drawer')> {
  return import('smiles-drawer');
}

function parseSmilesAsync(sd: typeof import('smiles-drawer'), src: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    try {
      // smiles-drawer's parse is callback-style. Wrap into a promise so we
      // can await alongside mermaid rendering.
      sd.parse(src, (tree) => resolve(tree), (err) => reject(err));
    } catch (err) {
      reject(err);
    }
  });
}

export async function renderDiagramsInside(root: HTMLElement): Promise<void> {
  const mermaidBlocks = root.querySelectorAll<HTMLElement>('.mermaid-src:not(.rendered)');
  if (mermaidBlocks.length > 0) {
    const mermaid = await ensureMermaid();
    for (const block of Array.from(mermaidBlocks)) {
      const src = block.getAttribute('data-source') ?? '';
      const id = `mmd-${++mermaidCounter}`;
      try {
        const { svg } = await mermaid.render(id, src);
        block.innerHTML = svg;
        block.classList.add('rendered');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        block.innerHTML = `<div class="diagram-error" title="${escapeHtml(msg)}">Mermaid error: ${escapeHtml(msg.split('\n')[0])}</div><pre class="mermaid-fallback"><code>${escapeHtml(src)}</code></pre>`;
        block.classList.add('rendered');
      }
    }
  }

  const smilesBlocks = root.querySelectorAll<HTMLElement>('.smiles-src:not(.rendered)');
  if (smilesBlocks.length > 0) {
    try {
      const sd = await ensureSmiles();
      const theme = isLightMode() ? 'light' : 'dark';
      for (const block of Array.from(smilesBlocks)) {
        const src = (block.getAttribute('data-source') ?? '').trim();
        try {
          const tree = await parseSmilesAsync(sd, src);
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('class', 'smiles-svg');
          svg.setAttribute('width', '260');
          svg.setAttribute('height', '180');
          block.replaceChildren(svg);
          const drawer = new sd.SvgDrawer({ width: 260, height: 180 });
          drawer.draw(tree, svg, theme);
          block.classList.add('rendered');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          block.innerHTML = `<div class="diagram-error" title="${escapeHtml(msg)}">SMILES error: ${escapeHtml(msg.split('\n')[0])}</div><code class="smiles-fallback">${escapeHtml(src)}</code>`;
          block.classList.add('rendered');
        }
      }
    } catch (err) {
      // smiles-drawer failed to load — leave the fallback code block visible.
      console.warn('[markdown] SMILES drawer unavailable:', err);
    }
  }
}
