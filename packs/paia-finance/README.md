# PAiA Finance

A vertical pack for fiduciary financial planners, RIAs, and wealth
advisors: CFP®, ChFC®, CFA®, CPWA®, CIMA® holders; RIA principals and
advisors; CCOs; hybrid (BD + RIA) practitioners.

## What's in the pack

**8 advisor personas** — each scoped to a specific specialty or
compliance role:

- **Fiduciary Investment Advisor** — IPS, asset allocation,
  rebalancing, manager selection, prudent investor rule
- **Tax-Sensitive Planner** — tax-loss harvesting, asset location,
  Roth conversions, NUA, charitable strategies, AMT/NIIT/IRMAA
- **Estate Planner** — wills, trusts (ILIT/SLAT/GRAT/CRT/CLAT/IDGT),
  beneficiary designations, gift/estate/GST tax
- **Insurance & Risk Specialist** — life, LTC, disability, P&C
  umbrella, annuity analysis, 1035 exchanges, NAIC suitability
- **Retirement Income Specialist** — withdrawal strategies, sequence
  of returns, Social Security claiming, Medicare/IRMAA, pension
  elections, SECURE 2.0 RMDs
- **Behavioral Finance Coach** — biases, market-panic conversations,
  retirement transitions, money scripts (Klontz)
- **RIA Compliance Officer** — Form ADV, custody rule, marketing
  rule, code of ethics, books-and-records, supervisory procedures
- **Business-Owner Exit Planner** — valuation, buy-sell, ESOP, NQDC,
  pre-transaction planning, succession

**4 knowledge stacks** (content slots — see each `placeholder.md`):

- **Tax Code & IRS Guidance** — selected IRC sections, IRS Pubs,
  Rev Procs, SECURE 2.0 summary, Form 1040/1041/706/709 instructions
- **SEC / FINRA Rules** — Investment Advisers Act, Rules 204-2 /
  204A-1 / 206(4)-1 / 206(4)-2 / 206(4)-7, FINRA conduct rules,
  Form ADV, state RAUM thresholds
- **Estate & Wealth Transfer** — federal estate/gift/GST tax,
  state estate-tax matrix, trust types, beneficiary planning,
  POA / healthcare directives
- **Insurance, Annuities, Retirement Products** — product
  taxonomy, 1035 exchange rules, ERISA basics, SS claiming,
  Medicare, contribution limits + catch-up

## Defaults applied on install (FINRA/SEC compliance posture)

When you install this pack, PAiA changes three settings — all toward
the conservative end. You can revert any of them in Settings.

| Setting | Default before pack | After pack | Why |
|---|---|---|---|
| `cloudEscalation` | `ask` | `off` | Client investment data should not leave the machine without your CCO's approval |
| `includeActiveWindow` | varies | `false` | Window titles can reveal client portfolio names from CRMs / planning software |
| `inspectorEnabled` | `true` | `false` | Per-message telemetry could expose RAG filenames (e.g. "Client X IPS draft") |

## Important: what this is and isn't

**This pack is** a drafting and research assistant for licensed and
properly registered investment professionals. Use it to:
- Draft IPS sections, financial plan modules, and client letters
- Analyse tax-sensitive scenarios (Roth conversions, NUA, charitable
  strategies) for your own review before client presentation
- Look up rule citations, Form ADV requirements, and product
  taxonomies
- Practise difficult-conversation role-plays (market-panic,
  beneficiary disputes, retirement transitions)
- Get a second-opinion lens on plan recommendations before the
  client meeting

**This pack is not:**
- A system that gives investment advice
- A substitute for proper securities licensing (Series 6/7/65/66) or
  fiduciary registration (Form ADV)
- A replacement for CFP®, CFA®, or other professional designations
- Approved for direct client-facing automation
- A substitute for your firm's compliance review

Every persona's system prompt explicitly frames its output as *draft
work product*, defers specific investment recommendations to the
licensed advisor, refuses to forecast market returns, and flags when
the answer depends on the client's risk tolerance, time horizon, tax
bracket, or state of residence.

## Building the pack from source

```bash
node paia-electron/scripts/build-pack.mjs \
  --src packs/paia-finance \
  --out dist-packs/paia-finance-0.1.0.paia-pack \
  --private paia-electron/.keys/private.b64
```

## Content curation before publishing v1.0.0

Each `collections/*/documents/placeholder.md` describes the
primary-source documents that should be dropped in before publishing.
A CFP® or CFA® content reviewer plus a securities-compliance attorney
should sign off on the SEC / FINRA stack, and a tax attorney or
enrolled agent on the tax stack, before public release.

IRS publications, IRC sections, and SEC/FINRA rule text are public
domain (US Government Works) and can be shipped as-is. State estate
and securities rules vary — annotate jurisdiction explicitly. Many
proprietary planning frameworks (Holistiplan tax-return reading,
Riskalyze GPA, eMoney scenario constructs) are paid IP — cite and
cross-reference only.
