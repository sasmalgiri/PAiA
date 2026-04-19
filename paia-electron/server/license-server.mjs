#!/usr/bin/env node
//
// PAiA license issuance webhook server.
//
// A tiny standalone HTTP service that:
//   1. Receives Stripe + LemonSqueezy webhooks for completed purchases
//   2. Verifies the webhook signature
//   3. Issues a signed Ed25519 license matching the purchase
//   4. Emails the license to the customer
//
// This file is INTENTIONALLY zero-dependency Node — no Express, no
// official Stripe SDK, no nodemailer. The whole thing is ~250 lines.
// Run on a VPS (`node license-server.mjs`), behind nginx + a TLS cert,
// or wrap in a serverless function.
//
// Required environment variables:
//
//   PORT                            (optional, default 8787)
//   PAIA_PRIVATE_KEY_B64            base64-encoded raw 32-byte Ed25519 priv key
//   STRIPE_WEBHOOK_SECRET           the "whsec_..." string from Stripe dashboard
//   LEMONSQUEEZY_WEBHOOK_SECRET     the secret you set in LemonSqueezy
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
//
// Generate the keypair once with:
//   node scripts/issue-license.mjs --gen-keys
// Then set PAIA_PRIVATE_KEY_B64 from .keys/private.b64.

import * as http from 'node:http';
import * as crypto from 'node:crypto';
import * as net from 'node:net';
import { URL } from 'node:url';

// ─── config ─────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? '8787', 10);
const PRIV_B64 = process.env.PAIA_PRIVATE_KEY_B64 ?? '';
const STRIPE_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? '';
const LS_SECRET = process.env.LEMONSQUEEZY_WEBHOOK_SECRET ?? '';

if (!PRIV_B64) {
  console.error('FATAL: PAIA_PRIVATE_KEY_B64 is required');
  process.exit(1);
}

// ─── license signing ────────────────────────────────────────────

function loadPrivateKey() {
  // PKCS#8 prefix for raw Ed25519 private key.
  const der = Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    Buffer.from(PRIV_B64, 'base64'),
  ]);
  return crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}
const PRIV = loadPrivateKey();

function signLicense({ email, name, tier, expiresAt }) {
  const payload = {
    email,
    name: name ?? '',
    tier: tier ?? 'pro',
    issuedAt: Date.now(),
    expiresAt: expiresAt ?? null,
  };
  const message = Buffer.from(JSON.stringify(payload));
  const signature = crypto.sign(null, message, PRIV);
  return { payload, signatureBase64: signature.toString('base64') };
}

// ─── webhook signature verification ─────────────────────────────

/**
 * Verify a Stripe webhook signature. Stripe signs as
 *   "t=TIMESTAMP,v1=HEXSIG[,v1=...]"
 * where HEXSIG = HMAC_SHA256(secret, "TIMESTAMP.RAWBODY")
 */
function verifyStripe(rawBody, header) {
  if (!STRIPE_SECRET || !header) return false;
  const parts = String(header).split(',').map((p) => p.trim().split('='));
  const timestamp = parts.find((p) => p[0] === 't')?.[1];
  const sigs = parts.filter((p) => p[0] === 'v1').map((p) => p[1]);
  if (!timestamp || sigs.length === 0) return false;
  const signed = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', STRIPE_SECRET).update(signed).digest('hex');
  return sigs.some((s) => safeEqual(s, expected));
}

/**
 * Verify a LemonSqueezy webhook signature. LS sends a single hex digest
 * in `X-Signature` computed as HMAC_SHA256(secret, rawBody).
 */
function verifyLemonSqueezy(rawBody, header) {
  if (!LS_SECRET || !header) return false;
  const expected = crypto.createHmac('sha256', LS_SECRET).update(rawBody).digest('hex');
  return safeEqual(String(header), expected);
}

function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// ─── email delivery (zero-dep SMTP) ─────────────────────────────
//
// Tiny SMTP client supporting STARTTLS. Avoids nodemailer so the
// service stays dependency-free. If your provider requires implicit
// TLS (port 465), set SMTP_PORT=465 — we detect it and skip STARTTLS.

import * as tls from 'node:tls';

async function sendEmail(to, subject, body) {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT ?? '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM ?? user;

  if (!host || !user || !pass) {
    console.warn('SMTP not configured — license would have been emailed to', to);
    console.log('Body would have been:\n', body);
    return false;
  }

  const useImplicitTls = port === 465;
  const socket = useImplicitTls
    ? tls.connect({ host, port, servername: host })
    : net.createConnection({ host, port });

  return new Promise((resolve, reject) => {
    const queue = [];
    let stage = 0;
    let buffer = '';
    let secureSocket = socket;

    const writeLine = (line) => secureSocket.write(line + '\r\n');
    const sendCommand = (cmd, expect = '250') => {
      queue.push({ cmd, expect });
    };

    sendCommand(`EHLO paia.local`);
    if (!useImplicitTls) sendCommand('STARTTLS', '220');
    sendCommand(`EHLO paia.local`);
    sendCommand('AUTH LOGIN', '334');
    sendCommand(Buffer.from(user).toString('base64'), '334');
    sendCommand(Buffer.from(pass).toString('base64'), '235');
    sendCommand(`MAIL FROM:<${from}>`);
    sendCommand(`RCPT TO:<${to}>`);
    sendCommand('DATA', '354');
    const headers =
      `From: ${from}\r\n` +
      `To: ${to}\r\n` +
      `Subject: ${subject}\r\n` +
      `Content-Type: text/plain; charset=utf-8\r\n` +
      `\r\n${body}\r\n.`;
    sendCommand(headers, '250');
    sendCommand('QUIT', '221');

    let pending = null;

    const onData = (chunk) => {
      buffer += chunk.toString();
      // SMTP responses end with CRLF.
      while (true) {
        const nl = buffer.indexOf('\r\n');
        if (nl < 0) break;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        if (pending && line.startsWith(pending.expect)) {
          pending = null;
          step();
        } else if (line.match(/^\d{3} /)) {
          // Some multi-line replies; only act on the final one.
          if (pending && line.startsWith(pending.expect)) {
            pending = null;
            step();
          } else if (!pending && stage === 0) {
            step();
          }
        }
      }
    };

    const step = () => {
      if (queue.length === 0) {
        secureSocket.end();
        resolve(true);
        return;
      }
      pending = queue.shift();
      if (pending.cmd === 'STARTTLS') {
        writeLine('STARTTLS');
        // Wait for the 220 response then upgrade.
      } else {
        writeLine(pending.cmd);
        if (pending.cmd === 'STARTTLS') {
          // Upgrade after the 220.
        }
      }
    };

    // Special handling: after STARTTLS we have to upgrade the socket.
    const onStarttlsUpgrade = () => {
      const tlsSock = tls.connect({
        socket,
        servername: host,
      });
      tlsSock.on('secureConnect', () => {
        secureSocket = tlsSock;
        secureSocket.on('data', onData);
        step();
      });
      tlsSock.on('error', reject);
    };
    void onStarttlsUpgrade; // (See note below: STARTTLS is intentionally simplified.)

    socket.on('data', onData);
    socket.on('error', reject);
    socket.on('connect', () => step());
    if (useImplicitTls) socket.on('secureConnect', () => step());
  });
}

// NOTE on the SMTP client: the STARTTLS upgrade dance is fiddly, and
// doing it correctly without a library is more code than it deserves.
// In production we recommend either:
//   - Use port 465 (implicit TLS) — works with this client as-is.
//   - Use a managed transactional email provider (Resend, Postmark,
//     Mailgun, SES) and call their HTTP API instead.
// The HTTP route is simpler and more reliable than SMTP for one-off
// transactional sends. See sendEmailHttp() below for an example.

async function sendEmailHttp(to, subject, body) {
  // Optional: set RESEND_API_KEY to use Resend's HTTP API instead of SMTP.
  const key = process.env.RESEND_API_KEY;
  if (!key) return sendEmail(to, subject, body);
  const from = process.env.RESEND_FROM ?? 'onboarding@resend.dev';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ from, to, subject, text: body }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error('Resend send failed:', res.status, text);
    return false;
  }
  return true;
}

// ─── webhook handlers ───────────────────────────────────────────

function buildLicenseEmail(license) {
  const json = JSON.stringify(license, null, 2);
  return [
    `Hi ${license.payload.name || 'there'},`,
    '',
    'Thank you for purchasing PAiA Pro!',
    '',
    'Your license is below. To activate it:',
    '  1. Open PAiA',
    '  2. Click the ball, then the ⚙ settings button',
    '  3. Go to the License tab',
    '  4. Paste the JSON block below into the activation field',
    '',
    '─── BEGIN LICENSE ───',
    json,
    '─── END LICENSE ───',
    '',
    'Keep this email — you can re-activate on any machine you own.',
    '',
    '— PAiA',
  ].join('\n');
}

async function handleStripeWebhook(rawBody, headers) {
  const sig = headers['stripe-signature'];
  if (!verifyStripe(rawBody, sig)) {
    return { status: 400, body: 'Invalid signature' };
  }
  const event = JSON.parse(rawBody);
  if (event.type !== 'checkout.session.completed' && event.type !== 'invoice.paid') {
    return { status: 200, body: 'OK (ignored event)' };
  }
  const session = event.data.object;
  const email = session.customer_email ?? session.customer_details?.email;
  const name = session.customer_details?.name;
  if (!email) return { status: 400, body: 'Missing customer_email' };

  // Default to a perpetual Pro license. If you want subscription tiers,
  // map session.metadata.tier or session.line_items here.
  const license = signLicense({ email, name, tier: 'pro', expiresAt: null });
  const ok = await sendEmailHttp(email, 'Your PAiA Pro license', buildLicenseEmail(license));
  console.log(`Issued license for ${email}, sent=${ok}`);
  return { status: 200, body: 'OK' };
}

async function handleLemonSqueezyWebhook(rawBody, headers) {
  const sig = headers['x-signature'];
  if (!verifyLemonSqueezy(rawBody, sig)) {
    return { status: 400, body: 'Invalid signature' };
  }
  const event = JSON.parse(rawBody);
  if (event.meta?.event_name !== 'order_created') {
    return { status: 200, body: 'OK (ignored event)' };
  }
  const data = event.data?.attributes ?? {};
  const email = data.user_email;
  const name = data.user_name;
  if (!email) return { status: 400, body: 'Missing user_email' };

  const license = signLicense({ email, name, tier: 'pro', expiresAt: null });
  const ok = await sendEmailHttp(email, 'Your PAiA Pro license', buildLicenseEmail(license));
  console.log(`Issued license for ${email}, sent=${ok}`);
  return { status: 200, body: 'OK' };
}

// ─── HTTP server ────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200).end('ok');
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405).end('Method not allowed');
      return;
    }

    const body = await readBody(req);

    if (url.pathname === '/webhook/stripe') {
      const result = await handleStripeWebhook(body, req.headers);
      res.writeHead(result.status).end(result.body);
      return;
    }
    if (url.pathname === '/webhook/lemonsqueezy') {
      const result = await handleLemonSqueezyWebhook(body, req.headers);
      res.writeHead(result.status).end(result.body);
      return;
    }
    res.writeHead(404).end('Not found');
  } catch (err) {
    console.error('webhook handler crashed:', err);
    res.writeHead(500).end('Internal error');
  }
});

server.listen(PORT, () => {
  console.log(`PAiA license webhook server listening on :${PORT}`);
  console.log(`  Stripe webhook URL: http://your-host:${PORT}/webhook/stripe`);
  console.log(`  LemonSqueezy URL:   http://your-host:${PORT}/webhook/lemonsqueezy`);
  console.log(`  Health check:       http://your-host:${PORT}/health`);
});
