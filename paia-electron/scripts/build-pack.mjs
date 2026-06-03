#!/usr/bin/env node
//
// PAiA knowledge stack pack builder.
//
// Reads a source directory layout and produces a signed .paia-pack file.
//
// Source layout:
//   <packRoot>/
//     manifest.json         (id, name, version, description, author, kind, requiresTier?, paiaMinVersion?, ollamaModels?)
//     README.md             (optional, shown in installer)
//     personas/             (optional, one .json per persona)
//     collections/          (optional)
//       <collectionId>/
//         meta.json         (name, description, embedModel)
//         documents/        (any number of .pdf/.md/.txt/etc.)
//     defaults.json         (optional settings deltas)
//
// Usage:
//   node scripts/build-pack.mjs \
//     --src ./packs/paia-legal \
//     --out ./dist/paia-legal-1.0.0.paia-pack \
//     --private ./.keys/private.b64

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { promisify } from 'node:util';

const gzip = promisify(zlib.gzip);

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

// Canonical JSON serialisation (must match src/shared/packFormat.ts canonicalize()).
function canonicalize(value) {
  if (value === null) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
  }
  return 'null';
}

function privateKeyFromB64(b64) {
  const der = Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    Buffer.from(b64, 'base64'),
  ]);
  return crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}

function readJsonOrDie(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (err) {
    console.error(`Failed to parse ${p}: ${err.message}`);
    process.exit(1);
  }
}

function listDir(dir, exts) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => d.name)
      .filter((n) => !exts || exts.some((e) => n.endsWith(e)));
  } catch {
    return [];
  }
}

const MIME_MAP = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.xml': 'application/xml',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
};

function mimeFor(filename) {
  const ext = path.extname(filename).toLowerCase();
  return MIME_MAP[ext] ?? 'application/octet-stream';
}

const args = parseArgs(process.argv);
if (!args.src || !args.out || !args.private) {
  console.error('Usage: build-pack.mjs --src <packDir> --out <output.paia-pack> --private <private.b64>');
  process.exit(1);
}

const src = path.resolve(args.src);
const out = path.resolve(args.out);
const privB64 = fs.readFileSync(args.private, 'utf-8').trim();
const privateKey = privateKeyFromB64(privB64);

// 1. Manifest
const manifestPath = path.join(src, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error(`No manifest.json in ${src}`);
  process.exit(1);
}
const manifest = readJsonOrDie(manifestPath);

// 2. README (optional)
const readmePath = path.join(src, 'README.md');
const readme = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, 'utf-8') : undefined;

// 3. Personas (optional)
const personaDir = path.join(src, 'personas');
const personaFiles = listDir(personaDir, ['.json']);
const personas = personaFiles.map((filename) => ({
  filename: `personas/${filename}`,
  content: fs.readFileSync(path.join(personaDir, filename), 'utf-8'),
}));

// 4. Collections (optional)
const collectionsDir = path.join(src, 'collections');
const collections = [];
let totalDocCount = 0;
if (fs.existsSync(collectionsDir)) {
  const collectionIds = fs.readdirSync(collectionsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  for (const collectionId of collectionIds) {
    const cDir = path.join(collectionsDir, collectionId);
    const meta = readJsonOrDie(path.join(cDir, 'meta.json'));
    const docsDir = path.join(cDir, 'documents');
    const docFiles = listDir(docsDir);
    const documents = docFiles.map((filename) => {
      const fpath = path.join(docsDir, filename);
      return {
        filename,
        mimeType: mimeFor(filename),
        bytesBase64: fs.readFileSync(fpath).toString('base64'),
      };
    });
    totalDocCount += documents.length;
    collections.push({ id: collectionId, meta, documents });
  }
}

// 5. Defaults (optional)
const defaultsPath = path.join(src, 'defaults.json');
const defaults = fs.existsSync(defaultsPath) ? readJsonOrDie(defaultsPath) : undefined;

// 6. Compose bundle.
const bundle = {
  version: 1,
  manifest: {
    ...manifest,
    publishedAt: Date.now(),
    contents: {
      personaCount: personas.length,
      collectionCount: collections.length,
      totalDocCount,
    },
  },
  files: {
    ...(personas.length > 0 ? { personas } : {}),
    ...(collections.length > 0 ? { collections } : {}),
    ...(defaults ? { defaults } : {}),
    ...(readme ? { readme } : {}),
  },
};

// 7. Sign.
const payload = Buffer.from(canonicalize(bundle), 'utf-8');
const signature = crypto.sign(null, payload, privateKey);
const signed = { ...bundle, signature: signature.toString('base64') };

// 8. Serialize + gzip + write.
const finalJson = JSON.stringify(signed);
const gzipped = await gzip(Buffer.from(finalJson, 'utf-8'), { level: 9 });
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, gzipped);

console.log(`Built ${out}`);
console.log(`  id: ${bundle.manifest.id}`);
console.log(`  version: ${bundle.manifest.version}`);
console.log(`  personas: ${personas.length}`);
console.log(`  collections: ${collections.length} (${totalDocCount} documents)`);
console.log(`  signed: ${signature.length} bytes`);
console.log(`  size: ${(gzipped.length / 1024).toFixed(1)} KB (was ${(finalJson.length / 1024).toFixed(1)} KB uncompressed)`);
