#!/usr/bin/env node
//
// PAiA beta-invite issuer. Mirrors issue-license.mjs but signs a
// `beta-invite` payload instead of a license.
//
// Usage:
//   node scripts/issue-beta-invite.mjs \
//     --private path/to/private.b64 \
//     --email tester@example.com \
//     --name "Jane Tester" \
//     --expires 2026-07-01 \
//     --cohort wave-1
//
// Output is one JSON line the tester pastes into Settings → Beta →
// Activate. (Or base64-encoded, which is sometimes friendlier to paste.)

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) { args[key] = true; continue; }
    args[key] = next;
    i++;
  }
  return args;
}

const args = parseArgs(process.argv);

if (args.help) {
  console.log('node scripts/issue-beta-invite.mjs --private key.b64 --email x@y --name "Name" [--expires 2026-07-01] [--cohort wave-1] [--base64]');
  process.exit(0);
}
if (!args.private || !args.email || !args.name) {
  console.error('required: --private, --email, --name');
  process.exit(1);
}

const privB64 = fs.readFileSync(args.private, 'utf-8').trim();
const privateKey = crypto.createPrivateKey({
  key: Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    Buffer.from(privB64, 'base64'),
  ]),
  format: 'der',
  type: 'pkcs8',
});

const payload = {
  kind: 'beta-invite',
  email: args.email,
  name: args.name,
  issuedAt: Date.now(),
  expiresAt: args.expires ? new Date(args.expires).getTime() : null,
};
if (args.cohort) payload.cohort = args.cohort;

const message = Buffer.from(JSON.stringify(payload));
const signature = crypto.sign(null, message, privateKey);
const signed = { payload, signatureBase64: signature.toString('base64') };

const out = args.base64
  ? Buffer.from(JSON.stringify(signed)).toString('base64')
  : JSON.stringify(signed);

console.log(out);
