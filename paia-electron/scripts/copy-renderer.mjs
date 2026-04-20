// Copies static renderer assets (HTML, CSS) into dist/renderer/ alongside
// the bundled renderer.js. esbuild handles the JS/TSX; we keep the
// hand-written HTML and CSS as static files.

import { mkdir, copyFile, readdir, cp, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const srcDir = join(projectRoot, 'src', 'renderer');
const outDir = join(projectRoot, 'dist', 'renderer');

await mkdir(outDir, { recursive: true });

// Copy top-level static files (.html, .css)
const entries = await readdir(srcDir, { withFileTypes: true });
for (const entry of entries) {
  if (!entry.isFile()) continue;
  const ext = extname(entry.name).toLowerCase();
  if (ext === '.html' || ext === '.css') {
    await copyFile(join(srcDir, entry.name), join(outDir, entry.name));
    console.log(`copied renderer/${entry.name}`);
  }
}

// Copy sql.js wasm into dist/main so the database service can locate it
// at runtime via path.join(__dirname, 'sql-wasm.wasm').
const sqlWasmSrc = join(projectRoot, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
const sqlWasmDst = join(projectRoot, 'dist', 'main', 'sql-wasm.wasm');
if (existsSync(sqlWasmSrc)) {
  await mkdir(dirname(sqlWasmDst), { recursive: true });
  await copyFile(sqlWasmSrc, sqlWasmDst);
  console.log('copied sql-wasm.wasm');
}

// Ship the KaTeX stylesheet + font files alongside the renderer so LaTeX
// math rendering works without a network round-trip. The main app CSP
// restricts font-src to 'self' + data:, so self-hosting is mandatory.
const katexCssSrc = join(projectRoot, 'node_modules', 'katex', 'dist', 'katex.min.css');
const katexCssDst = join(outDir, 'katex.min.css');
if (existsSync(katexCssSrc)) {
  await copyFile(katexCssSrc, katexCssDst);
  console.log('copied katex.min.css');
  const fontsSrc = join(projectRoot, 'node_modules', 'katex', 'dist', 'fonts');
  const fontsDst = join(outDir, 'fonts');
  if (existsSync(fontsSrc)) {
    await cp(fontsSrc, fontsDst, { recursive: true });
    console.log('copied katex fonts');
  }
}
