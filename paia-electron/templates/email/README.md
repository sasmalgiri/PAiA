# Transactional email templates

Ready-to-paste into whichever delivery provider you choose (Resend,
Postmark, SendGrid, ses). Plain markdown for content; wrap in the
provider's HTML layout or send as plain text.

Every template is kept short on purpose. Users open transactional
email, skim three lines, and act — a fifteen-paragraph welcome gets
archived unread.

## Variables

Every template uses `{{variable}}` syntax. Substitute before sending.

| Variable | Example |
|---|---|
| `{{first_name}}` | "Sam" |
| `{{email}}` | "sam@example.com" |
| `{{license_blob}}` | the full JSON / base64 license |
| `{{license_tier}}` | "Pro" / "Team" |
| `{{expiry}}` | "2027-04-19" or "never" (for lifetime) |
| `{{trial_days_left}}` | "3" |
| `{{price}}` | "$9.00 USD" |
| `{{invoice_url}}` | merchant-of-record invoice link |
| `{{support_email}}` | "support@paia.app" |

## Files

- `welcome.md` — sent on first license activation OR first open of the desktop app
- `license_delivery.md` — sent when a purchase webhook fires
- `trial_day_7.md` — sent 7 days into the trial
- `trial_day_12.md` — sent 2 days before trial ends
- `trial_ended.md` — sent the day trial expires
- `dunning_card_failed.md` — sent when a subscription renewal fails
- `cancellation_confirmed.md` — sent when a user cancels
- `renewal_reminder.md` — sent 7 days before annual renewal
- `security_incident.md` — template for the day you hope never comes

## Sending policy

- Transactional only. Never marketing without explicit opt-in.
- Include an "unsubscribe from non-essential emails" link in every
  email except security + license delivery.
- Keep subject lines < 50 characters.
- Use the sender's real name + the product name: `Sam from PAiA <sam@paia.app>`.
- Never use no-reply addresses. Replies reach a real inbox.
