# Clinical content slot — ICD-10 / ICD-11 Codes

This document is a content placeholder. Before publishing PAiA Therapy v1.0.0,
drop the following primary-source documents in this directory:

## Required (priority 1)

- **ICD-10-CM Chapter V (F-codes) mental and behavioural disorders.**
  WHO public domain. Available from CDC / NCHS as the official US
  Clinical Modification:
  - https://www.cdc.gov/nchs/icd/icd-10-cm.htm
  - The Tabular List and Index for the current fiscal year
- **ICD-11 Mental, Behavioural and Neurodevelopmental Disorders.**
  WHO public domain. Available from icd.who.int. Includes new
  diagnostic concepts (e.g. complex PTSD as a distinct entity, gaming
  disorder, prolonged grief disorder restored).
- **Z-codes (psychosocial factors)** for documentation:
  - Z63.x family disruption
  - Z65.x other psychosocial circumstances
  - Z62.x problems in childhood
  - Z73.x problems with life-management difficulty
  - Z71.x persons encountering health services for other counselling

## Recommended (priority 2)

- **DSM-5-TR ↔ ICD-10-CM crosswalk.** APA publishes the crosswalk in
  the DSM-5-TR appendix and as a free PDF. The crosswalk is
  paraphrasable for clinical reference; verbatim use requires
  attribution.
- **ICD-11 ↔ ICD-10 transition mapping** — WHO publishes this.
- **State-Medicaid-specific code restrictions** — some Medicaid MCOs
  restrict use of unspecified codes (F32.A "depression unspecified")
  or require specifier-level coding (F32.1 vs F32.2 vs F32.3); a
  payer-quirk reference is useful for the Documentation Specialist
  persona.

## Quality checklist before publishing

- [ ] Use the current fiscal-year ICD-10-CM file (codes update October
      1 annually)
- [ ] WHO ICD-11 official translations are versioned; record version
      and date
- [ ] Cross-references between F-codes and DSM-5-TR criteria are
      paraphrased, not verbatim
- [ ] Z-codes are present and labelled as "context / psychosocial"
      rather than primary diagnoses

The pack installer ingests every file in this directory.
