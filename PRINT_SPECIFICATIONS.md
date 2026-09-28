# Print Specifications

> Defines every printable document the Service Tech system generates, so paper handoffs (customer drop-off, factory communication, customer pickup) come from the system instead of being handwritten. This extends the "Print Layout Principles" section of [UI_GUIDELINES.md](UI_GUIDELINES.md) with full per-document specs, and is scoped for implementation in Sprint 8 ([SPRINT_ROADMAP.md](SPRINT_ROADMAP.md)). Design-only — no print templates exist in code yet.
>
> **Terminology:** the core business entity is the **Service Job**, not "Claim" — see [DECISIONS.md](DECISIONS.md) #009. Field sourcing below reflects the Customer Master and Product Instance entities introduced in [DECISIONS.md](DECISIONS.md) #011–#015, which resolved most of the schema gaps originally flagged in this document's first version.

## Scope

- **Version 1 paper size: A4** for every document. No other paper size is in scope for V1.
- Documents render from the browser using **CSS `@media print`** — no PDF generation library. "Export to PDF" is achieved via the browser's native print-to-PDF.
- Printer-friendly by default: minimal color use, legible in black & white, no glass/blur/gradient visual language.
- **Thai Buddhist Era (B.E.)** dates appear on every **customer-facing** document, per [DECISIONS.md](DECISIONS.md) #003. The Repair Report (factory-facing, internal) uses Gregorian dates only.

## Shared Document Standards

| Attribute                 | Default                                                                                                                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paper Size                | A4 (210 × 297 mm)                                                                                                                                                                                    |
| Orientation               | Portrait                                                                                                                                                                                             |
| Print Margins             | 15 mm on all sides                                                                                                                                                                                   |
| Header                    | Brand logo top-left; document title, tracking number, and QR code top-right; horizontal divider below                                                                                                |
| Footer                    | Page X of Y (left), "System-generated document" disclaimer (center), service center contact (right)                                                                                                  |
| QR Code Placement         | Top-right of header, beneath/beside the tracking number                                                                                                                                              |
| QR Code Content           | URL to the public tracker for that service job (`/track/{tracking_number}`)                                                                                                                          |
| Tracking Number Placement | Top-right of header, bold, large (≥14pt)                                                                                                                                                             |
| Brand Logo Placement      | Top-left of header, max height ~18 mm, sourced from `brands.logo_url`                                                                                                                                |
| Signature Areas           | Bottom of document, boxed, one column per signatory                                                                                                                                                  |
| Date Format               | DD/MM/YYYY Gregorian + Buddhist Era on customer-facing documents; Gregorian only on internal/factory documents                                                                                       |
| Typography                | Thai-script-capable font family (final selection pending [DECISIONS.md](DECISIONS.md) #008); title 16–18pt bold, section headers 11–12pt bold, field labels 9–10pt, field values 10–11pt, footer 8pt |

Every document type below is specified against: **Purpose, Target User, Paper Size, Orientation, Print Margins, Header, Footer, QR Code Placement, Tracking Number Placement, Brand Logo Placement, Signature Areas, Date Format, Typography.** Where a document matches the Shared Document Standards exactly, its table says so rather than repeating the values.

---

## Version 1 Document Types

### 1. Service Request

_Given to the customer when they drop off a product — replaces a handwritten intake slip. Document number: `service_jobs.service_request_number` (`SR-{YYYY}-{SEQUENCE}`), generated at service job creation ([BUSINESS_RULES.md](BUSINESS_RULES.md))._

| Attribute                                                     | Value                                                                                                      |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Purpose                                                       | Formal record of intake: what was received, from whom, in what condition, and what the customer authorized |
| Target User                                                   | Customer (receives a copy) and Service Staff (files a copy)                                                |
| Paper Size / Orientation                                      | A4, portrait                                                                                               |
| Print Margins / Header / Footer / QR / Tracking Number / Logo | Shared default                                                                                             |
| Signature Areas                                               | Two columns: **Customer Signature** and **Staff Signature** (name, signature, date each)                   |
| Date Format                                                   | Customer-facing → DD/MM/YYYY + Buddhist Era                                                                |
| Typography                                                    | Shared default                                                                                             |

**Included Fields** (all now sourced from real schema entities — see [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md)):

| Field                       | Source                                                                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Tracking Number             | `service_jobs.tracking_number`                                                                                                          |
| Document Number             | `service_jobs.service_request_number`                                                                                                   |
| QR Code                     | derived, not stored                                                                                                                     |
| Brand                       | `service_jobs.brand_id` → `brands`                                                                                                      |
| Customer (name/phone/email) | `service_jobs.customer_id` → `customers`                                                                                                |
| Marketplace Username        | `customers.id` → `customer_channel_contacts` where `purpose = 'purchase'`                                                               |
| Order Number                | `service_jobs.product_instance_id` → `product_instances.order_reference`                                                                |
| Purchase Channel            | `product_instances.purchase_channel`                                                                                                    |
| Product                     | `product_instances.model_id` → `models` → `products.name`                                                                               |
| Model                       | `product_instances.model_id` → `models.model_code` (or `product_instances.model_other` if the instance used the free-text escape hatch) |
| Serial Number               | `product_instances.serial_number`                                                                                                       |
| Warranty Type               | `product_instances.warranty_type`                                                                                                       |
| Problem Description         | `service_jobs.issue_summary` / `service_jobs.description`                                                                               |
| Accessories Included        | `service_job_accessories` (+ `service_jobs.accessories_other` free text)                                                                |
| Photos Stored in System     | `photos` table, filtered to customer-visible                                                                                            |
| Received Date               | `service_jobs.created_at`                                                                                                               |
| Expected Return Date        | `service_jobs.estimated_completion_date`                                                                                                |
| Technician                  | `service_jobs.technician_id` → `users` (may be "Unassigned" at intake)                                                                  |
| Customer Signature          | Captured at print/intake time — not a stored data field                                                                                 |
| Staff Signature             | Same as above                                                                                                                           |

No open schema gaps remain for this document — every field maps to an existing entity.

**Layout notes:** Header → Customer info block → Product info block (Product / Model / Serial / Warranty Type) → Problem description block → Accessories checklist → Photo thumbnail grid → dual signature block.

---

### 2. Repair Report

_Internal document, typically sent to or shared with a factory/repair partner. A service job may have multiple Repair Reports over its lifetime ([DECISIONS.md](DECISIONS.md) #012, #016). Document number: `repair_reports.report_number` (`FR-{YYYY}-{SEQUENCE}`), generated per report._

| Attribute                                                     | Value                                                                                                                        |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Purpose                                                       | Communicate diagnosis and repair work to a factory/repair partner, and record the outcome for internal approval              |
| Target User                                                   | Service Staff / Technician (author), Factory/repair partner (recipient), Admin (approver)                                    |
| Paper Size / Orientation                                      | A4, portrait                                                                                                                 |
| Print Margins / Header / Footer / QR / Tracking Number / Logo | Shared default (still applies even for an internal document — it should link back to the service job)                        |
| Signature Areas                                               | Two columns: **Technician** and **Approval** (approver name, signature, date) — no customer signature; internal/B2B document |
| Date Format                                                   | **Internal document → Gregorian only**                                                                                       |
| Typography                                                    | Shared default                                                                                                               |

**Included Fields:**

| Field             | Source                                                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Tracking Number   | `service_jobs.tracking_number` (parent job)                                                                                              |
| Document Number   | `repair_reports.report_number`                                                                                                           |
| Attempt Number    | `repair_reports.attempt_number`                                                                                                          |
| Product           | `product_instances` → `models` → `products`                                                                                              |
| Problem Summary   | `service_jobs.issue_summary`                                                                                                             |
| Diagnosis         | `repair_reports.diagnosis`                                                                                                               |
| Repair Action     | `repair_reports.repair_action_summary`                                                                                                   |
| Parts Replaced    | `repair_parts` (part name / part number / qty / unit cost), joined on this `repair_report_id`                                            |
| Repair Cost       | `repair_reports.cost`                                                                                                                    |
| Warranty Decision | `repair_reports.warranty_decision` (covered / chargeable / pending) — distinct from the unit's overall `product_instances.warranty_type` |
| Photos            | `photos`, may include internal-only images via `attachments`                                                                             |
| Technician        | `repair_reports.created_by` → `users`                                                                                                    |
| Approval          | `repair_report_approvals` — latest `decision`/`approver_id`/`decided_at`; full history available if a prior attempt was rejected         |

No open schema gaps remain for this document.

**Layout notes:** Header → Product/problem summary → Diagnosis → Repair action → Parts replaced table → Cost & warranty decision → Photo grid → Technician/Approval signature block.

**Current implementation note (N7.4, 2026-09-27):** the current
`ServiceReportPrintPreview` is backed by the Firestore/Worker Service Report
model rather than the historical relational field names above. Before the
preview opens, the staff UI calls the trusted-print contract. V2 draft,
pending, approved, rejected, and integrity-incident states are rendered
separately, as is legacy V1. Warranty outcome and any terminal approval
decision shown in the printable document come from the trusted server result.
An approved report with missing required evidence is available only in
diagnostic view and the print/PDF action is disabled. This source integration
does not constitute a production deployment.

---

### 3. Product Return Form

_Given to the customer when a repaired product is physically returned and the Service Job completes. Decision #049 is the authoritative V1 contract. N7.6 implements this document and `returnFormNumber` source-side; Worker/Rules production deployment remains a separate phase._

| Attribute                                                | Value                                                                                                                                                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Purpose                                                  | Confirm what repair was performed, the trusted warranty outcome, the handover date, and that customer and staff acknowledged the returned product                                                            |
| Target User                                              | Customer (receives a copy) and Service Staff (files a copy)                                                                                                                                                  |
| Eligibility                                              | Service Job status must be **Completed** and the latest Service Report in documentary order must pass the normal trusted-print contract as **`v2-approved`**                                                 |
| Paper Size / Orientation                                 | A4, portrait                                                                                                                                                                                                 |
| Print Margins / Header / Footer / Tracking Number / Logo | Shared default                                                                                                                                                                                               |
| QR Code                                                  | Never issued/rotated by printing. Show only when an already-issued raw Public Tracking credential is legitimately available to the current browser flow; otherwise render a safe unavailable/inactive notice |
| Signature Areas                                          | Two columns: **Customer Signature** and **Staff Handover Signature** (name, signature, date each). These are physical capture areas and are not persisted as digital signatures in V1                        |
| Date Format                                              | Customer-facing → DD/MM/YYYY + Buddhist Era                                                                                                                                                                  |
| Typography                                               | Shared default                                                                                                                                                                                               |

**Numbering and completion contract:**

- Document number is `RT-{YYYY}-{SEQUENCE}`, stored as the target `service_jobs.return_form_number` / application `returnFormNumber`.
- Allocate exactly once on the **first trusted transition to Completed**, in the same backend transaction that establishes the trusted completion timestamp. The year is the Asia/Bangkok calendar year of that timestamp.
- The allocation uses the brand-scoped `return_form` sequence and is immutable. Retry/replay returns the already-allocated number instead of consuming a second logical number.
- `Cancelled` and `Rejected` also close a Service Job for retention purposes, but **must not** allocate or authorize a Product Return Form.

**Included Fields:**

| Field                    | Source / rule                                                                                                                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tracking Number          | Current Service Job tracking reference                                                                                                                                                                           |
| Document Number          | Trusted `returnFormNumber` allocated by the completion transaction                                                                                                                                               |
| Customer / Product       | Current Service Job identity fields used for the handover                                                                                                                                                        |
| Repair Summary           | Latest eligible trusted V2 report: `inspectionFindings`, `serviceActions`, `resultStatus`, and `resultDetail`; the UI may present these compactly but must not invent content                                    |
| Replacement Parts        | `parts` from that same trusted V2 report                                                                                                                                                                         |
| Warranty Result          | `warrantyOutcome` from that same trusted V2 report                                                                                                                                                               |
| Approval / Verification  | Normal trusted-print result must be `v2-approved`; its verified approval metadata may be displayed in business-safe form. Raw UIDs, digests, canonical R2 keys, and provider/internal error text must not appear |
| Customer Acceptance Time | Trusted Service Job `closedAt`, but only when the job is `Completed`. In V1 this same event means pickup/acceptance/closure                                                                                      |
| Customer Signature       | Physical signature area on the printed/PDF document; not stored                                                                                                                                                  |
| Staff Handover Signature | Physical signature area on the printed/PDF document; not stored                                                                                                                                                  |
| Return Date              | Same trusted Completed `closedAt`, formatted customer-facing with Buddhist Era                                                                                                                                   |
| Price / Cost             | **Not printed in V1.** Do not infer a financial amount from quote or report fields                                                                                                                               |

**Fail-closed cases:** no Return Form preview/print for legacy V1 reports, V2 drafts, pending approval, rejected approval, integrity incidents, a missing/invalid RT number, a non-Completed Service Job, or a latest report that differs from the trusted server result.

**Layout notes:** Header → customer/product identity → compact repair summary → replacement parts table (if any) → warranty/approval verification → customer acceptance statement + return date → two-column customer/staff signatures. Keep the document distinct from `DeliveryNotePrintPreview.tsx`, which is a general handover note rather than proof of a completed approved repair.

---

## Future Document Types (not specified in V1)

| #   | Document               | Purpose (directional only)                                                                                                                                                                                 |
| --- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4   | Replacement Form       | Used when a product is replaced outright rather than repaired — would likely link two `product_instances` (old unit retired, new unit issued) rather than needing new modeling beyond what already exists. |
| 5   | Spare Part Report      | Internal parts-inventory reporting — now has a natural data source in `repair_parts`, introduced by the Repair Report relationship model.                                                                  |
| 6   | Monthly Service Report | Aggregate/analytics report across service jobs for a period — a reporting document, not a single-job document; different structure from the three above (no tracking number/QR header pattern applies).    |

## General Print Rules

- A4 paper for all V1 documents.
- Rendered via browser `@media print` CSS — no PDF generation library.
- Printer-friendly: minimal color, legible in black & white.
- Thai Buddhist Era on all customer-facing documents; Gregorian-only on internal/factory documents.
- Tracking Number and QR Code always appear in the top-right area of every document.
- No interactive chrome renders in print output.

## Print Engine Architecture (Future-Proofing)

- **Brand-specific templates, one data model.** Bruno Thailand and Join Lux Club should be able to use visually distinct print templates while pulling from the same schema. Template selection should key off `service_jobs.brand_id`.
- **Recommendation for Sprint 8:** per-brand print template configuration is a plausible fit for the existing `settings` table (brand-scoped `key`/`value` jsonb) rather than a new table — not a decision made now.
- **Document numbering already generalizes cleanly** across current and future document types via the shared `number_sequences` mechanism ([DECISIONS.md](DECISIONS.md) #014) — a new document type (e.g. Replacement Form) needs only a new `document_type` value, not a schema change.

## Data Requirements Introduced By This Spec

The historical relational design established the intended document families and counters, while the current Firestore application source has since evolved to a Worker-backed Service Report V2 approval model. N7.5 / Decision #049 closes the remaining Product Return Form semantics before implementation:

| Item                          | V1 decision                                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Customer acceptance timestamp | Reuse the trusted `closedAt` only when the Service Job is `Completed`; pickup, acceptance, and closure are one V1 event                                            |
| Staff countersignature        | Required as a physical signature area beside the Customer Signature; neither signature is stored digitally in V1                                                   |
| Repair/warranty source        | Latest documentary Service Report must be normal trusted-print `v2-approved`; use that same trusted report for summary, parts, warranty, and approval verification |
| Financial amount              | Not part of the V1 Product Return Form; no quote/final-cost reconciliation is performed or printed                                                                 |
| RT document number            | Trusted backend allocation on first Completed transition; immutable and replay-safe; implemented source-side in N7.6, with production deployment separate          |
| Legacy/unsafe report states   | Legacy V1, draft, pending, rejected, and integrity-incident reports are not Return Form eligible                                                                   |

There are therefore **no unresolved Product Return Form business semantics blocking source implementation**. A future business decision is required only if pickup and formal acceptance later become separate events, if a legacy-report exception is desired, or if money/payment information is added to this document family.

## Open Questions

No V1 Product Return Form question remains open after Decision #049. Broader future print questions (brand-specific templates, receipt/invoice/payment documents, replacement documents, real-browser print-pagination certification) remain separate scopes and must not be silently folded into Return Form implementation.
