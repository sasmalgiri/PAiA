import { describe, expect, it } from 'vitest';
import { extractReadableText } from './html';

describe('extractReadableText', () => {
  it('strips scripts and styles', () => {
    const html = `
      <html>
        <head><style>body { color: red; }</style></head>
        <body>
          <script>alert('x')</script>
          <p>Hello world.</p>
        </body>
      </html>
    `;
    const out = extractReadableText(html);
    expect(out).toContain('Hello world.');
    expect(out).not.toContain('alert');
    expect(out).not.toContain('color: red');
  });

  it('strips nav / header / footer', () => {
    const html = `
      <nav>menu</nav>
      <header>banner</header>
      <main><p>Actual content.</p></main>
      <footer>©</footer>
    `;
    const out = extractReadableText(html);
    expect(out).toContain('Actual content.');
    expect(out).not.toContain('menu');
    expect(out).not.toContain('banner');
    expect(out).not.toContain('©');
  });

  it('decodes common entities', () => {
    const html = '<p>AT&amp;T &lt;Co.&gt; &quot;quoted&quot;</p>';
    expect(extractReadableText(html)).toBe('AT&T <Co.> "quoted"');
  });

  it('collapses whitespace', () => {
    const html = '<p>a\n\n   b\t\tc</p>';
    expect(extractReadableText(html)).toBe('a b c');
  });
});
