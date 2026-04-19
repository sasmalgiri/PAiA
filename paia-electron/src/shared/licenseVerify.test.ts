import { describe, expect, it } from 'vitest';
import {
  generateKeyPairB64,
  privateKeyFromB64,
  publicKeyFromB64,
  signLicense,
  verifyLicense,
} from './licenseVerify';
import type { LicensePayload, SignedLicense } from './types';

describe('licenseVerify', () => {
  const { publicKey: pubB64, privateKey: privB64 } = generateKeyPairB64();
  const pub = publicKeyFromB64(pubB64)!;
  const priv = privateKeyFromB64(privB64)!;

  const samplePayload: LicensePayload = {
    email: 'test@example.com',
    name: 'Test User',
    tier: 'pro',
    issuedAt: 1700000000000,
    expiresAt: null,
  };

  it('round-trips a signed license', () => {
    const license = signLicense(samplePayload, priv);
    expect(verifyLicense(license, pub)).toBe(true);
  });

  it('rejects a license with a tampered payload', () => {
    const license = signLicense(samplePayload, priv);
    const tampered = {
      ...license,
      payload: { ...license.payload, tier: 'team' as const },
    };
    expect(verifyLicense(tampered, pub)).toBe(false);
  });

  it('rejects a license with a tampered signature', () => {
    const license = signLicense(samplePayload, priv);
    // Flip a single base64 char in the signature.
    const sig = license.signatureBase64;
    const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
    const tampered = { ...license, signatureBase64: flipped };
    expect(verifyLicense(tampered, pub)).toBe(false);
  });

  it('rejects a license signed with a different key', () => {
    const otherKp = generateKeyPairB64();
    const otherPriv = privateKeyFromB64(otherKp.privateKey)!;
    const license = signLicense(samplePayload, otherPriv);
    expect(verifyLicense(license, pub)).toBe(false);
  });

  it('publicKeyFromB64 returns null for invalid input', () => {
    expect(publicKeyFromB64('')).toBe(null);
    expect(publicKeyFromB64('not-base64-at-all~~~')).toBe(null);
  });

  it('privateKeyFromB64 returns null for invalid input', () => {
    expect(privateKeyFromB64('')).toBe(null);
  });

  it('generateKeyPairB64 produces 32-byte raw keys', () => {
    const { publicKey, privateKey } = generateKeyPairB64();
    expect(Buffer.from(publicKey, 'base64').length).toBe(32);
    expect(Buffer.from(privateKey, 'base64').length).toBe(32);
  });

  it('rejects signatures that are not exactly 64 bytes (length check)', () => {
    // Guards against the hardening added after the v0.11.1 security audit:
    // a malformed signature shouldn't even reach crypto.verify.
    const shortSig: SignedLicense = {
      payload: samplePayload,
      signatureBase64: Buffer.alloc(32).toString('base64'), // too short
    };
    const longSig: SignedLicense = {
      payload: samplePayload,
      signatureBase64: Buffer.alloc(128).toString('base64'), // too long
    };
    const emptySig: SignedLicense = {
      payload: samplePayload,
      signatureBase64: '',
    };
    expect(verifyLicense(shortSig, pub)).toBe(false);
    expect(verifyLicense(longSig, pub)).toBe(false);
    expect(verifyLicense(emptySig, pub)).toBe(false);
  });

  it('rejects malformed envelope shapes without throwing', () => {
    const notAnObject = null as unknown as SignedLicense;
    const missingSig = { payload: samplePayload } as unknown as SignedLicense;
    expect(() => verifyLicense(notAnObject, pub)).not.toThrow();
    expect(verifyLicense(notAnObject, pub)).toBe(false);
    expect(() => verifyLicense(missingSig, pub)).not.toThrow();
    expect(verifyLicense(missingSig, pub)).toBe(false);
  });
});
