#!/usr/bin/env node
//
// PAiA trial-extension issuer. Sign these to reward referrers, apologise
// for incidents, or hand out 14-day extensions to specific users during
// beta. Verification happens in-app against the same PAIA_PUBLIC_KEY as
// licenses and beta invites.
//
// Usage:
//   node scripts/issue-trial-extension.mjs \
//     --private key.b64 \
//     --email tester@example.com \
//     --days 30 \
//     --reason "referral-reward" \
//     [--base64]

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
if (args.help || !args.private || !args.email || !args.days) {
  console.error('required: --private key.b64, --email, --days [--reason "…"] [--base64]');
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
  kind: 'trial-extension',
  email: args.email,
  extendDays: Number(args.days),
  reason: args.reason ?? 'trial-extension',
  issuedAt: Date.now(),
  nonce: crypto.randomBytes(16).toString('hex'),
};

const message = Buffer.from(JSON.stringify(payload));
const signature = crypto.sign(null, message, privateKey);
const signed = { payload, signatureBase64: signature.toString('base64') };

const out = args.base64
  ? Buffer.from(JSON.stringify(signed)).toString('base64')
  : JSON.stringify(signed);

console.log(out);
