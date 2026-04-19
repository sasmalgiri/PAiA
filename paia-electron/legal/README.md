# Legal templates — READ ME FIRST

> ⚠️ **These are templates. They have NOT been reviewed by a lawyer.**
> You MUST have a real lawyer in your target jurisdiction review and
> customise these before you ship a paid product, accept a paying customer,
> enable cloud provider integrations, or expose the Companion / API
> server features to anyone other than yourself.
>
> The placeholders in `[BRACKETS]` are the minimum you need to fill in.
> A lawyer may add or remove clauses; this scaffolding exists so you
> don't start from a blank document.

## What's in here

| File | Purpose | When it applies |
|---|---|---|
| [EULA.md](EULA.md) | End-user license for the desktop installer | Every download / install |
| [PRIVACY.md](PRIVACY.md) | What data PAiA collects or doesn't | Shipped in-app + on website |
| [TERMS.md](TERMS.md) | Website + purchase terms of service | Pricing page + checkout |
| [DPA.md](DPA.md) | Data Processing Addendum template | Enterprise / Team plan customers under GDPR |
| [SUBPROCESSORS.md](SUBPROCESSORS.md) | List of third parties that touch customer data | Linked from DPA |
| [ACCEPTABLE_USE.md](ACCEPTABLE_USE.md) | What customers can't do with PAiA | Referenced by TERMS |
| [RESPONSIBLE_DISCLOSURE.md](RESPONSIBLE_DISCLOSURE.md) | How security researchers report bugs | `/security.txt` on website |

## Workflow before shiping

1. Fill every `[BRACKET]` placeholder. A non-exhaustive list:
   - Your legal entity name and jurisdiction
   - Governing-law jurisdiction
   - Contact addresses (email + physical if required)
   - DPO contact if GDPR applies
   - Subprocessors list (Sentry DSN host, billing processor, email delivery)
2. Send the filled drafts to a lawyer. Budget 2–6 hours of their time.
3. Apply their redlines back into this folder.
4. Replace the templates in:
   - Root `LICENSE` (with the signed-off EULA)
   - `website/privacy.html` (render PRIVACY.md into the page)
   - `website/terms.html` (new page — doesn't exist yet; create it)
   - In-app "Privacy" settings tab (link to the hosted PRIVACY.md URL)
5. Publish. Keep the source-of-truth in this folder under version control
   so every change is diff-able and auditable.

## Translation

Keep legal text in English as the authoritative version. Translations
are for convenience only; the original controls. This is standard
practice and what every lawyer will tell you.

## Version history

When you change a legal document, bump the `VERSION` header at the
top of that file and add a dated note at the bottom. Material changes
typically require re-acceptance by existing users — usually via a
modal on next launch.
