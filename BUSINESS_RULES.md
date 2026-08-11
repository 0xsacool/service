# Business Rules

> The operational rules the system must enforce, independent of any specific implementation. When code and this document disagree, this document wins unless it's updated first — see [DECISIONS.md](DECISIONS.md) for how rule changes get recorded.
>
> **Terminology:** the core business entity is the **Service Job** (a single repair event), not "Claim" — see [DECISIONS.md](DECISIONS.md) #009. A **Customer** may have multiple Service Jobs; a **Product Instance** (a specific physical unit) may also accumulate multiple Service Jobs over its lifetime — see `DATABASE_SCHEMA.md`.

## Tracking Number Generation

**Format:** `{BRAND_CODE}-{YYYY}-{SEQUENCE}`

- `BRAND_CODE` — from `brands.code` (e.g. `BRN` for Bruno Thailand, `JLC` for Join Lux Club).
- `YYYY` — four-digit year the service job was created.
- `SEQUENCE` — zero-padded **6-digit** number, resets to `000001` each year, per brand.

**Examples:** `BRN-2026-000123`, `JLC-2026-000456`.

**Rules:**
- Tracking numbers are immutable once assigned — never reused, never edited.
- Uniqueness is enforced at the database level (`service_jobs.tracking_number` unique index).
- The tracking number is the only credential a customer needs to look up a service job — treat it as semi-sensitive.

## Document Number Generation

Distinct from the tracking number — see [DECISIONS.md](DECISIONS.md) #014. Each printed document type gets its own independently generated sequence via the shared `number_sequences` mechanism (`DATABASE_SCHEMA.md`), so a service job with multiple repair attempts doesn't collide on a single shared number.

| Document | Prefix | Format | Generated when |
|---|---|---|---|
| Service Request | `SR` | `SR-{YYYY}-{SEQUENCE}` | at service job creation |
| Factory Service Report | `FR` | `FR-{YYYY}-{SEQUENCE}` | each time a repair report is created (a job may generate several) |
| Product Return Form | `RT` | `RT-{YYYY}-{SEQUENCE}` | at service job completion/return |

Document numbers **do not** carry the brand code — only the tracking number does. Brand separation for document numbering is still enforced internally (each brand has its own counter per document type per year, avoiding cross-brand collisions and supporting per-brand reporting); it's simply not part of the printed prefix, since every document already carries its parent service job's brand-coded tracking number for cross-reference.

## Service Job Status Flow

**Statuses, in order:**

1. **Received** — service job logged, product in hand.
2. **Diagnosing** — staff assessing the issue.
3. **Awaiting Parts** — diagnosis complete, waiting on parts.
4. **In Repair** — active repair work.
5. **Quality Check** — repair complete, verification in progress.
6. **Ready for Pickup** — verified, waiting for customer.
7. **Completed** — picked up, service job closed.

**Exception states:**

- **Cancelled** — withdrawn before completion.
- **Rejected** — customer declined a quote, or repair determined not viable.

**Rules:**
- Status only moves forward through the numbered sequence, except that any status can transition to **Cancelled** or **Rejected**, and those are terminal.
- Every status change creates a new `timeline_events` row — append-only, never edited or deleted.
- A service job reaching **Completed**, **Cancelled**, or **Rejected** sets `closed_at` and is closed; closed service jobs should not be editable except by an Admin.

## Intake Workflow & Required Fields

Creating a service job is now a **lookup-or-create** flow against two master records, not a single flat form:

1. **Find or create the Customer** — staff search by phone (or name); if no match, create a new `customers` record (full name, phone required; email optional).
2. **Find or create the Product Instance** — staff search by serial number (if legible); if no match, create a new `product_instances` record: select brand → product → model (or use the `model_other` free-text escape hatch if not in the catalog), enter serial number if available, purchase channel/order reference/purchase date if known, and warranty type/dates if determinable at intake.
3. **Create the Service Job** — linked to the resolved customer and product instance: issue summary and detailed description (required), priority (defaults Normal), accessories brought in (checklist from the product's accessory master, plus free text for anything not listed).

**Required at Service Job creation:**
- Resolved `customer_id` (existing or newly created customer with name + phone)
- Resolved `product_instance_id` (existing or newly created instance, at minimum brand/product/model-or-model_other)
- Issue summary
- Detailed description

**Optional:**
- Serial number (see history-linkage note below)
- Accessories
- Warranty details (may be unknown at intake, refined during diagnosis)

**Service history linkage depends on serial number.** When a product instance has no recorded serial number, the system cannot automatically recognize "this is the same unit as a prior visit" — each such drop-off is effectively a new, unlinked instance. Staff should be prompted to capture a serial number whenever one is physically present, precisely to preserve the lifetime service history that `product_instances` exists to provide.

## Permissions

| Action | Admin | Service Staff | Customer |
|---|---|---|---|
| View service jobs across all brands | ✅ | ❌ (own brand only) | ❌ |
| View service jobs within own brand | ✅ | ✅ | ❌ |
| View own service job via tracking number | — | — | ✅ |
| Create/edit Customer records | ✅ | ✅ | ❌ |
| Create/edit Product Instance records | ✅ | ✅ | ❌ |
| Create a service job | ✅ | ✅ | ❌ |
| Update service job status | ✅ | ✅ | ❌ |
| Edit a closed service job | ✅ | ❌ | ❌ |
| Create/approve Repair Reports | ✅ | ✅ (create); Admin or designated approver (approve) | ❌ |
| Add internal notes | ✅ | ✅ | ❌ |
| View internal notes | ✅ | ✅ | ❌ |
| Upload photos/attachments | ✅ | ✅ | ❌ |
| View customer-visible photos/attachments | ✅ | ✅ | ✅ (own service job only) |
| Manage brands/settings | ✅ | ❌ | ❌ |
| Manage staff accounts | ✅ | ❌ | ❌ |

Brand scoping applies to every Service Staff permission above: a staff account tied to `brand_id = X` can only see/act on customers, product instances, and service jobs where `brand_id = X`. Enforced at the database level via Row-Level Security (Sprint 3), not only hidden in the UI.

## Photo Requirements

- At least one intake photo is **recommended** but not strictly required.
- Additional photos may be added by staff at any stage.
- Photos default to **customer-visible**; anything sensitive should be filed as an `attachment` with `visibility = internal` instead.

## Timeline Behavior

- A `timeline_events` row is created automatically whenever `service_jobs.status` changes.
- Exactly one timeline event per service job has `is_current = true` at any time.
- Timeline events are **append-only** — a correction creates a new event rather than editing history.
- Timestamps stored in UTC, displayed in Asia/Bangkok, formatted DD/MM/YYYY.

## Customer Visibility

**Visible to a customer looking up their own service job:**
- Tracking number, product (name/model), issue summary, current status, full timeline, estimated completion date, customer-visible photos, assigned technician's name, service center contact info.

**Never visible to a customer:**
- Internal notes.
- Attachments marked `internal` visibility.
- Repair report diagnosis/internal cost breakdown before a quote is approved.
- Other customers' service jobs, product instances, or contact identities — lookup is scoped strictly to the exact tracking number provided.

## Internal Notes

- Visible to Admin and Service Staff only, never surfaced through any customer-facing view.
- Attributed and timestamped; not editable after creation — add a new note to correct/update.
- Not a substitute for a proper timeline event.

## Repair Reports & Approval

- A service job may have **multiple** repair reports over its lifetime (e.g. a second factory round-trip after a failed first attempt) — see `DATABASE_SCHEMA.md`.
- Each repair report's approval decision is recorded as an **append-only log** (`repair_report_approvals`), not overwritten — if a report is rejected and resubmitted, both decisions remain visible.
- `repair_reports.warranty_decision` (is *this* repair covered) is distinct from `product_instances.warranty_type` (the unit's overall warranty status) — a unit can be within its warranty window while a specific repair is still ruled chargeable (e.g. accidental damage), or vice versa in edge cases requiring manual override.
