# PAiA Legal

Eight legal practice personas with knowledge stacks for US, EU, and UK jurisdictions.

## What's inside

### Personas

- **Patent Attorney** — USPTO + EPO + PCT, claim drafting, office-action strategy
- **Corporate Lawyer** — entity formation, M&A, governance, commercial contracts
- **Privacy Lawyer** — GDPR / CCPA / DPDP, DPIAs, cross-border transfers
- **Compliance Officer** — SOC 2, ISO 27001, HIPAA, PCI-DSS, GDPR
- **Litigation Strategist** — case theory, discovery, motions, depositions
- **M&A Counsel** — diligence, deal structures, accretion/dilution, antitrust
- **IP Licensing** — patent + trademark + copyright licensing, royalty models
- **Employment Lawyer** — hiring, comp, termination, NDAs, non-competes

### Knowledge stacks

- **US Patent Law** — MPEP excerpts, key 35 USC sections, AIA changes
- **Privacy Frameworks** — GDPR + CCPA + DPDP key articles, EDPB guidelines
- **SEC + FTC Guidance** — disclosure, M&A, antitrust, consumer protection
- **Contract Templates** — common commercial / employment / licensing forms

> ⚠️ **Knowledge stacks shipped as placeholders.** The personas are ready for
> use; the knowledge stacks contain content slots awaiting paralegal-curated
> primary-source documents. See `collections/*/documents/placeholder.md`.
> The pack installer works end-to-end regardless of stack content.

## Privacy posture

This pack ships with conservative defaults appropriate for legal practice:

- `cloudEscalation: 'off'` — every cloud call is an explicit per-turn decision
- `includeActiveWindow: false` — window titles can leak client matters
- Attorney-client privilege banner is shown whenever any pack persona is active
- Memory entries created during pack-persona conversations default to `episode` scope (no `user` / `preference` that survive)

You can override any of these in Settings after install.

## Disclaimer

PAiA Legal is **not** legal advice. The personas are research and drafting
assistants. They cite mechanisms and frameworks; they do not represent
clients or replace counsel. Output should be reviewed by a licensed
attorney in the relevant jurisdiction before use.
