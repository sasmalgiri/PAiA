// Bundles the React renderer with esbuild.
//
// We produce one IIFE bundle (renderer.js) loaded as a plain <script> tag,
// matching the rest of our build (no module loader needed in the page).
// CSS is bundled to renderer.css alongside it.

import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const outDir = join(projectRoot, 'dist', 'renderer');

await mkdir(outDir, { recursive: true });

// Two entry points: the React app (index.tsx → renderer.js) and the
// standalone region selector overlay (region.ts → region.js). They are
// kept separate so the overlay loads instantly without React.
const result = await build({
  entryPoints: [
    join(projectRoot, 'src', 'renderer', 'index.tsx'),
    join(projectRoot, 'src', 'renderer', 'region.ts'),
    join(projectRoot, 'src', 'renderer', 'detached.tsx'),
  ],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome120'],
  outdir: outDir,
  jsx: 'automatic',
  jsxDev: false,
  loader: {
    '.png': 'dataurl',
    '.svg': 'dataurl',
    '.woff2': 'dataurl',
  },
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  sourcemap: true,
  logLevel: 'info',
  metafile: false,
  minify: false,
  treeShaking: true,
});

if (result.errors.length > 0) {
  console.error('Renderer build had errors:', result.errors);
  process.exit(1);
}
console.log('Renderer bundles written to', outDir);
