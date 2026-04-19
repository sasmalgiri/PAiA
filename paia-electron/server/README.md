# PAiA license webhook server

A standalone HTTP service that issues Ed25519-signed PAiA Pro licenses
when customers complete a purchase via Stripe or LemonSqueezy.

## Why it's separate from the app

The Electron app verifies licenses but never sees the private key. Only
this server has the private key. Run it on a VPS, AWS Lambda, Cloudflare
Worker, Railway, Fly.io — anywhere you can run a Node process and
terminate TLS in front of it.

## Zero-dependency

No `npm install` needed. The server uses only Node's built-in modules:
`http`, `crypto`, `tls`, `url`. Run it directly:

```bash
node server/license-server.mjs
```

## Configuration

All via environment variables:

| Variable | Required | Description |
|---|---|---|
| `PORT` | no | Listen port (default 8787) |
| `PAIA_PRIVATE_KEY_B64` | **yes** | Base64-encoded raw 32-byte Ed25519 private key. Generate with `node scripts/issue-license.mjs --gen-keys` |
| `STRIPE_WEBHOOK_SECRET` | for Stripe | The `whsec_...` string from your Stripe webhook settings |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | for LS | The secret you set in your LemonSqueezy webhook config |
| `RESEND_API_KEY` | recommended | Use [Resend](https://resend.com) HTTP API for email — easier than SMTP |
| `RESEND_FROM` | with Resend | The from address (must be verified in Resend) |
| `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASS` `SMTP_FROM` | for SMTP | Used only if `RESEND_API_KEY` is not set. Implicit TLS (port 465) recommended. |

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Returns `200 ok` for uptime monitors |
| `POST` | `/webhook/stripe` | Stripe webhook receiver |
| `POST` | `/webhook/lemonsqueezy` | LemonSqueezy webhook receiver |

## Setup with Stripe

1. In the Stripe dashboard, **Developers → Webhooks → Add endpoint**
2. URL: `https://your-host/webhook/stripe`
3. Events to listen for: `checkout.session.completed`, `invoice.paid`
4. Copy the signing secret (`whsec_...`) and set it as `STRIPE_WEBHOOK_SECRET`
5. Test with the Stripe CLI:
   ```bash
   stripe listen --forward-to localhost:8787/webhook/stripe
   stripe trigger checkout.session.completed
   ```

## Setup with LemonSqueezy

1. **Settings → Webhooks → Create webhook**
2. URL: `https://your-host/webhook/lemonsqueezy`
3. Signing secret: any random string — set it as `LEMONSQUEEZY_WEBHOOK_SECRET`
4. Events: `Order created`
5. Test from the LemonSqueezy dashboard's "Send test webhook" button

## What happens on a purchase

1. Customer completes checkout
2. Stripe / LemonSqueezy POSTs the event to your endpoint
3. The server verifies the signature
4. The server signs a license payload `{ email, name, tier: 'pro', issuedAt: now, expiresAt: null }`
5. The server emails the JSON license block to the customer
6. The customer pastes it into PAiA → Settings → License → Activate

## Security checklist

- [ ] Run behind HTTPS (nginx + Let's Encrypt, or use Cloudflare Tunnel, or use a serverless provider that terminates TLS for you)
- [ ] **Never** commit `PAIA_PRIVATE_KEY_B64` to git or your CI logs
- [ ] Use a process supervisor (systemd, pm2) to restart on crash
- [ ] Set up health-check alerts pointed at `/health`
- [ ] Rate-limit at the reverse-proxy layer — webhooks should be rare
- [ ] Rotate the webhook secrets if you suspect compromise

## Subscription tiers

The current implementation issues a perpetual Pro license on every successful payment. For yearly subscriptions, expand `signLicense()` to set `expiresAt` based on `session.subscription`/`event.data.attributes.renews_at`. For multiple tiers, map `session.metadata.tier` or product IDs.
