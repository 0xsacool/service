# Database Schema

> **Two different things live in this document now, clearly separated below.** The `products` collection (Implementation Status section immediately below) is **real and live** in Firestore today, behind an opt-in config flag. Everything else — `brands`, `users`, `customers`, `service_jobs`, and the rest — is still **design only**: no tables/collections exist yet for them, in Supabase, Firestore, or anywhere. Column types in that design section are illustrative (Postgres-flavored, matching the original Supabase-based target) to make the design concrete, not a literal migration script — and, per Implementation Status below, that target itself is now an open question rather than a settled one.
>
> **Terminology:** the core business entity is **Service Job** (table `service_jobs`), not "Claim" — see [DECISIONS.md](DECISIONS.md) #009. The code-level rename is complete (see [PROJECT_STATE.md](PROJECT_STATE.md)); this document's entity design predates and anticipated that rename.

## Implementation Status

**Product Master is the only entity below with a real, working backend**, and it doesn't follow the relational design in this document at all — it's a Firestore collection, introduced in Sprints F0–F2.1, well after this document's original Postgres/Supabase-oriented design was written. This section documents what's actually running; the rest of this file (Entities onward) documents the still-unbuilt relational target for everything else.

### `products` (Firestore collection) — **live**

Backing implementation: `src/repositories/firestoreProductMasterRepository.ts`, field mapping in `src/repositories/firestore/productMasterMapping.ts`. Selected only when `VITE_BACKEND_KIND=firestore`; the Mock `productMasterRepository` (backed by `src/repositories/mockData/productMaster.mock.ts`) is the default and remains fully independent — both implement the same `ProductMasterRepository` interface (`src/repositories/types.ts`).

**Document ID:** the product's `id` (same string identifier used by the Mock implementation — not a Firestore auto-ID).

**Document fields:**

| Field | Type | Notes |
|---|---|---|
| `brand` | string | e.g. `"Bruno Thailand"` |
| `categoryId` | string | references a `ProductCategory.id` (categories themselves are not Firestore-backed — `getCategories()` still reads the Mock category list even in `firestore` mode) |
| `model` | string | |
| `sku` | string \| null | `null` when absent, not an omitted field — set by the Import Framework; manually-added products (no import) may not have one |
| `productName` | string | maps to `ProductMasterEntry.name` in application code — deliberately renamed at the persistence boundary, not a typo |
| `status` | `'Active' \| 'Legacy'` | |
| `warrantyMonths` | number | |
| `accessoryIds` | string[] | references `AccessoryDefinition.id` — the accessory/common-problem catalogs themselves are still Mock-only, same as categories |
| `commonProblemIds` | string[] | references `CommonProblemDefinition.id` |
| `createdAt` | Firestore `serverTimestamp()` | set once, on create |
| `updatedAt` | Firestore `serverTimestamp()` | set on every create/update |

**Deliberately excluded:** `variant` (exists on the Mock-side `ProductMasterEntry` type but is outside the Firestore field contract — dropped on write, always `undefined` on read from Firestore). There is no `deleteProduct` — delete is explicitly out of scope for the current Product Master architecture (not a gap, a decision).

**Migration strategy:** `src/repositories/migrations/seedProductMasterFromMock.ts` runs automatically the first time the Firestore repository is constructed (i.e. the first time `firestore` mode is selected against a given project). It checks whether `products` is empty via a `limit(1)` query — if genuinely empty, it copies every entry from the Mock fixture (`productMasterEntries`) into Firestore via a single atomic `writeBatch`; if not empty, it does nothing. This makes the migration **idempotent by construction** — running the app repeatedly, or across multiple tabs, never duplicates data, and there is no separate migration script to run by hand.

**Mock/Firestore split:** `BackendKind` (`src/config/backend.ts`, resolved from `VITE_BACKEND_KIND`) currently affects **only** `productMaster`. Every other repository field on `RepositoryProvider` — `serviceJobs`, `customers`, `products`, `search`, `registeredProducts`, `productKnowledge` — is the Mock implementation regardless of `BackendKind`. If Firestore initialization fails for any reason, the whole provider falls back to all-Mock for that session rather than partially failing (see [DECISIONS.md](DECISIONS.md) #021).

**Open question this creates:** the relational design below (Entities section) was written assuming Supabase/Postgres as the eventual backend for every entity, including a future `products`/`models` table pair. The entity actually built (Firestore `products`) doesn't match that design — it's a flatter, denormalized document per product, with no separate `models` collection, and no relational FKs. Whether Customers, Service Jobs, etc. also end up on Firestore (in which case the schema below needs a real redesign for a document database, not just a syntax translation) or whether Supabase is still intended for some/all of them is **not decided** — flagged here rather than resolved unilaterally. See the Sprint F2.2 completion report's Remaining Gaps.

---

## Design Target (Not Yet Implemented)

Everything from here down is the pre-Firestore, Supabase/Postgres-oriented design for entities that don't exist in any real database yet. Treat it as a design reference for a relational backend, contingent on the open question above being resolved.

## Design Principles

- **Brand is first-class.** [DECISIONS.md](DECISIONS.md) #002. `service_jobs`, `customers`, `products`, and `settings` all relate back to a brand.
- **Auth belongs to Supabase.** `users` represents an extension/profile table 1:1 with Supabase's built-in `auth.users`, not a custom credentials table.
- **Customers are a real master record (V1 revision).** Originally V1 planned to look up claims without a customer table; that's superseded by [DECISIONS.md](DECISIONS.md) #011 — a customer can now have multiple service jobs, and marketplace/contact identities belong to the customer, not to any single job.
- **Physical products are tracked as instances.** A `product_instances` row represents one physical unit (ideally identified by serial number) and accumulates service history across every service job performed on it over its lifetime — [DECISIONS.md](DECISIONS.md) #012.
- **Ownership chain:** `brands` → `products` (product line) → `models` (SKU/variant) → `product_instances` (the physical unit) → `service_jobs` (a repair event for that unit, owned by a `customer`).
- **Photos and attachments are distinct.** `photos` = repair/damage documentation for a specific service job. `attachments` = other files (receipts, warranty documents, PDFs) with explicit internal/customer visibility.
- **Timestamps are stored in UTC**, displayed in Asia/Bangkok per [DECISIONS.md](DECISIONS.md) #003. Currency is stored as a decimal amount plus a currency code (`THB` default).

---

## Entities

### `brands`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **Primary Key** |
| `name` | text | e.g. "Bruno Thailand" |
| `code` | text | Short unique code, e.g. `BRN`, `JLC` — used in the tracking number |
| `logo_url` | text | nullable |
| `primary_color` | text | nullable |
| `contact_phone` | text | nullable |
| `contact_email` | text | nullable |
| `address` | text | nullable |
| `timezone` | text | default `Asia/Bangkok` |
| `created_at` | timestamptz | default now() |

**Indexes:** unique index on `code`.

---

### `users`

Extends Supabase `auth.users` — one row per authenticated staff/admin account.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **Primary Key**, **FK → auth.users.id** |
| `brand_id` | uuid | **FK → brands.id**, nullable (Admins may be cross-brand) |
| `full_name` | text | |
| `phone` | text | nullable |
| `role` | enum(`admin`, `staff`) | |
| `status` | enum(`active`, `disabled`) | default `active` |
| `created_at` | timestamptz | default now() |

**Indexes:** index on `role`; index on `brand_id`.

---

### `customers`

**New in this revision** ([DECISIONS.md](DECISIONS.md) #011). A customer can have multiple service jobs across time, and holds their own contact/marketplace identities rather than those living on a single job.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **Primary Key** |
| `brand_id` | uuid | **FK → brands.id**, not null |
| `full_name` | text | |
| `phone` | text | primary contact number |
| `email` | text | nullable |
| `created_at` | timestamptz | default now() |

**Indexes:** index on (`brand_id`, `phone`) for staff lookup at intake.

**Design call — flagged for confirmation, not blocking:** `customers` is scoped per-brand (a person who buys from both Bruno Thailand and Join Lux Club gets two separate customer records), matching the brand-first principle and avoiding unintended cross-brand data sharing without an explicit consent/merge decision (relevant under Thailand's PDPA). If a unified cross-brand customer view is actually wanted, this should be a deliberate follow-up decision, not a default.

**No hard uniqueness constraint on phone** — a shared household phone is plausible; deduplication is a staff-driven process (search before creating), not a database constraint.

---

### `customer_channel_contacts`

**New in this revision.** A customer's identity on a marketplace or contact channel — stable across all of their service jobs, which is why it belongs here and not on `service_jobs` or `product_instances` (superseding the earlier `claim_channel_contacts` design in the prior revision of this document).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **Primary Key** |
| `customer_id` | uuid | **FK → customers.id**, not null |
| `channel` | text | `shopee` \| `lazada` \| `tiktok_shop` \| `facebook` \| `line` \| `store` \| `website` \| `other` — validated at the application layer, not a rigid DB enum, so a new marketplace doesn't require a migration |
| `identity_value` | text | e.g. Shopee username, LINE ID, Facebook name |
| `purpose` | enum(`purchase`, `contact`) | distinguishes "identity used to buy" from "channel used to reach them" — the same platform (e.g. LINE) can serve either or both |
| `created_at` | timestamptz | default now() |

**Indexes:** index on `customer_id`.

---

### `products`

Brand-scoped product line (not a specific SKU/variant — that's `models`).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **Primary Key** |
| `brand_id` | uuid | **FK → brands.id**, not null |
| `name` | text | e.g. "Compact Hot Plate" |
| `category` | text | e.g. "Kitchen Appliance" |
| `created_at` | timestamptz | default now() |

**Indexes:** index on `brand_id`.

---

### `models`

A specific SKU/variant under a product line.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **Primary Key** |
| `product_id` | uuid | **FK → products.id**, not null |
| `model_code` | text | e.g. `BOE021` |
| `variant_name` | text | nullable, e.g. a color variant |
| `created_at` | timestamptz | default now() |

**Indexes:** index on `product_id`.

---

### `product_instances`

**New in this revision** ([DECISIONS.md](DECISIONS.md) #012). Represents one physical unit — the anchor for tracking a product's full service history across multiple service jobs over its lifetime.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **Primary Key** |
| `model_id` | uuid | **FK → models.id**, nullable — see escape hatch below |
| `model_other` | text | nullable free-text fallback when no catalog model matches (mirrors the intake escape-hatch pattern used elsewhere in this schema) |
| `serial_number` | text | nullable — not every product carries a legible serial; see Business Rules for the history-linkage implication when absent |
| `customer_id` | uuid | **FK → customers.id**, nullable — the currently registered owner |
| `purchase_channel` | text | same validated value set as `customer_channel_contacts.channel`; where this specific unit was bought |
| `order_reference` | text | nullable — the marketplace/store order number for this specific purchase |
| `purchase_date` | date | nullable |
| `warranty_type` | enum(`manufacturer`, `extended`, `none`, `unknown`) | replaces the earlier boolean `warranty` flag design |
| `warranty_start_date` | date | nullable |
| `warranty_end_date` | date | nullable |
| `created_at` | timestamptz | default now() |

**Indexes:** unique index on `serial_number` where not null (allows multiple instances with no recorded serial); index on `customer_id`; index on `model_id`.

**Why purchase/order/warranty data moved here (not on `service_jobs`):** these describe the physical unit itself, determined once at the point of purchase. Storing them per service job would duplicate — and risk contradicting — the same facts every time the same unit comes in for a second repair.

---

### `service_jobs`

The core operational entity — one repair event for a specific product instance, brought in by a specific customer. (Renamed from `claims` — [DECISIONS.md](DECISIONS.md) #009.)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **Primary Key** |
| `tracking_number` | text | **Unique.** `{BRAND_CODE}-{YYYY}-{SEQUENCE}`, e.g. `BRN-2026-000123` — see `BUSINESS_RULES.md` |
| `service_request_number` | text | **Unique.** Independently generated document number for the printed Service Request — see `BUSINESS_RULES.md` / `PRINT_SPECIFICATIONS.md` |
| `return_form_number` | text | nullable until the job closes; independently generated document number for the printed Return Form |
| `brand_id` | uuid | **FK → brands.id**, not null — denormalized from the customer/product instance at creation time for simpler, faster brand-scoped RLS policies |
| `customer_id` | uuid | **FK → customers.id**, not null — who brought the unit in on this occasion (should usually, but not necessarily always, match `product_instances.customer_id` — e.g. someone repairing on a friend's behalf) |
| `product_instance_id` | uuid | **FK → product_instances.id**, not null |
| `issue_summary` | text | specific to this repair event |
| `description` | text | specific to this repair event |
| `status` | enum | see status list in `BUSINESS_RULES.md` (includes `Cancelled`/`Rejected`) |
| `priority` | enum(`low`, `normal`, `high`, `urgent`) | |
| `technician_id` | uuid | **FK → users.id**, nullable (unassigned) |
| `quote_amount` | numeric | nullable |
| `currency` | text | default `THB` |
| `estimated_completion_date` | date | nullable |
| `created_by` | uuid | **FK → users.id** — staff who logged the job |
| `created_at` | timestamptz | default now() |
| `updated_at` | timestamptz | default now(), updated on change |
| `closed_at` | timestamptz | nullable — set when status reaches a terminal state |

**Indexes:** unique index on `tracking_number`; unique index on `service_request_number`; index on `brand_id`; index on `status`; index on `customer_id`; index on `product_instance_id`.

**No more raw `customer_name`/`customer_phone`/`customer_email`/`product_name`/`serial_number` fields** — those are superseded by the `customer_id` and `product_instance_id` relationships.

---

### `service_job_accessories`

What was actually brought in with the product at intake — specific to this drop-off, since a customer may not bring every accessory every time even for the same product instance. (Renamed from `claim_accessories`.)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **Primary Key** |
| `service_job_id` | uuid | **FK → service_jobs.id**, not null |
| `accessory_id` | uuid | **FK → accessories.id**, not null |
| `created_at` | timestamptz | default now() |

Plus `service_jobs.accessories_other` (text, nullable) as the free-text escape hatch for anything not in the accessory master.

**Indexes:** index on `service_job_id`.

---

### `accessories`

Master list of accessory types.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **Primary Key** |
| `name` | text | e.g. "Power Cable", "Grill Plate", "Manual" |
| `created_at` | timestamptz | default now() |

---

### `product_accessories`

Defines which accessories are typically expected for a given product line.

| Column | Type | Notes |
|---|---|---|
| `product_id` | uuid | **FK → products.id** |
| `accessory_id` | uuid | **FK → accessories.id** |

**Primary Key:** composite (`product_id`, `accessory_id`).

---

### `repair_reports`

A single service job may have multiple repair reports over its lifetime (e.g. a second factory round-trip after a failed first attempt).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **Primary Key** |
| `service_job_id` | uuid | **FK → service_jobs.id**, not null |
| `report_number` | text | **Unique.** Independently generated document number, e.g. `FR-2026-000078` |
| `attempt_number` | integer | 1, 2, 3… within this service job |
| `diagnosis` | text | |
| `repair_action_summary` | text | |
| `cost` | numeric | nullable |
| `warranty_decision` | enum(`covered`, `chargeable`, `pending`) | whether *this repair* is covered — distinct from the unit's overall `warranty_type` on `product_instances` |
| `status` | enum(`draft`, `submitted`, `approved`, `rejected`) | |
| `created_by` | uuid | **FK → users.id** |
| `created_at` | timestamptz | default now() |

**Indexes:** unique index on `report_number`; index on `service_job_id`.

---

### `repair_parts`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **Primary Key** |
| `repair_report_id` | uuid | **FK → repair_reports.id**, not null |
| `part_name` | text | |
| `part_number` | text | nullable |
| `quantity` | integer | default 1 |
| `unit_cost` | numeric | nullable |

**Indexes:** index on `repair_report_id`.

---

### `repair_report_approvals`

Append-only approval log — supports a report being rejected and resubmitted without losing that history, consistent with the append-only pattern already used for `timeline_events`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **Primary Key** |
| `repair_report_id` | uuid | **FK → repair_reports.id**, not null |
| `approver_id` | uuid | **FK → users.id** |
| `decision` | enum(`approved`, `rejected`) | |
| `decided_at` | timestamptz | |
| `notes` | text | nullable |

**Indexes:** index on `repair_report_id`.

---

### `timeline_events`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **Primary Key** |
| `service_job_id` | uuid | **FK → service_jobs.id**, not null |
| `status` | enum | the status this event represents |
| `title` | text | |
| `description` | text | |
| `occurred_at` | timestamptz | |
| `is_current` | boolean | exactly one true per service job at any time |
| `created_by` | uuid | **FK → users.id** |

**Indexes:** index on `service_job_id`.

---

### `photos`

Repair/damage documentation photos, customer-visible by default.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **Primary Key** |
| `service_job_id` | uuid | **FK → service_jobs.id**, not null |
| `storage_path` | text | |
| `caption` | text | nullable |
| `sort_order` | integer | default 0 |
| `uploaded_by` | uuid | **FK → users.id** |
| `uploaded_at` | timestamptz | default now() |

**Indexes:** index on `service_job_id`.

---

### `attachments`

Other files — receipts, warranty documents, PDFs.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **Primary Key** |
| `service_job_id` | uuid | **FK → service_jobs.id**, not null |
| `file_name` | text | |
| `storage_path` | text | |
| `file_type` | text | MIME type |
| `visibility` | enum(`internal`, `customer`) | default `internal` |
| `uploaded_by` | uuid | **FK → users.id** |
| `uploaded_at` | timestamptz | default now() |

**Indexes:** index on `service_job_id`.

---

### `notes`

Internal staff notes — never exposed via the public tracker.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **Primary Key** |
| `service_job_id` | uuid | **FK → service_jobs.id**, not null |
| `author_id` | uuid | **FK → users.id** |
| `text` | text | |
| `created_at` | timestamptz | default now() |

**Indexes:** index on `service_job_id`.

---

### `settings`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **Primary Key** |
| `brand_id` | uuid | **FK → brands.id**, nullable = global setting |
| `key` | text | |
| `value` | jsonb | |
| `description` | text | nullable |
| `updated_at` | timestamptz | default now() |

**Indexes:** unique index on (`brand_id`, `key`).

---

### `number_sequences`

Shared atomic counter backing every document number (`tracking_number`, `service_request_number`, `return_form_number`, `repair_reports.report_number`) so one generation mechanism serves all document types rather than one-off logic per type.

| Column | Type | Notes |
|---|---|---|
| `brand_id` | uuid | **FK → brands.id** |
| `document_type` | text | `tracking_number` \| `service_request` \| `return_form` \| `repair_report` |
| `year` | integer | |
| `current_value` | integer | last issued sequence number for this (brand, type, year) |

**Primary Key:** composite (`brand_id`, `document_type`, `year`).

---

## Relationships

```
brands ──┬── 1:N ── users
         ├── 1:N ── customers
         ├── 1:N ── products
         ├── 1:N ── settings
         └── 1:N ── number_sequences

products ──1:N── models ──1:N── product_instances ──1:N── service_jobs
products ──N:N── accessories   (via product_accessories)

customers ──┬── 1:N ── customer_channel_contacts
            ├── 1:N ── product_instances   (ownership)
            └── 1:N ── service_jobs

service_jobs ──┬── 1:N ── timeline_events
               ├── 1:N ── photos
               ├── 1:N ── attachments
               ├── 1:N ── notes
               ├── 1:N ── service_job_accessories
               └── 1:N ── repair_reports

repair_reports ──┬── 1:N ── repair_parts
                  └── 1:N ── repair_report_approvals

users (technician_id) ── 1:N ── service_jobs
users (created_by)     ── 1:N ── service_jobs
users (author_id)      ── 1:N ── notes
```

## Open Questions

- **Cross-brand customers:** confirmed default is brand-scoped `customers` (see Design call above) — revisit if a unified cross-brand CRM view is actually wanted.
- **`product_instances` without a serial number:** each such drop-off is effectively untracked as "the same unit" on a future visit — service history linkage depends on serial number capture. Worth a staff workflow nudge (e.g. a warning at intake) rather than a schema fix.
- Exact `settings` keys/shape (business hours, notification templates, per-brand print template selection — see `PRINT_SPECIFICATIONS.md`) — to be defined when those features are scoped.
