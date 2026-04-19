#!/usr/bin/env node
//
// PAiA license key issuance CLI.
//
// Two modes:
//
//   1. Generate a new keypair (run this ONCE per product release):
//      node scripts/issue-license.mjs --gen-keys
//
//   2. Issue a license for a customer:
//      node scripts/issue-license.mjs \
//        --private path/to/private.b64 \
//        --email customer@example.com \
//        --name "Customer Name" \
//        --tier pro \
//        --expires 2027-04-01
//
// The output is a single-line JSON blob the customer pastes into
// Settings → License → Activate.
//
// SECURITY NOTES:
//   - Keep the private key OFF the user's machine. Run this script
//     on your own server, your laptop, or wherever you process orders.
//   - The public key (printed during --gen-keys) goes into the app
//     binary as the PAIA_PUBLIC_KEY env var at build time, OR you can
//     hard-code it into src/main/license.ts.
//   - For real production use, integrate this with your billing
//     processor (Stripe, LemonSqueezy) so each successful payment
//     automatically triggers `node issue-license.mjs --email …`.

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

const args = parseArgs(process.argv);

if (args['gen-keys']) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  // Export both as raw 32-byte keys, base64-encoded.
  const pubDer = publicKey.export({ format: 'der', type: 'spki' });
  const privDer = privateKey.export({ format: 'der', type: 'pkcs8' });
  // Strip the SPKI/PKCS8 prefix to get the raw 32 bytes.
  const pubRaw = pubDer.subarray(pubDer.length - 32);
  const privRaw = privDer.subarray(privDer.length - 32);

  const pubB64 = pubRaw.toString('base64');
  const privB64 = privRaw.toString('base64');

  const outDir = join(__dirname, '..', '.keys');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(join(outDir, 'private.b64'), privB64);
  fs.writeFileSync(join(outDir, 'public.b64'), pubB64);

  console.log('Generated Ed25519 keypair:');
  console.log('  public key  →', pubB64);
  console.log('  private key →', privB64);
  console.log();
  console.log('Saved to .keys/ — DO NOT commit private.b64 to git.');
  console.log();
  console.log('Embed the public key in builds via PAIA_PUBLIC_KEY env var:');
  console.log(`  PAIA_PUBLIC_KEY="${pubB64}" npm run dist`);
  process.exit(0);
}

if (!args.private || !args.email) {
  console.error('Usage: issue-license.mjs --private path/to/private.b64 --email user@example.com [--name "Name"] [--tier free|pro|team] [--expires YYYY-MM-DD]');
  console.error('   or: issue-license.mjs --gen-keys');
  process.exit(1);
}

// Load the private key.
const privB64 = fs.readFileSync(args.private, 'utf-8').trim();
const privDer = Buffer.concat([
  Buffer.from('302e020100300506032b657004220420', 'hex'),
  Buffer.from(privB64, 'base64'),
]);
const privateKey = crypto.createPrivateKey({ key: privDer, format: 'der', type: 'pkcs8' });

const payload = {
  email: args.email,
  name: args.name ?? '',
  tier: args.tier ?? 'pro',
  issuedAt: Date.now(),
  expiresAt: args.expires ? new Date(args.expires).getTime() : null,
};

const message = Buffer.from(JSON.stringify(payload));
const signature = crypto.sign(null, message, privateKey);

const license = {
  payload,
  signatureBase64: signature.toString('base64'),
};

console.log(JSON.stringify(license, null, 2));
