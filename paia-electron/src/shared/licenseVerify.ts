// Pure Ed25519 license signature verification. Extracted from
// src/main/license.ts so it can be unit-tested without booting Electron.
//
// The full license module also handles trial-state persistence and
// feature gating, both of which need `app.getPath('userData')`. Anything
// here is pure crypto + JSON.

import * as crypto from 'crypto';
import type { LicensePayload, SignedLicense } from './types';

/**
 * Build an Ed25519 PublicKey from a base64-encoded raw 32-byte key.
 * Returns null on any failure (caller should treat as "no public key").
 */
export function publicKeyFromB64(b64: string): crypto.KeyObject | null {
  if (!b64) return null;
  try {
    return crypto.createPublicKey({
      key: Buffer.concat([
        Buffer.from('302a300506032b6570032100', 'hex'),
        Buffer.from(b64, 'base64'),
      ]),
      format: 'der',
      type: 'spki',
    });
  } catch {
    return null;
  }
}

/**
 * Build an Ed25519 PrivateKey from a base64-encoded raw 32-byte key.
 * Used by the test suite and by scripts/issue-license.mjs.
 */
export function privateKeyFromB64(b64: string): crypto.KeyObject | null {
  if (!b64) return null;
  try {
    return crypto.createPrivateKey({
      key: Buffer.concat([
        Buffer.from('302e020100300506032b657004220420', 'hex'),
        Buffer.from(b64, 'base64'),
      ]),
      format: 'der',
      type: 'pkcs8',
    });
  } catch {
    return null;
  }
}

/** Sign a license payload with the given private key. */
export function signLicense(payload: LicensePayload, privateKey: crypto.KeyObject): SignedLicense {
  const message = Buffer.from(JSON.stringify(payload));
  const signature = crypto.sign(null, message, privateKey);
  return { payload, signatureBase64: signature.toString('base64') };
}

/** Verify a license signature. Returns true on success. */
export function verifyLicense(license: SignedLicense, publicKey: crypto.KeyObject): boolean {
  try {
    if (!license || typeof license.signatureBase64 !== 'string') return false;
    const signature = Buffer.from(license.signatureBase64, 'base64');
    // Ed25519 signatures are exactly 64 bytes. Reject anything else
    // before handing to crypto.verify, which could otherwise throw or
    // waste CPU on obviously-malformed input.
    if (signature.length !== 64) return false;
    const message = Buffer.from(JSON.stringify(license.payload));
    return crypto.verify(null, message, publicKey, signature);
  } catch {
    return false;
  }
}

/** Convenience helper: generate a fresh Ed25519 keypair as raw base64 strings. */
export function generateKeyPairB64(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pubDer = publicKey.export({ format: 'der', type: 'spki' });
  const privDer = privateKey.export({ format: 'der', type: 'pkcs8' });
  return {
    publicKey: pubDer.subarray(pubDer.length - 32).toString('base64'),
    privateKey: privDer.subarray(privDer.length - 32).toString('base64'),
  };
}
