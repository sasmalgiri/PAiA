# PAiA Therapy

A vertical pack for licensed mental health clinicians: licensed therapists
(LMFT, LCSW, LMHC, LPC), psychologists (PsyD, PhD), psychiatric NPs,
counsellors, and clinical supervisors.

## What's in the pack

**8 clinical personas** — each scoped to a specific evidence-based
modality or clinical role:

- **CBT Clinician** — cognitive distortions, behavioural activation,
  thought records, exposure hierarchies
- **DBT Clinician** — emotion regulation, distress tolerance, mindfulness,
  interpersonal effectiveness, skills training
- **EMDR Clinician** — 8-phase protocol, AIP model, target processing,
  resourcing
- **Trauma-Focused Clinician** — CPT, PE, narrative exposure, complex
  trauma, polyvagal informed work
- **Family / Systems Clinician** — structural, strategic, Bowenian,
  Gottman method, attachment-based family therapy
- **Child & Adolescent Clinician** — PCIT, TF-CBT, play therapy,
  attachment-focused work, developmental considerations
- **Intake & Assessment Specialist** — biopsychosocial assessment,
  risk stratification, treatment planning, level-of-care decisions
- **Clinical Documentation Specialist** — SOAP / DAP / GIRP notes,
  ICD-10 coding, medical necessity language, treatment-plan templates,
  prior authorization

**4 knowledge stacks** (content slots — see "Paralegal content" sections
in each `placeholder.md`):

- **Diagnostic Criteria** — DSM-5-TR criteria summaries (paraphrased;
  the full DSM is APA copyrighted and requires licensing)
- **ICD-10 / ICD-11 Codes** — WHO public-domain diagnostic codes
- **Evidence-Based Protocols** — open-licence treatment manuals and
  decision trees (CBT, DBT, EMDR, TF-CBT, PCIT)
- **HIPAA Boilerplate** — NPP templates, ROI forms, consent forms, BAA
  templates, mandated-reporter quick-references

## Defaults applied on install (HIPAA posture)

When you install this pack, PAiA changes three settings — all toward
the conservative end. You can revert any of them in Settings.

| Setting | Default before pack | After pack | Why |
|---|---|---|---|
| `cloudEscalation` | `ask` | `off` | Cloud calls require explicit per-turn consent for clinical content |
| `includeActiveWindow` | varies | `false` | Window titles can reveal client names from EHR / scheduling software |
| `inspectorEnabled` | `true` | `false` | Per-message telemetry could expose RAG filenames (e.g. "Client A intake") |

## Important: what this is and isn't

**This pack is** a drafting assistant for licensed clinicians who own the
clinical decision. Use it to:
- Draft session notes from your own observations and dictation
- Generate treatment-plan templates you'll review and modify
- Look up protocol details and decision trees
- Practise role-plays for difficult conversations
- Get a second-opinion lens on case formulation

**This pack is not:**
- A clinical decision support system
- A diagnostic tool
- A replacement for clinical supervision
- A tool for direct patient interaction
- Approved for unsupervised clinical use

Every clinical persona's system prompt explicitly frames its output as
*draft work product*, defers diagnostic and treatment decisions to the
licensed clinician, and reminds the clinician of mandated-reporter
obligations and crisis escalation paths (988 in the US, 116 123 in EU)
when safety topics arise.

## Building the pack from source

```bash
node paia-electron/scripts/build-pack.mjs \
  --src packs/paia-therapy \
  --out dist-packs/paia-therapy-0.1.0.paia-pack \
  --private paia-electron/.keys/private.b64
```

## Content curation before publishing v1.0.0

Each `collections/*/documents/placeholder.md` describes the primary-source
documents that should be dropped in before publishing. A clinician
content reviewer (LMFT, LCSW, PsyD, or psychiatrist) should sign off on
all content, especially the diagnostic-criteria and evidence-based
protocol stacks, before public release.

DSM-5-TR is copyrighted by APA and **cannot** be shipped verbatim;
either paraphrase under fair-use for clinical reference or license from
APA. WHO ICD codes are public domain and can be shipped as-is. Treatment
manuals vary — many have open clinician's manuals (e.g. UNC's PCIT
materials, public Beck Institute CBT modules) but always verify the
licence before bundling.
