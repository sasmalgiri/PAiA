# PAiA Responsible Disclosure Policy (TEMPLATE)

> ⚠️ Template. Adjust the reward amounts, out-of-scope list, and
> response SLAs to what you can actually honour.

**VERSION:** 0.1-draft
**Effective:** `[DATE]`

Thanks for looking. If you've found a security issue, we want to hear
about it before you tell the internet.

## How to report

Email `[security@example.com]`. PGP is available at
`[https://paia.app/pgp.asc]` — please encrypt anything that includes a
working exploit.

**Include** (at minimum):
- The affected PAiA version (Settings → About shows it).
- Your OS, architecture, and (if relevant) the LLM provider you were
  using.
- A clear description of the vulnerability.
- Reproduction steps; ideally a proof-of-concept.
- Your handle if you'd like credit in the fix's release notes.

We will acknowledge within `[3 business days]` and give you a progress
update within `[10 business days]`. Most fixes ship within `[30 days]`
for critical issues, `[60 days]` otherwise.

## In scope

- The PAiA desktop application (any platform).
- The license issuance / activation flow.
- The Companion LAN HTTP server.
- The local REST API server.
- The classroom server.
- The E2E-encrypted sync protocol.
- The agent orchestrator and the Plugin SDK sandbox.

## Out of scope

- Vulnerabilities in third-party LLM providers (report directly to
  them).
- Vulnerabilities in Electron / Chromium itself (report to upstream
  first).
- Self-XSS that requires the user to paste malicious content into
  their own chat input.
- Ability to see your own data after `localStorage.clear()` /
  "reset app data" flows — that's an expected data-removal feature.
- Denial of service via very large prompts, mic capture, or
  infinitely-looping agent goals. These are bounded by configurable
  user-side limits, not security issues.
- Social engineering of our support staff, physical attacks on our
  offices, or attacks against our customers' infrastructure.

## Safe harbor

We will not pursue legal action against researchers who:
- Make a good-faith effort to comply with this policy.
- Avoid privacy violations, data destruction, and interruption or
  degradation of our services during testing.
- Only interact with accounts they own or have explicit permission
  from the account holder to test.
- Give us reasonable time to fix before public disclosure (`[90
  days]` by default; longer if the fix involves coordination with
  a platform vendor).

## Rewards

We aren't running a public bug-bounty programme yet. For notable
findings we may offer `[swag]` and — for the worst issues — a
discretionary reward at `[USD 100–1000]` depending on severity,
novelty, and report quality. Ask before testing anything you'd expect
a reward for.

## Thanks

This has to be a template, but your inbox is not. We really appreciate
the research community.
