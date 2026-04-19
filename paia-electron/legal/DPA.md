# PAiA Data Processing Addendum (TEMPLATE)

> ⚠️ Template — absolutely get a lawyer to review before counter-signing
> one of these with a customer. GDPR / UK-GDPR DPAs have legal weight;
> a mis-filed one creates real liability.

**VERSION:** 0.1-draft
**Effective:** on the date the parties execute the Order to which this
DPA is attached.

This Data Processing Addendum ("DPA") forms part of the PAiA Terms of
Service (the "Agreement") between `[YOUR LEGAL ENTITY]` ("Processor",
"we") and `[CUSTOMER]` ("Controller") for the Team-tier PAiA
subscription.

## 1. Scope and roles

1.1 The Controller determines the purposes and means of processing of
its Personal Data. The Processor processes Personal Data only on
documented instructions from the Controller, as set out in the
Agreement and this DPA.

1.2 The categories of data subjects and Personal Data we process on
the Controller's behalf are limited to: names and email addresses of
the Controller's employees or contractors who have been issued PAiA
license keys; support-ticket contents the Controller's personnel
submit to us; and opt-in crash reports and feedback messages they
send via the app.

1.3 Data classified as "special category" under GDPR Art. 9 is NOT in
scope. If the Controller causes us to receive such data, the Controller
is in breach and indemnifies us for any resulting claim.

## 2. Sub-processors

2.1 The Controller authorises us to use the sub-processors listed in
`[SUBPROCESSORS.md](SUBPROCESSORS.md)` as updated from time to time.

2.2 We will give the Controller at least `[30]` days' notice before
engaging a new sub-processor. The Controller may reasonably object on
data-protection grounds; if we cannot resolve the objection, the
Controller may terminate the affected portion of the Service.

2.3 We remain liable for our sub-processors' compliance with this DPA.

## 3. Security

3.1 Technical measures include (without limitation): encryption in
transit (TLS 1.2+); encryption at rest for sync data (AES-256-GCM)
using Controller-held keys; hashed passwords (where we hold any;
typically we do not); Ed25519 signing for licences; signed
installers on macOS + Windows; isolated Electron rendering with CSP.

3.2 Organisational measures include: access control to production
systems on a need-to-know basis, MFA on administrator accounts,
periodic security review, incident response runbook.

## 4. Sub-processor transfers outside the EEA / UK

4.1 Where we or any sub-processor transfer Personal Data outside the
EEA or UK, transfers are made under the EU Standard Contractual
Clauses or the UK's International Data Transfer Addendum, as
applicable, or another valid transfer mechanism.

## 5. Data subject rights

5.1 We will, taking into account the nature of the processing, assist
the Controller by appropriate technical and organisational measures
in responding to requests from data subjects. Because the bulk of
PAiA data lives on the Controller's own infrastructure, assistance
is usually limited to guiding the Controller's admin through the
app's "export / delete my data" flows.

## 6. Personal-data breaches

6.1 We will notify the Controller without undue delay — and in any
event within `[72]` hours — on becoming aware of a Personal Data
breach affecting data we process on behalf of the Controller.

6.2 The notice will include the categories and approximate number of
data subjects affected, likely consequences, and measures taken or
proposed to address the breach.

## 7. Audits

7.1 We will make available to the Controller all information
reasonably necessary to demonstrate compliance with this DPA, and
will allow for and contribute to audits conducted by the Controller
or an auditor it mandates, subject to reasonable notice (minimum
`[30]` days) and scope (once per year unless required by a
supervisory authority).

## 8. Return / deletion

8.1 On termination of the Agreement, the Controller may export its
data using the PAiA sync / export tooling. We will delete Personal
Data we hold on behalf of the Controller within `[90]` days of
termination, unless longer retention is required by law.

## 9. Liability

9.1 Each party's liability under this DPA is subject to the limits
set out in the Agreement.

## 10. Order of precedence

10.1 In the event of a conflict between this DPA and the Agreement,
this DPA controls with respect to processing of Personal Data.

---

**Signatures**

For the Processor: `[NAME, TITLE, DATE]`
For the Controller: `[NAME, TITLE, DATE]`
