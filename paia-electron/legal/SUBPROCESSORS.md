# PAiA Subprocessors (TEMPLATE)

> Keep this file current. DPAs reference it by name.

**Last updated:** `[DATE]`

A "subprocessor" here means a third party we engage to deliver the
paid tiers of PAiA and which may touch limited customer data. It does
NOT include third parties you (the customer) configure yourself (OpenAI,
Anthropic, Google, GitHub, your sync host, your Sentry DSN, your
feedback collector) — in those cases your relationship is directly
with that provider, under their own terms.

## Current subprocessors

| Name | Purpose | Data touched | Region |
|---|---|---|---|
| `[Billing processor — Stripe / LemonSqueezy / Paddle]` | Payment + billing | Name, email, country, payment-method metadata, order history | `[US / EU]` |
| `[Email delivery — Resend / Postmark / SendGrid]` | Transactional email (license keys, receipts) | Name, email, license key | `[US / EU]` |
| `[License host — your own infra or a provider like Fly.io]` | Accepting license-issuance webhooks | Name, email, license key | `[YOUR REGION]` |
| `[Analytics collector — your own infra or Plausible Cloud]` | Opt-in product analytics | Anonymous install UUID, event names + property whitelist | `[EU]` |
| `[Crash reporter — self-hosted GlitchTip or Sentry Cloud]` | Opt-in crash telemetry | Stack traces, versions, redacted breadcrumbs | `[EU]` |
| `[GitHub]` | Release distribution + auto-update | Install IP + user agent (GitHub's logs) | US |

## Change log

- `[DATE]` — initial subprocessor list.
