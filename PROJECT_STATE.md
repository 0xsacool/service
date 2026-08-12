# Project State

> Snapshot of where the project actually is today. Update this file whenever the architecture, page list, or major limitations change — it is the fastest way for a new contributor (human or Claude) to get oriented.

## Terminology Note

The business entity is the **Service Job** (a single repair event), not "Claim" — see [DECISIONS.md](DECISIONS.md) #009. **The code-level rename is complete**: types, files, and routes use `ServiceJob`/`service-jobs` naming throughout (`src/types/serviceJob.ts`, `src/features/service-jobs/`, `ServiceJobsList.tsx`, `ServiceJobDetails.tsx`, `NewServiceJob.tsx`). A handful of comments and mock-data identifiers still say "claim" in passing (historical context, not identifiers), which is not a documentation error — it's residue from before the Sprint 1 rename, harmless and not tracked as a gap.

## Project Overview

**Service Tech** is a service job (repair) tracking system built for two Thailand-based retail brands, **Bruno Thailand** and **Join Lux Club**. It gives three groups of people a shared view of a repair's lifecycle:

- **Customers** track a repair using a tracking number, with no login required.
- **Service Staff** log intake, update status, assign technicians, and manage the repair queue.
- **Admins** oversee operations across both brands.

Platform: responsive web application (mobile through desktop), Thai-first for Version 1 (see [DECISIONS.md](DECISIONS.md) #003). UX-L10N1 establishes the source-only Thai-first staff surface and the dedicated public tracking locale layer; live auth/backend rollout remains separately gated.

## Current Development Stage

**Feature-complete UI on a swappable backend — no activated durable frontend backend and no active auth.** F5d-31 hardens source-only production blockers; there is still no production sign-in, staff profile, Auth provider, Rules deployment, or live durable creation path. The codebase has grown well past the original Bolt.new prototype through a long, incrementally-approved sprint sequence. Concretely, today:

- The app runs on **real client-side routing** (`react-router-dom`), a **feature-based folder structure**, and a **Repository Provider** seam — not the original flat `src/components/` + `useState<PageId>` + static-array design described in earlier versions of this document.
- Every data read/write goes through a typed repository interface (`src/repositories/types.ts`), resolved via `repositories` in `src/repositories/repositoryProvider.ts`. By default every repository is backed by an **in-memory Mock implementation** seeded from static fixtures.
- **Product Master, Customers, and Service Jobs have an opt-in Firestore backend.** Local development defaults to Mock; a production build requires exactly `VITE_BACKEND_KIND=firestore` and otherwise stops before mounting routes or repositories. This setting has not been changed for a deployed frontend by this codebase.
- `@supabase/supabase-js` is still an installed dependency but is **not used anywhere in the code** — it predates the Firebase/Firestore direction taken in Sprint F0–F2.1 and is effectively orphaned (see Current Limitations).
- Firebase Auth is now used by the source-only staff session provider. No production Auth provider, Firebase user, or `staffProfiles/{uid}` document has been created, so no live staff session exists yet. `Login` uses email/password only when the provider is later enabled and a valid own-profile allowlist record can be read.
- **Mock repositories remain session-only.** In Firestore mode, Customers and Service Jobs are persistent and shared; Product Master is deliberately read-only until a privileged catalog workflow is approved. Service Job creation allocates tracking and Service Request numbers inside one Firestore transaction, then returns only a server-confirmed document. The numbering year remains derived from the existing browser-created `createdAt` date; F5d-31 does not claim a trusted server year because that needs a later privileged allocator design. Current Rules deliberately deny `numberSequences`, so this durable creation path is source-complete but not live-ready until that later Rules/privileged-allocator decision.
- **Worker-backed attachments require Firestore Service Jobs.** Attachment creation rejects a missing parent before byte upload and derives retention only from its durable parent `closedAt`; open or ambiguous parents remain `deleteAfter: null`. Manual delete retains metadata and writes `deletedAt` after the Worker's idempotent R2 DELETE succeeds.
- **Brand/auth source foundation (F5d-24, not deployed).** `bruno-thailand` and `join-lux-club` are canonical IDs; new durable Service Jobs require immutable `brandId`, while legacy missing values remain readable as `null` and fail Worker authorization. The Worker source verifies Firebase ID tokens and checks `staffProfiles/{uid}.brandId` against the target Service Job before file routes proceed. No Firebase Auth provider/user, staff profile, brand document, rules deployment, Service Job backfill, or Worker deployment has occurred.

## Current Architecture

| Layer             | Current implementation                                                                                                                                                                                                                                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework         | React 19 + TypeScript, built with Vite 8                                                                                                                                                                                                                                                                                                                                              |
| Routing           | `react-router-dom` (`BrowserRouter`), route table in [src/app/App.tsx](src/app/App.tsx), patterns centralized in `src/constants` — real deep links, working back/forward                                                                                                                                                                                                              |
| Styling           | Tailwind CSS v4 (via `@tailwindcss/vite`), design tokens in [src/index.css](src/index.css)                                                                                                                                                                                                                                                                                            |
| Icons             | `lucide-react`                                                                                                                                                                                                                                                                                                                                                                        |
| Data access       | Typed repository interfaces (`src/repositories/types.ts`) resolved through the **Repository Provider** (`src/repositories/repositoryProvider.ts`), consumed by hooks (`useServiceJobs`, `useCustomers`, `useUniversalSearch`, `useCustomerProducts`, `useCreateServiceJob`, `useProductMaster`, `useProductDetail`) — components never import a repository or mock data file directly |
| Backend (default) | **Mock** — static fixtures under `src/repositories/mockData/`, wrapped by in-memory repository implementations                                                                                                                                                                                                                                                                        |
| Backend (opt-in)  | **Firestore**, via `firebase` SDK (`src/lib/firebase/firebase.ts`), selected by `VITE_BACKEND_KIND=firestore` for Product Master, Customers, and Service Jobs — see Backend & Repository Architecture below                                                                                                                                                                           |
| State             | Local `useState`/hooks per page/component; no global store; no React Context for repositories (deliberate — see [DECISIONS.md](DECISIONS.md) #017)                                                                                                                                                                                                                                    |
| Auth              | Source-only Firebase Auth session provider with email/password sign-in, own-profile validation, staff guard, and Worker token refresh handling. No provider/user/profile has been provisioned or deployed. `@supabase/supabase-js` is an unused, orphaned dependency                                                                                                                  |
| Folder structure  | Feature-based (`src/features/`, `src/shared/`, `src/repositories/`, `src/imports/`, `src/types/`, `src/constants/`, `src/validation/`, `src/services/`, `src/utils/`, `src/lib/`, `src/config/`) — see Folder Structure below                                                                                                                                                         |

## Backend & Repository Architecture

This is the part of the codebase that changed most since the last documentation pass (Sprints F0–F2.1) and is the area most likely to be misunderstood from reading older docs or prototype-era assumptions:

- **`src/config/backend.ts`** exports `BackendKind = 'mock' | 'firestore'` and `backendKind`, resolved once from `import.meta.env.VITE_BACKEND_KIND` (defaults to `'mock'` if unset or any other value).
- **`src/repositories/repositoryProvider.ts`** exports `repositories: RepositoryProvider`, the single object every hook depends on. It is resolved via a **top-level `await`**:
  - `backendKind === 'mock'` → every field is the Mock singleton.
  - `backendKind === 'firestore'` → `productMaster`, `customers`, and `serviceJobs` are dynamically imported and asynchronously constructed against Firestore; the remaining repositories stay Mock.
  - `VITE_FILES_BACKEND=worker` requires `backendKind === 'firestore'`; otherwise attachment resolution fails closed to the Mock implementation rather than using a non-durable parent anchor.
  - If Firestore initialization fails for any reason (missing/invalid `.env`, denied Security Rules, network failure), the failure is caught and the provider **falls back to the all-Mock provider** for that session, logging a clear, actionable console error instead of crashing the app. See [DECISIONS.md](DECISIONS.md) #021.
- **`src/repositories/firestoreProductMasterRepository.ts`** is an async factory (not a ready-made singleton) that seeds Firestore once if empty, opens a live `onSnapshot` listener on the `products` collection, and exposes the same synchronous `ProductMasterRepository` interface as the Mock implementation by keeping a local cache in sync with the listener. See [DECISIONS.md](DECISIONS.md) #018 for the full reasoning (sync-interface-over-async-backend).
- **`src/repositories/migrations/seedProductMasterFromMock.ts`** copies the Mock `productMasterEntries` fixture into Firestore exactly once (empty-collection check + atomic `writeBatch`), so switching to `firestore` mode on a fresh project self-populates without a manual seed step, and re-running it never duplicates data.
- **Firebase deployment config is checked in**: `firebase.json`, `firestore.rules`, `firestore.indexes.json`, `.firebaserc` at the project root. `firestore.rules` currently allows open read/write on the migrated collections as a deliberate pre-auth posture, not a production authorization design.
- See [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) for the actual Firestore document shape and how it relates to the still-Postgres-flavored design for entities not yet migrated.

## Folder Structure

Matches the target laid out in [CLAUDE.md](CLAUDE.md), largely realized already (not just aspirational):

```
src/
  app/App.tsx                 # Route table (react-router-dom)
  config/backend.ts           # BackendKind resolution
  lib/firebase/firebase.ts    # Lazy Firebase app/Firestore/Auth getters
  constants/                  # Routes, statuses, app name, service-intake constants
  types/                      # serviceJob, customer, product, productMaster, registeredProduct, search, serviceIntake
  validation/                 # serviceJobValidation, serviceIntakeValidation
  services/                   # serviceJobCreation, serviceJobPresentation (business logic, not in components)
  utils/                      # formatDate, csv, warranty, slugify, inputClass
  repositories/
    types.ts                  # Every repository interface
    repositoryProvider.ts     # The seam every hook depends on
    *Repository.ts            # Mock implementations (serviceJobs, customers, products, search, registeredProducts, productMaster, productKnowledge)
    firestoreProductMasterRepository.ts
    firestore/productMasterMapping.ts
    migrations/seedProductMasterFromMock.ts
    mockData/                 # Static fixtures
  imports/                    # Generic import framework (shared/) + products/ specific normalizer/validator/importer
  features/
    tracking/pages/           # TrackHome, TrackResult (public)
    auth/pages/                # Login (non-functional stub)
    dashboard/pages/
    service-jobs/pages/       # ServiceJobsList, ServiceJobDetails, NewServiceJob
    service-jobs/components/  # Intake section components (accessories, problem, photo evidence, notes, print preview)
    master-data/products/pages/       # ProductsPage, ProductDetail
    master-data/products/components/  # Product Master + Product Knowledge UI, Import wizard, CSV/download menu
  shared/
    components/                # Row, Timeline, PhotoGallery, ProgressBar, Logo, ui primitives, ErrorBoundary, Empty/Loading/Error states, search/, product/
    layouts/                   # StaffLayout (used by the router), StaffShell (legacy, superseded — see Current Limitations)
```

This differs from the CLAUDE.md target in small naming details only (e.g. `master-data/products` instead of a flat `product-instances`/`customers` split — Customer Master and full Product Instance features per [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) don't exist as their own repositories yet; `registeredProductsRepository` + `customersRepository` are the current, simpler stand-ins).

## Existing Pages

| Route                       | File                                                                           | Audience    | Purpose                                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                         | [TrackHome.tsx](src/features/tracking/pages/TrackHome.tsx)                     | Customer    | Public landing page, search a repair by tracking number                                                                                      |
| `/track/:trackingNumber`    | [TrackResult.tsx](src/features/tracking/pages/TrackResult.tsx)                 | Customer    | Public status page — timeline, photos, contact info                                                                                          |
| `/login`                    | [Login.tsx](src/features/auth/pages/Login.tsx)                                 | Staff/Admin | Sign-in form (non-functional — accepts anything, no session created)                                                                         |
| `/dashboard`                | [Dashboard.tsx](src/features/dashboard/pages/Dashboard.tsx)                    | Staff/Admin | Stat cards, weekly intake chart, status breakdown, recent activity                                                                           |
| `/service-jobs`             | [ServiceJobsList.tsx](src/features/service-jobs/pages/ServiceJobsList.tsx)     | Staff/Admin | Filterable/searchable list of all service jobs                                                                                               |
| `/service-jobs/new`         | [NewServiceJob.tsx](src/features/service-jobs/pages/NewServiceJob.tsx)         | Staff/Admin | Full intake flow: universal customer/product search → product identity → problem/accessories → service intake → save & print Service Request |
| `/service-jobs/:id`         | [ServiceJobDetails.tsx](src/features/service-jobs/pages/ServiceJobDetails.tsx) | Staff/Admin | Single record view — status, timeline, notes, photos, customer/product/assignment info                                                       |
| `/master-data/products`     | [ProductsPage.tsx](src/features/master-data/products/pages)                    | Staff/Admin | Product Master catalog — search/filter/sort, Add Product, CSV/Excel export, CSV import wizard                                                |
| `/master-data/products/:id` | [ProductDetail.tsx](src/features/master-data/products/pages)                   | Staff/Admin | Product Master detail — General/Accessories/Common Problems tabs, edit-in-place                                                              |
| `*`                         | `NotFoundPage`                                                                 | Any         | Catch-all 404 — also resolves the old "invalid tracking number silently shows a random record" bug (fixed in Sprint 1)                       |

Staff pages render inside `StaffLayout` (sidebar + top bar, wraps every staff route via a layout `<Route>`); the customer tracking pages and `Login` do not.

## Existing Components

The `ui.tsx`-as-one-file design system from the original prototype has been split into `src/shared/components/` primitives (`GlassCard`, `StatusBadge`, `PriorityPill`, `Button`, `Field`, `Modal`, `PageHeader`, `PageContainer`, `FormSection`, `ErrorBoundary`, `EmptyState`/`LoadingState`/`ErrorState`) plus feature-scoped subfolders (`search/`, `product/`). The previously-duplicated `Row`, `Timeline`, `PhotoGallery`, and `ProgressBar` markup (once copy-pasted between `ClaimDetails.tsx` and `TrackResult.tsx`) was extracted into single shared components during Sprint 1 — that specific duplication is resolved.

## Completed Milestones

Grouped by what shipped, not by exact sprint label (many sprints predate a formal "Sprint N" naming convention and were tracked as internal task batches rather than named docs):

1. **Documentation Foundation** (Sprint 0) — the original 8-doc set (later expanded to 9 with this file's own PRINT_SPECIFICATIONS.md).
2. **Architecture Cleanup** (Sprint 1 / 1B) — router adoption, `Claim` → `ServiceJob` code rename, feature-based folders, shared-component extraction, ESLint/Prettier, constants layer, repository interfaces, ErrorBoundary/Empty/Loading/Error states, validation-layer scaffolding.
3. **Universal Search & Progressive Intake** — `searchRepository`/`useUniversalSearch`, search UI (`RecentSearches`, `CustomerResultCard`, etc.), rewrote `NewServiceJob` as a search-first, progressively-revealed flow; `RegisteredProduct` concept + `registeredProductsRepository`/`useCustomerProducts`; stable `customerId`-based identity (not phone-keyed); independent warranty model on the registered product.
4. **Service Intake & Save/Print** — service-intake types/validation, intake section components (accessories, problem, photo evidence, internal notes), `serviceJobCreation` business-logic service, `useCreateServiceJob`, `ServiceRequestPrintPreview` with working `@media print` output, full save/print/reset flow wired into `NewServiceJob`.
5. **Product Master** (Sprint P1–P3) — product/category/accessory types, a real Bruno Thailand mock catalog, `productMasterRepository`, a generic import framework (`src/imports/shared/`) specialized for products (`src/imports/products/`), Add Product form + validation, CSV/Excel export, `ProductsPage` with search/filter/sort, a full CSV import wizard (choose file → preview → validation → completed summary).
6. **Product Knowledge** (Sprint P4) — `CommonProblemDefinition` (with Active/Inactive status), `productKnowledgeRepository`, `ProductDetail` page with General/Accessories/Common Problems tabs, all edit-in-place against the repository layer.
7. **Backend Abstraction** (Sprint F0) — `RepositoryProvider` seam formalized as the single dependency every hook resolves through, replacing direct per-repository imports.
8. **Firebase SDK Integration** (Sprint F1) — `firebase` package installed, `src/lib/firebase/firebase.ts` with lazy, fail-fast-on-first-use getters, `.env.example`, Vite env typings. Mock remained the only active backend this sprint.
9. **Firestore Product Repository** (Sprint F2) — first real Firestore-backed repository, scoped to Product Master only; idempotent seed-once migration; live-validated (create/update/search/detail, no duplicate reseed) against a real Firebase project.
10. **Firestore Hardening** (Sprint F2.1) — checked-in Firebase deployment config (`firestore.rules`, `firestore.indexes.json`, `firebase.json`, `.firebaserc`); fixed a bug where a bad Firestore config could crash the entire app instead of just Product Master (now falls back to Mock with a clear error); deduplicated the `PRODUCTS_COLLECTION` constant; captured the previously-discarded `onSnapshot` unsubscribe handle; validated repeated `mock ↔ firestore` switching with no restart required.
11. **Documentation Refresh** (Sprint F2.2, this pass) — brought this file and its siblings back in sync with the above.

## Current Limitations

- **No authentication or roles** — Admin, Service Staff, and Customer are still not distinguished in code. Firebase Auth is reachable but nothing calls it.
- **Partial Firestore persistence only** — in `VITE_BACKEND_KIND=firestore` mode, Product Master, Customers, and Service Jobs are durable and shared. Search and Registered Products remain Mock/in-memory, and no deployed frontend has been switched to Firestore mode.
- **Orphaned dependency** — `@supabase/supabase-js` remains in `package.json` from the original prototype but is called nowhere; the actual backend direction taken (F0–F2.1) is Firebase/Firestore, not Supabase. This divergence from the original [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) target (which is Postgres/Supabase-flavored) has not been formally reconciled — see that document's new "Implementation Status" section and this sprint's Remaining Gaps.
- **`StaffShell.tsx` appears superseded by `StaffLayout.tsx`** — `App.tsx`'s router uses `StaffLayout` exclusively; `StaffShell` still exists in `src/shared/layouts/` but nothing imports it. Worth a cleanup pass, not urgent.
- **Localization boundary is source-only** — staff UI is Thai-first and public tracking supports the four approved locales, but live auth/backend rollout and any broader content translation remain separately gated.
- **No brand identity** — visuals remain generic/placeholder, not Bruno Thailand or Join Lux Club branding ([DECISIONS.md](DECISIONS.md) #008 — still open).
- **No accessibility pass** — icon-only buttons, chip/toggle groups, and the mobile drawer have not had a dedicated ARIA/focus-management pass.
- **Restrictive Firestore Rules are source/emulator-only.** They have not been deployed; live access remains unchanged until separately approved rollout.
- **Limited app test coverage** — Service Job retention-anchor regression tests run through Vite and Node’s built-in test runner; broader application test coverage remains to be established.

## F5d-26 Auth + Data Access Integration Readiness (source/emulator only)

The app now has source-only Firebase Auth session observation, email/password
sign-in/sign-out, own-profile allowlisting, and a guard around all staff
routes. Firestore-mode repositories remain unavailable until a valid
`staffProfiles/{uid}.brandId` profile is loaded; Service Job reads then use
that profile's canonical brand query and creation uses the same trusted scope.
Legacy missing-brand jobs are omitted. Mock mode remains usable without
Firebase Auth.

Attachment reads are constrained by `jobId`, normal reads hide `deletedAt`,
and the audit/internal include-deleted path remains. Worker attachment calls
use the session ID token, refresh once on a `401`, sign out after a second
`401`, and never retry a `403`. Firestore repositories no longer auto-seed
sample data on startup.

Products/customers remain intentionally fail-closed in Firestore staff mode
until F5d-28 implements the approved ownership schema: products are global
reference data and customers have brand memberships. This still blocks Product
Master and New Service Job customer/product selection. Public tracking uses no
client Firestore read; Firestore mode stays unavailable until F5d-28
implements the approved token-backed Worker boundary and DTO.

Restrictive local Firestore rules and seven emulator tests are ready but not
deployed. No production Auth, Firestore data/rules, Worker, IAM, secret, R2,
Cron, or deletion behavior changed.

## F5d-27.1 ownership and public-tracking decision lock

F5d-27.1 is documentation only. Products are approved as a global reference
catalog: `Product.brand` remains manufacturer/display data and no
authorization `brandId` is added. Future valid staff may read it, while client
catalog writes remain denied pending a privileged workflow.

Customers are approved as global identities with opaque stable IDs and
`brandIds: BrandId[]`; staff access requires membership in the validated
business brand. Existing phone-number document IDs are legacy and no migration
has occurred. A later Service Job phase must introduce a trusted customer
reference without silently backfilling old records.

Public tracking is approved as a Worker/backend-mediated, one-job bearer
capability. The sequential reference is not authorization; a random 256-bit
token is stored only as a SHA-256 hash and sent from a customer URL fragment
in a POST request. The future DTO is limited to reference, status, product
display name/model/SKU, masked serial suffix, customer-safe timeline, and
`lastUpdatedAt`; public attachments are prohibited. No endpoint, token, Rules
change, or deployment exists yet.

## F5d-28 Public Tracking + Ownership Foundation (source/emulator only)

The source now implements the approved ownership model. Firestore-mode staff
customers use a membership-scoped `array-contains` query and fail closed in the
mapper when `brandIds` is absent or malformed. Products remain a global
reference catalog: valid staff can read, while client writes are denied by the
source Rules. No production customer migration occurred.

`ServiceJob.publicTrackingTokenHash` is required in the domain model and
defaults to `null` for new jobs. It is intentionally omitted from normal
updates and denied to browser writes in Rules. Token helpers use a URL-safe
random 256-bit value, SHA-256 hash, constant-time verification, and explicit
rotation/revocation helpers; no raw token is stored or logged.

The Worker source contains a narrow public `POST /public/tracking/{reference}`
route only. It bounds and validates the JSON token body, performs one exact
Service Job read, and returns reference/status/product/model-or-SKU when
available/masked serial/safe status timeline/last-updated time. It uses no
client Firestore public rule, no staff authorization, no attachment metadata,
and no R2 binding. All invalid/missing/wrong-token results are generic. A
rate-limit seam exists but no production rate-limit policy is configured.
The pre-existing mock tracker now also fails closed rather than treating a
sequential reference as a public credential; browser fragment-token wiring is
a later explicitly approved integration step.

All source changes are local. The Worker has not been deployed, Firebase Auth
and rules have not been deployed, no data/backfill/token was issued, and Cron
and automatic deletion are unchanged. Local validation passed: app build,
ESLint, five app regression suites, nine Firestore Emulator Rules tests, and
Worker typecheck plus 134 checks.

## F5d-29 Public Browser Flow + Trusted Issuance Boundary (source only)

Public tracking now has a source-only browser integration for the approved
fragment capability URL. The `/track/:trackingNumber` page captures the token
from `#fragment`, removes it from visible history, ignores/removes query token
parameters, and sends it only in a bounded POST body through a narrow API
client. It never uses client Firestore, storage, staff tokens, file transport,
or a generic fallback. The public page renders only the explicit safe DTO.

The former reference-only Mock tracker now fails closed. Source-only Worker
issuance functions can issue, rotate, or revoke a token hash through a narrow
existing-document writer and produce a fragment share link. They are not
reachable from HTTP or Cron and have no staff UI caller; a future privileged
administrative authorization design is still required before activation.

No deployment or production mutation occurred. A production rate limit needs a
separate approval: the recommended shape is a Cloudflare-native rule for the
public POST endpoint, per source IP, with a generic response; no numerical
threshold is locked. Worker source now has 144 offline checks; app browser
flow coverage adds four checks.

## SERVICE REPORT WORKSTREAM — SR-1

SR-1 adds a source-only Service Report data model and repository foundation
aligned with the existing multi-report Repair Report domain. A Service Job may
have multiple durable reports over time; reports are independent records, not
revisions. Each report lives at `serviceReports/{reportId}` and carries a
queryable `serviceJobId`. The repository supports listing a job's history,
lookup by report ID, draft creation/update, and explicit finalization.

The model includes typed `serviceActions` (`repair`, `replace-part`,
`replace-product`, `claim-factory`, `return-to-customer`), typed result statuses,
documentary embedded parts, attachment IDs only, claim/factory references, and
a `snapshot` that is null for drafts and captures report identity/context when
finalized. Snapshots contain tracking reference, customer display/contact,
brand display code/name, product display name, model/SKU when available, serial,
and the customer-reported problem; they contain no auth fields, public token,
hash, R2 path, or secret.

Report numbers follow existing Decision #014 / Business Rules numbering:
`FR-{YYYY}-{SEQUENCE}`, with an explicit per-brand/per-year sequence allocator.
The source Firestore repository uses a transaction-backed `numberSequences`
allocator corresponding to the approved `number_sequences` architecture.
Mock parity uses an in-memory per-brand/per-year allocator. No new global
counter policy was invented.

Drafts use current Service Job context and have `snapshot: null`. Finalization
uses a Firestore server timestamp in Firestore mode, writes the immutable
snapshot, and ordinary update/finalize operations reject a final report. A
later report creates a new ID and cannot mutate an earlier snapshot. Firestore
mapping rejects malformed persisted records and the repository queries by
`serviceJobId`.

SR-1 is source/offline only. `firestore.rules` has no `serviceReports` or
`numberSequences` match, so live persistence remains blocked pending a separate
Rules review. No UI, print/PDF, Worker, F5d Core/Security, deployment, Cron,
production Firestore, R2, IAM, or secret change occurred.
Offline validation passes 11 SR-1 tests, 57 serialized application Node checks,
9 unchanged Firestore Emulator Rules tests, TypeScript/build, ESLint, and
Prettier.

## SERVICE REPORT WORKSTREAM — SR-2 (source/UI offline only)

SR-2 adds the staff-facing Service Reports experience inside Service Job
Details. It provides an empty state, latest-report emphasis, deterministic
history, draft editing, final read-only viewing, and creation of later
independent reports.

Only one active draft is allowed per Service Job. The UI surfaces that draft
with Continue Editing, View, and Finalize actions, and both Mock and source
Firestore repository creation paths reject another draft before allocating a
new report number. Finalized reports remain immutable.

The editor covers read-only job/product context, customer report, technical
inspection, typed service actions, documentary parts, technician remark, typed
result, claim/factory references, and attachment selection. Service Report
state persists attachment IDs only; R2 paths and public/security fields are
not copied into report state. Final views use the immutable snapshot.

SR-2 remains source/offline only. No UI print/PDF, Firestore Rules, Worker,
F5d Core/Security, deployment, production Firestore/R2, IAM, secret, or Cron
change occurred. Validation includes 11 SR-1 repository tests, 7 SR-2 UI
behavior tests, 64 serialized application tests, TypeScript/build, ESLint, and
Prettier.

## SERVICE REPORT WORKSTREAM — SR-3 (source/print offline only)

SR-3 adds a browser print-preview document for Service Reports. It is a
professional, generic `SERVICE TECH` / `SERVICE REPORT` A4 portrait layout that
uses browser `window.print()` and the native Save as PDF flow. It includes
customer/product context, report content, actions, parts, result, optional
claim/factory references, evidence, signatures, and footer metadata.

Final reports use the immutable Service Report snapshot for historical
identity/context. Draft previews use current context and carry a strong DRAFT
preview-only label. Preview and print are read-only and do not mutate reports.

Selected evidence IDs resolve only through the existing authorized attachment
repository. Image attachments use temporary object URLs; non-image, missing, or
failed evidence renders an unavailable placeholder. No R2 path, public token,
brandId, or security field is exposed in the print document.

Dedicated print CSS defines A4 portrait margins, application-chrome hiding,
plain print styling, section/table/signature break protection, and natural
multi-page behavior. SR-3 remains source-only; no Rules, Worker, deployment,
production data/R2, IAM, secret, or Cron change occurred.

## SERVICE REPORT WORKSTREAM — SR-4 / V1 (source complete, live persistence blocked)

SR-4 completes the source-only Service Report V1 behavior. Drafts remain
saveable while incomplete, while finalization now fails closed unless the
customer-reported problem, technical inspection findings, at least one typed
service action, and result status are present. Any part row must have a
non-blank description and remark plus a positive whole-number quantity.
Claim/factory references, evidence IDs, technician remarks, result detail, and
technician display text remain optional. Finalization still creates the
immutable snapshot and final reports remain read-only; there is no Unfinalize.

The V1 signature model is print-only: the approved Repair Report layout has
Technician and Approval signature lines, with the technician display text
shown when available and a blank approval capture line. No signer field,
signature image, cryptographic signature, or approval workflow was added.
Decision #034 records that this completeness gate is not the separate
append-only approval history defined by Decision #016.

Print QA now covers Thai/mixed long text, long parts and references, optional
claim/factory sections, bounded image evidence with unavailable placeholders,
natural multi-page breaks, A4 portrait styling, and report/tracking identity in
the document header/footer. A local mock-mode browser walkthrough also
rendered a finalized Thai/mixed report preview and confirmed wrapping, table
readability, final identity, and the Approval placeholder without any live
backend write. Print privacy checks continue to exclude brandId,
public token/hash, Firebase/staff metadata, R2 paths, and hidden attachment
metadata. The local workflow covers incomplete save, reopen/continue,
finalization, read-only output, later reports, immutable prior snapshots,
missing evidence, malformed parts, and duplicate-draft rejection.

Service Report V1 — SOURCE COMPLETE / NOT LIVE-PERSISTENCE-READY. The current
`firestore.rules` source still has no `serviceReports` or `numberSequences`
match, so live Service Report persistence remains intentionally blocked pending
a separately approved Rules/F5d review. No Rules, Worker, F5d Core/Security,
deployment, production Firestore/R2, IAM, secret, or Cron change occurred.
Validation passes 14 SR-1/Repository tests, 8 SR-2/UI tests, 10 SR-3/SR-4
print tests, and 78 serialized application tests, plus TypeScript/build,
ESLint, and Prettier. The local Rules command remains environment-blocked by
Firebase CLI `EPERM` opening `C:\\Users\\sacoo\\.config\\configstore\\firebase-tools.json`;
the Rules source was not changed.

## SERVICE REPORT WORKSTREAM — SR-4.1 compact A4 print polish

SR-4.1 is print-layout-only. The baseline pagination defect was traced to the
print rule `body * { visibility: hidden; }`: hidden StaffShell, Service Job,
and main-content wrappers continued to reserve their full layout height while
the print article was taken out of flow with `position: absolute`. The result
was a real article spanning more than one printable page plus trailing hidden
layout pages.

Print mode now adds a scoped body class, hides the StaffShell/sidebar/topbar
and all non-report Service Job sections with `display: none`, removes shell
padding, and keeps one print article in normal flow. The screen A4 sheet remains
separate from print sizing; print uses static flow, compact 10mm margins, and
no forced trailing break. Sections, rows, evidence, and signatures are only
protected where practical rather than broadly forcing whole sections to a new
page.

The A4 document is materially denser but retains readable typography, Thai
fallbacks, wrapped long text, compact draft/no-evidence states, compact
Technician/Factory-Approver signatures, bounded evidence, and report/tracking
footer identity. Browser-generated headers/footers remain a browser Print
dialog setting; clean output requires disabling “Headers and footers” when the
browser exposes that option.

SR-4.1 adds 3 print regression checks. The full serialized application suite
passes 81 tests; print coverage passes 13 tests. TypeScript/build, ESLint, and
Prettier pass. The local browser rendered the compact minimal draft preview,
but this in-app browser surface did not expose a native Print Preview dialog,
so browser-header ON/OFF PDF results could not be independently captured.
No domain, repository, Rules, Worker, F5d, production, R2, IAM, secret, or
Cron behavior changed.

## UX-L10N1 — staff Thai-first and public tracking multilingual foundation (source only)

UX-L10N1 establishes the source-only language boundary. The staff application is
Thai-first with no staff language switcher: Service Job is displayed as
“งานบริการ”, persisted status values remain unchanged, and staff status,
priority, authentication, intake, product, customer, report, and A4 print
surfaces use Thai labels with system Thai/CJK font fallbacks. Service Report
print output retains the SR-4.1 compact layout and document identity footer;
the application does not add page counters or remote fonts.

Public Tracking has a separate, narrow four-locale layer: `th` (default),
`en`, `ja`, and `zh-CN`. A small selector switches locale without reload and
may persist only the locale code under `publicTrackingLocale`; raw tracking
tokens, hashes, and payloads are never stored. Public DTO shape, fragment-token
extraction, POST/token boundary, status/timeline privacy filtering, and staff
authentication boundaries are unchanged. Public dates and status labels are
localized at presentation time only.

UX-L10N1 is source/offline only. No schema, domain, repository, Worker, Rules,
Firebase provider/user, Firestore data, R2, IAM, secret, deployment, or Cron
change occurred. The serialized application suite passes 89 tests; TypeScript,
ESLint, Vite build, and Prettier pass. Validation covers
locale/default/persistence/privacy source contracts, Thai staff/report/login
terminology, and print counter removal.

## OPS-UX1 — delivery note print and customer notification share (source/mock only)

OPS-UX1 completes the two staff actions on Service Job Details that were
previously inert. `พิมพ์ใบนำส่ง` opens a separate, read-only Thai-first Delivery
Note preview sourced only from the current Service Job context. The print
document is intentionally separate from Service Report persistence and uses no
new collection or schema field. It includes job/customer/product/issue/status
identity where available, an accessory handover area (or handwriting lines when
empty), notes lines, and sender/receiver signature placeholders. It excludes
internal notes, staff/security fields, attachment metadata, R2 paths, and
tracking credentials. Scoped A4 print CSS hides the StaffShell and toolbar,
keeps one print article in normal flow, and emits no page counter or fake URL.

`แจ้งลูกค้า` is a staff-initiated Share/Copy workflow, not an automatic
notification channel. It builds a Thai message containing only the job
reference, product, localized current status, and the safe statement that the
customer should use the link received from staff. Web Share is preferred;
clipboard is the desktop/browser fallback. Cancellation is neutral, genuine
failures are recoverable Thai feedback, and no Service Job or notification
history is mutated. No tracking URL is fabricated and no raw token/hash is
available to this workflow.

OPS-UX1 is source/mock QA only. No Service Job or Service Report schema,
repository, public tracking, Worker, Rules, F5d Core/Security, Firestore/R2,
IAM, secret, deployment, or Cron behavior changed. Focused OPS-UX1 coverage
passes 9 tests; the full serialized application suite passes 98 tests.
TypeScript, ESLint, Vite build, and Prettier pass. The Vite build retains the
existing non-blocking large-chunk warning.

## PUB-TRACK-1 — human-enterable secure tracking code (source/offline only)

PUB-TRACK-1 adds a source-only manual public tracking credential without
changing the existing Service Job identity or public DTO. The approved format
is `SRV-{YYYY}-{MMDD}-{XXXXXX}` with a six-character uppercase base36 suffix
generated by Web Crypto using unbiased rejection sampling. The suffix space is
`36^6 = 2,176,782,336` (approximately 31 bits); this is materially weaker than the existing 256-bit
fragment token, so production rollout requires a fail-closed rate-limit and
abuse-control policy. With no limiter, distributed guessing is unlimited; a
basic per-IP limiter slows casual abuse but is bypassable. Production needs
layered edge/IP/device throttling, monitoring, and fail-closed behavior when
the limiter is unavailable. No code was issued to production data.

The app accepts complete normalized codes from `/track#CODE`, removes the
credential from browser history, and supports Thai (default), English,
Japanese, and Simplified Chinese labels. It does not accept ordinary query
credentials or store the raw code. A future trusted issuance boundary returns
the raw code once and stores only its SHA-256 hash on `ServiceJob`; client
updates reject both public credential hash fields.

The Worker source adds exact `POST /public/tracking` handling with bounded
`{ code }` input, a private direct `publicTrackingCodes/{normalizedCode}` index,
one Service Job read, hash verification, and only the existing minimal
PublicTrackingDTO. It does not scan Firestore, read attachments, access R2,
authorize staff routes, or expose the index. The old fragment-token route is
retained as a transitional compatibility path. No live issuance endpoint,
Rules/IAM/Auth change, Firestore write, Worker deployment, R2 operation,
production data change, or Cron change occurred.

PUB-TRACK-1 validation covers generation, collision handling, hashing,
fragment/history handling, normalized lookup, generic failures, DTO/privacy,
four-locale UI contracts, optional Delivery Note/share boundaries, Worker
typecheck, the full 112-test serialized application suite, the 9-test local
Firestore Rules emulator suite, and the 147-check offline Worker suite.

## F5d-32 source-only allocator status

F5d-32 replaces the source-level browser Service Job allocator with a narrow authenticated Worker allocator. Creation now derives staff brand, Asia/Bangkok civil year, tracking and Service Request identities, timestamps, initial security fields, and a create-only document inside one idempotent Firestore transaction. The browser submits only validated intake data and a UUIDv4 key retained across recoverable failures; existing browser updates remain brand-scoped Firestore operations. Rules source denies browser creation and all browser access to `numberSequences` and `serviceJobIntakeKeys`.

This is not live-ready: no Worker or Rules deployment, IAM application, staff/Auth provisioning, production write, R2 operation, or Cron change occurred. The checked-in IAM source specification has the additional `datastore.entities.create` permission required for a future reviewed rollout. `BRN-2026-000001` remains untouched.

## F5d-33/F5d-34 — rollout review found and fixed three production blockers

F5d-33 independently reviewed F5d-32 against actual Firestore/emulator behavior rather than trusting the prior report, and found the allocator was source-correct but not live-safe. F5d-34 fixed all three findings in source only; none was deployed.

The Worker's `commitServiceJobCreation` built each `:commit` write's `update.name` as a full HTTP URL (`${baseUrl}/serviceJobs/{id}`) instead of Firestore's required bare resource name (`projects/{project}/databases/(default)/documents/{collection}/{id}`); every Service Job creation would have failed with a 400 before Rules or IAM were ever reached. `worker/src/firestoreClient.ts` now derives the resource name independently of the fetch base URL, and `worker/test/serviceJobAllocatorCommit.test.mts` exercises the real `createFirestoreClient()` implementation end to end (stubbing only the network boundary, not `ServiceJobCreationDataAccess`) to prove every write in the commit body names a bare resource path.

The checked-in `serviceJobs` update Rule paired its `diff().affectedKeys()` guard (which is missing-field-safe) with direct equality checks on `createdAt`/both public-tracking hash fields; those throw when a legacy document never had one of those fields, denying every ordinary update to a pre-F5d-32 Service Job. The Rule now relies solely on the diff-based guard, which already proves the same immutability property without dereferencing possibly-absent fields. The existing Firestore Rules emulator test (`existing authorized ServiceJob updates preserve privileged fields and deny delete`) already exercised this exact scenario and now passes; the suite is 10/10.

The Worker's CORS configuration allowed only `Content-Type`/`X-File-Name`, so a real browser's preflight for any authenticated call (every `/files/*` route, and the new `POST /service-jobs`) would have been blocked before reaching the Worker — `Authorization` and `Idempotency-Key` are not CORS-safelisted headers. `worker/src/cors.ts` now allows both; `worker/test/cors.test.mts` is a new preflight regression test (none existed before).

Two related hardening fixes landed alongside the blockers. The intake timeline's `time` field used `toLocaleTimeString` with no explicit zone, which resolves to the Workers runtime default (UTC) rather than Bangkok — now explicit `timeZone: 'Asia/Bangkok'`, matching the date's existing Bangkok math, with a boundary test at the Bangkok-midnight/UTC-day mismatch. And the ~32 KB-per-photo intake limit was unrealistically small for a compressed photo; per-photo and aggregate photo caps were raised (300 KB/photo, 700 KB aggregate, `MAX_INTAKE_BYTES` to 900 KB) bounded by Firestore's 1 MiB per-document ceiling, since intake photos are embedded as base64 data URLs directly on the ServiceJob document rather than going through the attachments/R2 pipeline — raw, uncompressed multi-MB camera photos still will not fit this way, which is a known, deferred limitation, not something this fix claims to solve.

Service Report Firestore persistence remains blocked (no `serviceReports`/`numberSequences` Rules yet), and previously presented a "Create Report" action that was guaranteed to fail on click once a real Firestore backend was active (the unavailable repository provider already rejected the write; the UI didn't reflect that). `ServiceReportsSection` now renders an explicit unavailable state under a non-Mock backend instead; Mock/development behavior is unchanged.

`VITE_FILES_BACKEND` previously defaulted silently to `'mock'` when unset, including in a production build where the business backend is Firestore — Service Jobs durable, attachments silently not. `src/config/filesBackend.ts` now mirrors `backend.ts`'s fail-closed pattern for exactly that combination (production + a durable business backend); `App.tsx` combines both configuration axes into the one gate that already blocks mounting the staff app on invalid config. `test/backendConfiguration.test.mjs` covers both resolvers and the combinator.

Full validation after F5d-34: app TypeScript build, ESLint, and Vite production build pass; the serialized application suite passes 125 of 126 Node tests (the 126th, the Firestore Rules suite, requires the emulator and is run separately); the Firestore Rules emulator suite passes 10/10; Worker TypeScript typecheck and the full Worker test suite pass. Prettier's pre-existing failures are unchanged (8 markdown files, none of this sprint's source). No production Firestore/R2/IAM/Auth/secret change, Worker/Rules/frontend deployment, migration/backfill, or Cron activation occurred; `BRN-2026-000001` remains untouched.

The canonical F5d-34 bookkeeping record is 17 files changed and 34 visible
added or modified checks. The low-priority legacy-`createdAt` Rules assertion
is deferred as a future test-only improvement.

## F5d-35 source-control and rollback baseline

F5d-35 establishes a local Git baseline and the
`PRODUCTION_ROLLBACK_RUNBOOK.md` preflight/rollback record before any rollout
mutation. It captures source state only; deployed Rules, frontend artifact,
IAM binding, Auth, and backfill snapshots remain future read-only gate work.
Production rollout has not started. Cron is not declared in `wrangler.toml`,
`scheduled()` is not production-triggered, and `deletionExecutor` remains
unwired.

## F5d-36 production read-only baseline

F5d-36 manually captured and reviewed the production baseline before the
first rollout mutation. Gate 2 is preflight-ready with non-blocking findings;
it has not begun. The production Worker remains
`service-tech-files-worker`, version
`9a8b83f2-861d-4700-9b4a-05260c4ee661` at 100% traffic, with
`ALLOWED_ORIGINS=http://localhost:5173`,
`FIRESTORE_PROJECT_ID=luxace-service`, and
`ATTACHMENTS_BUCKET=service-tech-attachments-prod`. Its two credential secret
names are recorded without values. Cron has no production trigger,
`scheduled()` remains present but untriggered, and `deletionExecutor` remains
unwired.

The applied Worker IAM custom role has only
`datastore.databases.get`, `datastore.entities.get`,
`datastore.entities.list`, and `datastore.entities.update`; the source-only
`datastore.entities.create` addition is not applied, and delete is absent.
Firebase Authentication is uninitialized, no `brands` or `staffProfiles`
collection was observed, Firebase Hosting is uninitialized, and the deployed
Firestore Rules are older/permissive rather than the reviewed source rules.

The eight observed Service Jobs all lack `brandId` and both public-tracking
hash fields. The seven `SRV-*` seed records remain approved only for a later
explicit backfill, while `BRN-2026-000001` remains protected and unmodified;
its baseline `updateTime` is `2026-08-08T06:19:09.065089Z`. There are seven
customers, all without `brandIds`; customer migration is outside Gate 2.

## F5d-37 Gate 2 production provisioning

Gate 2 is complete. Firebase Authentication now has Email/Password enabled
and its first approved staff identity is `sacool.spizy@gmail.com`
(`qUbRfp5Iv3drX9IEZL3DyLBvcsj2`). The canonical brand documents now exist:
`brands/bruno-thailand` has `code: "BRN"` and `name: "Bruno Thailand"`, and
`brands/join-lux-club` has `code: "JLC"` and `name: "Join Lux Club"`. The
only staff profile is `staffProfiles/qUbRfp5Iv3drX9IEZL3DyLBvcsj2`, whose sole
field is `brandId: "bruno-thailand"`.

The first Gate-2.4 attempt exposed a PowerShell URI-interpolation defect that
created `staffProfiles/.exists=false` with the intended brand value. It was
detected immediately, removed under an explicit `updateTime` precondition,
and independently verified absent before the separately approved safe retry.
The intended UID profile was absent before retry, and the incident is fully
remediated with no residual production impact. This audit record must remain.

The seven approved `SRV-*` jobs still lack `brandId` and
`BRN-2026-000001` remains untouched at update time
`2026-08-08T06:19:09.065089Z`. There are still seven customers, all without
`brandIds`. Worker version/traffic, four-permission applied IAM, old deployed
Rules, Worker configuration/secrets, inactive Cron, unwired
`deletionExecutor`, and uninitialized Firebase Hosting are unchanged. Gate 3
IAM is not started.

## F5d-38 Gate 3 IAM production change

Gate 3 is complete. The existing custom role
`projects/luxace-service/roles/firestoreRetentionSweeper` was updated from
its four-permission state by adding only `datastore.entities.create`; no
permission was removed. Its final permissions are database get plus entity
get/list/update/create. `datastore.entities.delete` remains absent, and the
existing Worker service-account binding is unchanged.

The change grants database-scoped Firestore create capability to the Worker
service account, not a collection-scoped privilege. The reviewed Worker code
and its create-only allocator semantics remain the collection/operation
discipline; no Worker rollout occurred. Protection checks confirmed
`BRN-2026-000001` still lacks `brandId` and retains update time
`2026-08-08T06:19:09.065089Z`. The production Worker remains
`9a8b83f2-861d-4700-9b4a-05260c4ee661` at 100% traffic. Rules, Auth, brands,
staff profile, Service Jobs, customers, R2, frontend, Worker configuration and
secrets, Cron, and `deletionExecutor` are unchanged. Gate 4 Worker rollout is
not started.

## Development Principles

1. **Docs before backend expansion.** Each new repository's backend swap (Customer, Service Job, Search, Registered Products) gets the same doc-plus-approval treatment Product Master got, not a silent bulk migration.
2. **Data-access seam before data-source swap.** Realized in code, not just planned: every page reads through `repositories.<name>`, so a future backend swap touches the Repository Provider, not every page — proven out already by the Product Master Firestore cutover.
3. **No premature abstraction.** Don't build for hypothetical future requirements — extract shared components only where duplication already exists, not speculatively.
4. **Thai-first, localization-ready.** UX-L10N1 establishes Thai-first staff presentation, Thai dates, Thai/CJK system fallbacks, and the narrow public tracking locale layer while preserving the approved security/domain boundaries.
5. **Brand-scoped by design.** Bruno Thailand and Join Lux Club are modeled as first-class entities from the schema up ([DECISIONS.md](DECISIONS.md) #002); brand scoping has not yet reached the current repositories/UI since there is no auth or multi-brand data split in the Mock/Firestore layers yet — tracked as part of the eventual backend expansion, not forgotten.
6. **Customer and product identity are durable, not per-transaction.** Reflected today via stable `customerId` and `RegisteredProduct` concepts in the UI layer, even though the full Customer Master / Product Instance schema in `DATABASE_SCHEMA.md` isn't backed by a real database yet.
7. **Incremental, reviewable phases.** Each sprint is scoped, executed, validated, and reported before the next one starts — matching how F0 through F2.2 were run, and how Sprint 3 (Customer Repository) onward should continue.
