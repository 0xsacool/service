# Project State

> Snapshot of where the project actually is today. Update this file whenever the architecture, page list, or major limitations change — it is the fastest way for a new contributor (human or Claude) to get oriented.

## Terminology Note

The business entity is the **Service Job** (a single repair event), not "Claim" — see [DECISIONS.md](DECISIONS.md) #009. **The code-level rename is complete**: types, files, and routes use `ServiceJob`/`service-jobs` naming throughout (`src/types/serviceJob.ts`, `src/features/service-jobs/`, `ServiceJobsList.tsx`, `ServiceJobDetails.tsx`, `NewServiceJob.tsx`). A handful of comments and mock-data identifiers still say "claim" in passing (historical context, not identifiers), which is not a documentation error — it's residue from before the Sprint 1 rename, harmless and not tracked as a gap.

## Project Overview

**Service Tech** is a service job (repair) tracking system built for two Thailand-based retail brands, **Bruno Thailand** and **Join Lux Club**. It gives three groups of people a shared view of a repair's lifecycle:

- **Customers** are intended to track a repair using a tracking number, with no
  login required. That UI exists, but production Public Tracking remains
  intentionally unavailable.
- **Service Staff** log intake, update status, assign technicians, and manage the repair queue.
- **Admins** oversee operations across both brands.

Platform: responsive web application (mobile through desktop), Thai-first for
Version 1 (see [DECISIONS.md](DECISIONS.md) #003). The authenticated staff app
is live at `https://luxace-service.web.app` on the Firestore + Worker runtime.

## Current Development Stage

**Authenticated staff application live on Firebase Hosting, Firestore, and the
Cloudflare Worker.** The codebase has grown well past the original Bolt.new
prototype through a long, incrementally approved sprint sequence. Concretely,
today:

- The app runs on **real client-side routing** (`react-router-dom`), a **feature-based folder structure**, and a **Repository Provider** seam — not the original flat `src/components/` + `useState<PageId>` + static-array design described in earlier versions of this document.
- Every data read/write goes through a typed repository interface
  (`src/repositories/types.ts`), resolved through the Repository Provider.
  Local development may use Mock; the production artifact fails closed unless
  it selects Firestore for business data and the Worker for files.
- **Product Master, Customers, Service Jobs, Registered Products, and Universal
  Search use the Firestore production path.** Firestore-mode search supports
  name/phone/tracking-number/serial-number only; marketplace username and order
  number remain unsupported (see Current Limitations, F5d-49).
- `@supabase/supabase-js` is still an installed dependency but is **not used anywhere in the code** — it predates the Firebase/Firestore direction taken in Sprint F0–F2.1 and is effectively orphaned (see Current Limitations).
- Firebase Email/Password Auth, staff-profile allowlisting, brand scoping, and
  restrictive Firestore Rules are live. The production Login requires a valid
  Firebase user and canonical `staffProfiles/{uid}` record.
- **Mock repositories remain development/session-only.** Production Service Job
  creation uses the authenticated Worker allocator, which derives the staff
  brand and Bangkok civil year and atomically allocates tracking and Service
  Request numbers. Gate 7.1 verified this path with `BRN-2026-000002` and
  `SR-2026-000001`.
- **Worker-backed attachments require Firestore Service Jobs.** Attachment creation rejects a missing parent before byte upload and derives retention only from its durable parent `closedAt`; open or ambiguous parents remain `deleteAfter: null`. Manual delete retains metadata and writes `deletedAt` after the Worker's idempotent R2 DELETE succeeds.
- **Brand/auth production boundary.** `bruno-thailand` and `join-lux-club` are
  canonical IDs. New durable Service Jobs require immutable `brandId`; the
  Worker verifies Firebase ID tokens and checks the staff profile's brand for
  protected routes. Reviewed Rules, Auth/provider, staff profile, canonical
  production data, and the Worker are deployed.

## Current Architecture

| Layer             | Current implementation                                                                                                                                                                                                                                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework         | React 19 + TypeScript, built with Vite 8                                                                                                                                                                                                                                                                                                                                              |
| Routing           | `react-router-dom` (`BrowserRouter`), route table in [src/app/App.tsx](src/app/App.tsx), patterns centralized in `src/constants` — real deep links, working back/forward                                                                                                                                                                                                              |
| Styling           | Tailwind CSS v4 (via `@tailwindcss/vite`), design tokens in [src/index.css](src/index.css)                                                                                                                                                                                                                                                                                            |
| Icons             | `lucide-react`                                                                                                                                                                                                                                                                                                                                                                        |
| Data access       | Typed repository interfaces (`src/repositories/types.ts`) resolved through the **Repository Provider** (`src/repositories/repositoryProvider.ts`), consumed by hooks (`useServiceJobs`, `useCustomers`, `useUniversalSearch`, `useCustomerProducts`, `useCreateServiceJob`, `useProductMaster`, `useProductDetail`) — components never import a repository or mock data file directly |
| Backend (development) | **Mock** — static fixtures under `src/repositories/mockData/`, wrapped by in-memory repository implementations                                                                                                                                                                                                                                                                  |
| Backend (production)  | **Firestore + Worker**, selected explicitly by production environment and guarded fail-closed before the app mounts — see Backend & Repository Architecture below                                                                                                                                                                                                              |
| State             | Local `useState`/hooks per page/component; no global store; no React Context for repositories (deliberate — see [DECISIONS.md](DECISIONS.md) #017)                                                                                                                                                                                                                                    |
| Auth              | Live Firebase Email/Password staff session provider with own-profile validation, brand scope, staff guard, and Worker token refresh handling. `@supabase/supabase-js` is an unused, orphaned dependency                                                                                                                                                                             |
| Folder structure  | Feature-based (`src/features/`, `src/shared/`, `src/repositories/`, `src/imports/`, `src/types/`, `src/constants/`, `src/validation/`, `src/services/`, `src/utils/`, `src/lib/`, `src/config/`) — see Folder Structure below                                                                                                                                                         |

## Backend & Repository Architecture

This is the part of the codebase that changed most since the last documentation pass (Sprints F0–F2.1) and is the area most likely to be misunderstood from reading older docs or prototype-era assumptions:

- **`src/config/backend.ts`** exports `BackendKind = 'mock' | 'firestore'` and
  resolves `VITE_BACKEND_KIND`. Development may select Mock; a production
  build with a missing or non-Firestore business backend is blocked before
  mounting the application.
- **`src/repositories/repositoryProvider.ts`** exports `repositories: RepositoryProvider`, the single object every hook depends on. It is resolved via a **top-level `await`**:
  - `backendKind === 'mock'` → every field is the Mock singleton.
  - `backendKind === 'firestore'` dynamically constructs the production-capable
    Firestore repositories; unavailable future repositories remain explicitly
    unavailable rather than silently substituting production Mock data.
  - `VITE_FILES_BACKEND=worker` requires Firestore. Production also requires the
    exact approved HTTPS Worker origin; missing, local, path-bearing, or other
    origins fail closed through the shared configuration gate.
  - A production initialization/configuration failure does **not** silently
    select Mock. The application gate blocks the staff surface.
- **`src/repositories/firestoreProductMasterRepository.ts`** is an async factory (not a ready-made singleton) that seeds Firestore once if empty, opens a live `onSnapshot` listener on the `products` collection, and exposes the same synchronous `ProductMasterRepository` interface as the Mock implementation by keeping a local cache in sync with the listener. See [DECISIONS.md](DECISIONS.md) #018 for the full reasoning (sync-interface-over-async-backend).
- **`src/repositories/migrations/seedProductMasterFromMock.ts`** copies the Mock `productMasterEntries` fixture into Firestore exactly once (empty-collection check + atomic `writeBatch`), so switching to `firestore` mode on a fresh project self-populates without a manual seed step, and re-running it never duplicates data.
- **Firebase deployment config is checked in**: `firebase.json`,
  `firestore.rules`, `firestore.indexes.json`, and `.firebaserc` at the project
  root. The reviewed restrictive Rules are deployed; Hosting publishes `dist`
  with an SPA rewrite to `/index.html`.
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
| `/`                         | [TrackHome.tsx](src/features/tracking/pages/TrackHome.tsx)                     | Customer    | Tracking UI; production lookup remains unavailable while Public Tracking is disabled                                                        |
| `/track/:trackingNumber`    | [TrackResult.tsx](src/features/tracking/pages/TrackResult.tsx)                 | Customer    | Tracking result UI; production lookup remains unavailable while Public Tracking is disabled                                                 |
| `/login`                    | [Login.tsx](src/features/auth/pages/Login.tsx)                                 | Staff/Admin | Firebase Email/Password staff sign-in                                                                                                        |
| `/dashboard`                | [Dashboard.tsx](src/features/dashboard/pages/Dashboard.tsx)                    | Staff/Admin | Truthful current-status counts and breakdown, recent activity, and awaiting-parts callout                                                     |
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

- **Role scope is intentionally narrow** — staff authentication and brand scope
  are live; broader Admin and Customer role models and administration remain.
- **Firestore search scope is incomplete** — name, phone, tracking number, and
  serial number are supported. Marketplace username and order number have no
  Firestore collection to search (`customer_channel_contacts`/
  `product_instances` were never migrated — DECISIONS.md #038) and return no
  match rather than fabricated data.
- **Orphaned dependency** — `@supabase/supabase-js` remains in `package.json` from the original prototype but is called nowhere; the actual backend direction taken (F0–F2.1) is Firebase/Firestore, not Supabase. This divergence from the original [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) target (which is Postgres/Supabase-flavored) has not been formally reconciled — see that document's new "Implementation Status" section and this sprint's Remaining Gaps.
- **Staff layout composition** — `StaffLayout.tsx` owns outlet state and renders
  `StaffShell.tsx`; the shell is the active navigation, landmark, search, and
  responsive-drawer implementation.
- **Localization/accessibility remain incomplete in production** — F5d-64's
  approved P0/P1 keyboard and screen-reader hardening is live in production.
  Broader content translation and the explicitly deferred P2/P3 accessibility
  work remain open.
- **No brand identity** — visuals remain generic/placeholder, not Bruno Thailand or Join Lux Club branding ([DECISIONS.md](DECISIONS.md) #008 — still open).
- **Accessibility follow-up remains** — the F5d-64 source patch addresses the
  audited P0/P1 table, drawer, dialog, route, form, selection, error, and focus
  defects. Timeline/progress semantics, PhotoGallery, DownloadMenu, the import
  chooser, broader ProductFieldsForm cleanup, contrast, reduced motion, and
  other P2/P3 polish remain separately gated.
- **Public Tracking is unavailable in production.** Its Worker binding,
  issuance flow, and fail-closed rate-limit scope remain separately gated.
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

## F5d-39A Public Tracking containment and legacy-data preflight

Gate 4 was reordered and remains unapproved. A normal Worker deployment must
not accidentally activate deferred Public Tracking while its rate-limit,
issuance, lifecycle, and public-timeline decisions remain open. The Worker
therefore treats Public Tracking as disabled unless the exact optional binding
`PUBLIC_TRACKING_ENABLED=true` is supplied in a future separately approved
deployment. The binding is intentionally absent from default `wrangler.toml`.
While disabled, both public POST routes return the generic 404 before parsing
a credential, consulting a limiter, or constructing a Firestore client. No
issuance or rate-limiter implementation was added.

A read-only production preflight found zero attachment metadata and zero live
attachments for each of the seven approved `SRV-*` Service Jobs and protected
`BRN-2026-000001`. After the approved seven-job `brandId` backfill, future
Bruno staff attachment access will be brand-scoped for any subsequently
created metadata; the protected unclassified record continues to fail closed
because it has no canonical `brandId`.

The same read-only preflight classified customers only from exact contact-key
relationships without recording PII. Six of seven legacy customers link only
to a Service Job explicitly approved for `bruno-thailand` backfill and are
verified Bruno migration candidates. One customer also links to unclassified
`BRN-2026-000001`; it remains unclassified and excluded from a future customer
migration unless separately resolved. No Service Job or customer backfill
occurred; `BRN-2026-000001` remains protected and unmodified. The next gate is
controlled data-migration planning only, not a Worker, Rules, or frontend
rollout.

## F5d-40/41 — Gate 5 Controlled Data Migration complete; Rules review

Gate 5 is complete. The seven approved Service Jobs (`SRV-2026-0481`,
`SRV-2026-0479`, `SRV-2026-0477`, `SRV-2026-0475`, `SRV-2026-0472`,
`SRV-2026-0469`, `SRV-2026-0465`) now carry `brandId: "bruno-thailand"`
(Gate 5.1). All seven of the previously-classified legacy customers now carry
`brandIds: ["bruno-thailand"]`: the six candidates verified in F5d-39A (Gate
5.2), plus the one customer whose relationship also touched protected
`BRN-2026-000001`, migrated only after separate review confirmed the
membership grant does not touch or reclassify that record (Gate 5.3). No
customer PII or document ID is recorded here or in any gate artifact; F5d-40B
independently verified from source that `brandIds` is an additive,
non-exclusive membership array and that no Service Job holds a stored
customer foreign key, so this backfill cannot cascade into or alter any
Service Job. `BRN-2026-000001` remains unmodified: no `brandId`, update time
still `2026-08-08T06:19:09.065089Z`. No Rules, Worker, frontend, IAM, Auth,
R2, Cron, or `deletionExecutor` change occurred as part of Gate 5.

F5d-41 independently re-reviewed `firestore.rules` against this now-migrated
state. Every collection's read/create/update/delete policy, brand scoping,
and legacy/missing-field behavior was re-verified against source (not
assumed from prior reports); no wildcard or permissive fallthrough rule
exists. `BRN-2026-000001` and any still-unbackfilled legacy record fail
closed under the reviewed Rules (denied `get`, silently excluded from
`array-contains`/brand-scoped `list`), which does not affect any branded
customer or Service Job query. `numberSequences` has an explicit
`match`/`allow read, write: if false` block (fully denied by name);
`serviceReports` has no `match` block at all and is denied only by
Firestore's default-deny-on-absence model. Both are fully inaccessible to
clients today — a pre-existing, already-tracked gap, not a Gate 5
regression.

The Firestore Rules emulator suite was run to completion (11/11 passing).
One coverage gap was closed: the suite seeded an authenticated user with a
non-canonical `staffProfiles.brandId` and implicitly relied on
`validStaff()`'s existing `canonicalBrand()` check, but never asserted the
resulting denial, and never exercised an authenticated user with no
`staffProfiles` document at all. `test/firestoreRules.test.mjs` now has an
explicit test for both cases across `serviceJobs`, `customers`, and
`products`. No `firestore.rules` source change was needed or made. Full
validation after this review: TypeScript build and Vite production build
pass; ESLint and Prettier pass; the serialized application suite passes 125
of 126 Node tests in-process (the 126th, the Firestore Rules suite, requires
the emulator and is run separately, where it passes 11/11); Worker
TypeScript typecheck and the full Worker test suite pass.

The currently deployed production Firestore Rules remain the old/permissive
ruleset from the F5d-36 baseline — deploying the reviewed source Rules is a
separate, not-yet-approved gate. Rollback for that future deployment is to
redeploy the captured prior ruleset, per `PRODUCTION_ROLLBACK_RUNBOOK.md`'s
existing Firestore Rules gate row; no rules deployment, capture, or rollback
was performed in F5d-41.

## F5d-42/43 — Gate 6 Firestore Rules deployment complete

Gate 6 is complete. The reviewed `firestore.rules` source (F5d-41, unchanged
since) is now the live production ruleset for project `luxace-service`:
release `projects/luxace-service/releases/cloud.firestore`, ruleset ID
`7538645e-5898-4238-8d2a-33be07b01209`, created `2026-08-12T15:10:50.208079Z`,
live SHA-256 `E300D6046623945375283605CFBE3BBDFA7F179E12554EE39803A0F50E002589`.
The pre-Gate-6 ruleset's SHA-256 is recorded as the rollback target,
`B5DAED02B5B741B1BC92E9429FCDE3BB0199D8F281D856193AD996A28C072533`; the
rollback artifact (prior rules source plus release metadata) is kept
read-only under the locally gitignored `.f5d42-firebase-config/` and is
never committed, matching the existing secrets/credentials exclusion pattern.

Post-deploy read-only production smoke checks confirm fail-closed behavior
matches the reviewed source: unauthenticated Service Job read denied (403),
protected `BRN-2026-000001` read denied (403), and `numberSequences`,
`serviceJobIntakeKeys`, and `serviceReports` all denied (the first two by
their explicit `if false` rule, `serviceReports` by Firestore's
default-deny-on-absence, per the F5d-41 wording correction). `BRN-2026-000001`
remains unmodified: no `brandId`, update time still exactly
`2026-08-08T06:19:09.065089Z`. The Gate 5 migration remains intact under the
now-live Rules: 7/7 approved Service Jobs carry `brandId: "bruno-thailand"`
and 7/7 reviewed legacy customers carry `brandIds: ["bruno-thailand"]`.

Authenticated approved-staff production reads were **not** exercised with a
real Firebase ID token during Gate 6 (no ID-token session was available in
this environment) — this is a deliberately recorded remaining production
acceptance check for later Worker/frontend QA, not a Gate 6 failure; the
emulator suite already proves this exact scenario (11/11 passing, including
approved same-brand staff, cross-brand deny, missing-profile deny, and
malformed-profile deny — see F5d-41).

IAM remains the five-permission `firestoreRetentionSweeper` role
(`datastore.databases.get`/`entities.get`/`entities.list`/`entities.update`/
`entities.create`; `entities.delete` still absent). No Worker, frontend, R2,
Auth, or Cron change occurred as part of Gate 6.

## F5d-45/46 — Gate 7 Worker production rollout complete

Gate 7 is complete. `service-tech-files-worker` is now live at version
`e1e11e81-04d6-4cf7-bc5b-9b5f31ac26d4` (version number 14), 100% traffic.
The rollback candidate `9a8b83f2-861d-4700-9b4a-05260c4ee661` (version 11)
remains available; rollback was not required.

Live, unauthenticated/read-only smoke results: `GET /health` → 200;
unauthenticated `POST /service-jobs` → 401; an unauthenticated file `GET` →
401; both Public Tracking routes → generic 404; an allowed-origin
(`localhost`) CORS preflight → 204 with the correct origin and both
`Authorization`/`Idempotency-Key` allowed; a disallowed origin received no
CORS grant. All results match the F5d-44 source review's expectations
exactly.

Configuration and security controls are unchanged from what F5d-44
reviewed: `FIRESTORE_PROJECT_ID=luxace-service`,
`ALLOWED_ORIGINS=http://localhost:5173`,
`ATTACHMENTS_BUCKET=service-tech-attachments-prod`, secret names only
(`GOOGLE_SERVICE_ACCOUNT_EMAIL`/`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`,
values never recorded), `PUBLIC_TRACKING_ENABLED` absent, no Cron trigger,
no Queues, `deletionExecutor` unwired. IAM remains the five-permission
`firestoreRetentionSweeper` role with `datastore.entities.delete` absent.
The live Firestore Rules checksum
(`E300D6046623945375283605CFBE3BBDFA7F179E12554EE39803A0F50E002589`) and the
Gate 5 migration state (7/7 Service Jobs, 7/7 customers, `BRN-2026-000001`
protected at update time `2026-08-08T06:19:09.065089Z`) are unchanged.

Authenticated end-to-end allocator acceptance remains pending: no real
authenticated `POST /service-jobs` call has been executed against
production. This is the next explicit, separately approved acceptance
micro-gate — not performed as part of Gate 7. No Rules, IAM, Auth, R2,
Cron, or frontend change occurred as part of this gate.

## F5d-48 — Firestore registered-products read path (source only)

Root cause of Gate 7.1's UI block: `repositories.registeredProducts` was
never overridden under Firestore mode — it stayed on the permanent
unavailable stub (`getForCustomer: () => []`) — so after selecting a
customer, `ProductSelection` always rendered empty and New Service Job
could never reach Save & Print.

`src/repositories/firestoreRegisteredProductsRepository.ts` (new) derives a
customer's registered products purely from their own real Service Job
history, reusing the already brand-scoped `serviceJobs` repository
directly — no new Firestore query, no `firestore.rules` change needed or
made, since brand isolation is inherited by construction. No Product
Instance entity ([DECISIONS.md](DECISIONS.md) #012) exists in Firestore, so
(per [DECISIONS.md](DECISIONS.md) #037) this deliberately derives only
"previously serviced" entries and never fabricates a "never serviced"
bucket or fuzzy-matches Product Master by name. `RegisteredProduct.purchaseDate`/
`warrantyMonths`/`warrantyExpiresAt` are now optional on the shared type —
genuinely absent under Firestore mode rather than backdated — and
`warrantyStatus` comes directly from the customer's most recent intake's
own `warranty` flag. Neither `ProductCard` nor `ProductSummaryCard` reads
the now-optional fields, so no UI change was needed or made.

**Independently re-confirmed, contradicting this task's stated background:**
`repositories.search` is still never overridden under Firestore mode (only
`serviceJobs`, `customers`, `productMaster`, `attachments`,
`serviceReports`, and now `registeredProducts` are). `UniversalSearch`
therefore cannot find any real customer in Firestore mode today — a
separate, still-open blocker to New Service Job's normal staff flow,
independent of this fix, and out of this task's explicit scope. Gate 7.1
cannot proceed through the ordinary staff UI until that gap is separately
fixed; the direct authenticated Worker call validated in F5d-47S remains
the only currently-viable Gate 7.1 acceptance path.

9 new tests cover the read path, customer scoping, brand isolation,
service-history derivation (accumulation and latest-visit tracking),
ordering, missing/legacy-data behavior (empty, not fabricated), the
now-optional fields staying genuinely absent, the repository's read-only
surface, and the New Service Job Save & Print gate condition being
satisfiable once real customer/product/intake data exists. Full validation
after F5d-48: TypeScript build and Vite production build pass; ESLint and
Prettier pass; the serialized application suite passes 134 of 135 Node
tests in-process (the 135th, the Firestore Rules suite, requires the
emulator and passes 11/11 there, unaffected since `firestore.rules` itself
was not touched). No Worker source was touched, so the Worker suite was not
re-run. No production deployment, mutation, or Gate 7.1 resumption
occurred.

## F5d-49 / F5d-49B — Firestore Universal Search read path, Terra-remediated (source only)

Root cause: `repositories.search` was never overridden under Firestore
mode — it stayed on the permanent unavailable stub (`search: () => []`) —
so `UniversalSearch` could never find a real customer, independently
blocking New Service Job's customer-selection step even after F5d-48's
registered-products fix. An independent Terra audit (F5d-49B) then found
four further defects in the first F5d-49 implementation before it was
committed; all four are fixed in place, described below, and the section
is written to describe only the final, remediated behavior.

**Customer identity vs. the join key (Terra P1).** A customer's Firestore
document ID is identity only — it is never treated as, or assumed to
equal, a phone number anywhere in this code. The real, documented
relationship is `customer.phone` <-> `serviceJob.customerPhone` (Decision
#031's accepted legacy join key), joined through exactly one canonical
normalization rule, `normalizeCanonicalPhone()` (`canonicalPhone.ts`) —
digits-only, so formatting differences (spaces, dashes, parentheses) don't
silently break the join. A missing/blank phone on either side never
matches anything, including another blank phone. If more than one scoped
customer normalizes to the same canonical phone, that phone is treated as
unresolved: none of the colliding customers appear in search, and
`registeredProducts.getForCustomer()` returns nothing for any of them —
Service Job history is never guessed onto one of several possible owners,
and no customer records are ever merged.

**`RegisteredProductsRepository.getForCustomer(customerId)`'s public
interface is unchanged** — every UI call site (`useCustomerProducts.ts`,
`ProductSelection.tsx`, `NewServiceJob.tsx`) still passes the customer's
`id` exactly as before. Only the Firestore implementation's internal join
changed: it now resolves `customerId` to the real `Customer` record via the
(already brand-scoped) `CustomersRepository`, then joins by that record's
canonical phone, with the same duplicate-phone fail-closed rule as search.
Mock's implementation and behavior are untouched.

**Blank serials (Terra P2).** A Service Job with a missing, empty, or
whitespace-only `serialNumber` can exist in history but is never grouped
into a selectable `RegisteredProduct` — no serial is fabricated to make one
selectable.

**Search reactivity (Terra P1).** `useUniversalSearch` previously memoized
`search()` on `query` alone, so a Firestore listener update (a new/changed
Service Job or customer) never appeared in an already-typed search until
the user edited the query again. `src/repositories/dataVersion.ts` (new) is
the smallest external-store mechanism that fits this project's existing
architecture — no polling, no React Context (deliberately absent, Decision
#017), no extra Firestore query: `firestoreCustomersRepository.ts` and
`firestoreServiceJobRepository.ts` each call `bumpDataVersion()` from
inside their own existing `onSnapshot` handler, and `useUniversalSearch`
reads the shared counter via React's built-in `useSyncExternalStore` and
includes it in the search `useMemo`'s dependency array. Mock mode never
calls `bumpDataVersion()`, so this is inert there.

**Search UX honesty (Terra P2).** `firestoreSearchRepository.ts` matches by
customer name, phone (digit-normalized), Service Job tracking number, and
serial number only — reusing the already brand-scoped
`customers`/`serviceJobs` repositories directly, no new Firestore query, no
`firestore.rules` change. Marketplace username and order number are
genuinely unsupported (no `customer_channel_contacts`/`product_instances`
collection has ever existed in Firestore — DECISIONS.md #038); every result
leaves those three fields `undefined`. `SearchInput.tsx`,
`SearchEmptyState.tsx`, and `SearchNoResults.tsx` now branch their Thai
copy on `backendKind` (same precedent as `ServiceReportsSection.tsx`'s own
mock-only gating) so Firestore-mode wording only ever promises name/phone/
tracking/serial; Mock mode keeps its full wording, unchanged. The
already-unwired "+ New Customer" action (silently a no-op in every backend,
since `NewServiceJob.tsx` never passes `onCreateNewCustomer` at all) is
hidden in Firestore mode behind an honest "not supported in this mode yet"
note rather than a button that looks live — no customer-creation behavior
was implemented. `getRecentSearches()` returns `[]` rather than Mock's
illustrative placeholder strings, since neither backend has a real
tracked-search-history layer. The shared string-matching helpers
(`normalizeDigits`/`matches`/`matchesPhone`) are extracted to
`searchMatching.ts` so Mock and Firestore search share one implementation;
Mock's own search behavior is unchanged (regression-tested).

47 tests across five files (`firestoreSearch.test.mjs`,
`firestoreRegisteredProducts.test.mjs`, `dataVersion.test.mjs`,
`searchUxHonesty.test.mjs`, plus the unchanged Rules suite) cover: opaque
customer IDs never treated as phones, formatted-vs-raw phone joins,
duplicate-canonical-phone fail-closed (both repositories), missing/blank
phone on either side, blank and whitespace-only serials ignored, same-serial
repeat-visit grouping, cross-customer and cross-brand isolation, the
data-version reactivity mechanism end to end (bump/subscribe contract, both
Firestore repositories genuinely calling it, `useUniversalSearch` genuinely
subscribing), supported-vs-unsupported search dimensions, the "+ New
Customer" gating, Mock search parity, and the full search-finds-customer →
registeredProducts-loads-their-real-product chain. Full validation:
TypeScript build and Vite production build pass; ESLint and Prettier pass.
At the F5d-49B checkpoint, the direct serialized Node run produced 170 of
171 test declarations passing in-process (the 171st was, at that point,
still counted alongside the direct suite; see F5d-49F below for the
corrected accounting that separates the Firestore Rules emulator suite
out as its own category). The Rules suite itself passed 11/11 under its
emulator wrapper, unaffected since `firestore.rules` was not touched. No
Worker source was touched, so the Worker suite was not re-run.

Firestore-mode New Service Job can now reach customer selection, product
selection, and the Save & Print gate through the ordinary staff UI's data
layer, with the join safety, ambiguity handling, reactivity, and UX honesty
Terra required. Gate 7.1 remains paused pending a separate Terra re-audit
and a separately approved production acceptance step — this task
implements and tests the read path only; no actual acceptance run was
performed. No production deployment or mutation occurred.

### F5d-49D — final UX honesty cleanup

Terra's re-audit (F5d-49C) passed all P1 findings and returned one
remaining P2: `NewServiceJob.tsx`'s own "start search" subtitle (separate
from `SearchInput.tsx`/`SearchEmptyState.tsx`/`SearchNoResults.tsx`, which
F5d-49B already fixed) still unconditionally advertised marketplace
username and order number. Fixed with the same `backendKind` branch used
by those three components — Firestore mode's subtitle now reads "เริ่มจาก
ค้นหาลูกค้า — ค้นหาด้วยชื่อ โทรศัพท์ เลขติดตาม หรือหมายเลขเครื่อง" (name,
phone, tracking number, serial number only); Mock mode keeps its full
wording, unchanged. A source-text regression test
(`searchUxHonesty.test.mjs`) now covers this fourth component the same way
as the other three, so a future edit reintroducing marketplace/order
wording in the Firestore branch fails the suite. No other stale
Firestore-visible copy was found — `CustomerSummaryCard.tsx`/
`CustomerResultCard.tsx` only render `customer.marketplace`/`.username`
conditionally on real data being present, which Firestore search already
guarantees stays `undefined` (Terra P2, F5d-49B), so nothing there
advertises an unsupported dimension. Build, lint, and Prettier all clean;
see F5d-49F below for the corrected, current test-count accounting. No
production deployment, mutation, or Gate 7.1 resumption occurred.

### F5d-49F — documentation count cleanup

Terra's final audit (F5d-49E) passed every source/security/data-integrity/
UX finding across the F5d-49/F5d-49B/F5d-49D series; the only remaining
issue was that this file's earlier test-count wording (above) blurred the
direct Node suite together with the Firestore Rules emulator suite as if
they were one pool. They are two separate categories, run two separate
ways, and are corrected here to state that plainly:

- **Direct/normal Node tests:** 21 files, **171 test declarations**, all
  passing in-process via `node --test test/*.test.mjs` (no emulator
  needed).
- **Firestore Rules emulator tests:** 1 file
  (`firestoreRules.test.mjs`), **11 test declarations**, all passing only
  under its dedicated `npm run test:firestore-rules` emulator wrapper —
  it fails if run directly outside that wrapper, which is expected and
  unrelated to `firestore.rules` correctness.
- **Combined total: 182 test declarations**, all passing under their
  respective run modes.

This is a documentation-only correction — no test file, source file, or
`firestore.rules` changed. Gate 7.1 remains paused. No production
deployment, mutation, or Gate 7.1 resumption occurred.

## F5d-52 — Firestore repository initialization diagnostics (local dev only)

F5d-50's live no-submit rehearsal was blocked by a generic
"Staff data could not be initialized. Try again later." message; F5d-51's
read-only diagnostic narrowed it to `activateFirestoreRepositories()`, whose
exception `AuthSessionProvider.tsx` deliberately collapses into that one
generic message. **The root repository failure itself is still UNKNOWN** —
this task adds observation only, not a fix, and local rehearsal has not yet
been repeated to capture the actual failing stage.

`src/repositories/firestoreInitDiagnostics.ts` (new) is the smallest
mechanism found: a `recordFirestoreInitFailure()`/`getFirestoreInitDiagnostics()`
recorder that captures `{repository, stage, code}` — repository name (one of
`serviceJobs`/`customers`/`productMaster`/`attachments`/`serviceReports`),
stage (`factory`/`initial-listener`/`listener`), and a Firestore error's
`.code` sanitized against a fixed allow-list of Firestore's own documented
error codes (anything else becomes `unknown`). No raw error, message,
`customData`, or stack is ever recorded or logged — deliberately, since this
app's customer documents are legacy phone-keyed (DECISIONS.md #031/#039), so
a raw Firestore error's message can itself embed a document path that is a
customer's phone number. In local development (`import.meta.env.DEV`, the
same signal `backend.ts` already uses) each recorded entry also prints
`[Firestore Init] <repository>: <code> (<stage>)` to the console; this line
is dead-code-eliminated from a production build entirely (confirmed: no
`"Firestore Init"` string appears anywhere in `dist/` after `npm run
build`), so production user-facing behavior is unchanged and no
credential/PII/internal-auth-state exposure risk was introduced.

Tracing activation surfaced a real, pre-existing (not introduced by this
task) lifecycle property worth flagging: `firestoreServiceJobRepository.ts`,
`firestoreCustomersRepository.ts`, and `firestoreProductMasterRepository.ts`
each resolve their factory promise even when their first `onSnapshot` call
returns an error (e.g. `permission-denied`) — the comment in each file
already documents this as intentional ("resolves — with an empty cache —
rather than hanging forever"). Practically, this means a listener-level
permission/config failure on any of those three repositories does **not**
reach `activateFirestoreRepositories()`'s catch at all: activation appears
to succeed, the generic error message never shows, and the UI would instead
render with silently empty data. Only a genuine synchronous throw or
rejected factory promise (`activateWithDiagnostics`'s `factory` stage in
`repositoryProvider.ts`, wrapping `serviceJobs`/`customers`/`productMaster`/
`attachments`/`serviceReports`) can actually produce the
"Staff data could not be initialized" message seen in F5d-50. This is
reported here as a discovered lifecycle characteristic, per F5d-52's own
instruction not to fix anything found while instrumenting — it is not fixed
in this task.

`serviceReports`/`attachments` listeners attach lazily per-Service-Job well
after activation completes, so their `stage` is always `listener`, never
`initial-listener` — documented as the "exact flow" Objective 4 asked for
when a repository's readiness doesn't gate on its own listener at all.

`AuthSessionProvider.tsx` was not modified — the generic user-facing message
and its control flow are byte-for-byte unchanged; the new diagnostics are
entirely internal to `repositoryProvider.ts` and the five repository
factories that can participate in activation. Query shapes, Firestore
Rules, brand scoping, repository data results, listener lifecycle, retry
behavior, customer/product logic, Worker calls, and mutation behavior are
all unchanged.

13 new tests (`firestoreInitDiagnostics.test.mjs`) cover: error-code
sanitization against the allow-list, that a raw error carrying PII-shaped
content is never exposed, the record/get/clear contract, the exact dev
console line format, every participating repository importing and calling
the recorder, `initial-listener`/`listener` classification via the same
`settled` flag each factory already had, `repositoryProvider.ts`'s
factory-stage wrapping and rethrow, per-attempt diagnostic clearing,
`AuthSessionProvider.tsx` remaining untouched, and that Mock mode continues
to load and search successfully with the instrumentation present. Full
validation: TypeScript build and Vite production build pass; ESLint and
Prettier pass; the direct Node suite passes 184/185 in-process (185 = 171
prior + 13 new + the one already-known emulator-only exception counted
directly; the Rules suite itself still passes 11/11 under its wrapper,
unaffected since `firestore.rules` was not touched).

Gate 7.1 remains paused. No production deployment or mutation occurred. The
underlying repository initialization defect this task was meant to help
diagnose is still not fixed and still not identified — local rehearsal must
be repeated to capture which repository/stage/code actually fails.

### F5d-52B — local rehearsal repeated: not reproducible, diagnostics retained

F5d-50's live no-submit browser rehearsal was repeated in a normal Chrome
session. Result: the earlier "Staff data could not be initialized. Try
again later." failure **did not reproduce** — Firestore repositories
initialized successfully, no `[Firestore Init]` diagnostic entry was
emitted at any stage, and the full live path (Search → Customer →
Registered Product → Intake → reaching the final action) worked. The final
create action was deliberately not clicked; production durable writes
remained **zero**.

This is recorded as a non-reproduction, not a resolution. **No root cause
was identified** — F5d-52's diagnostics never fired because the failure
this rehearsal was watching for simply didn't occur this time, which says
nothing about why it occurred during F5d-50. The lifecycle characteristic
F5d-52 already documented above (a `serviceJobs`/`customers`/`productMaster`
listener `permission-denied` resolves silently rather than rejecting, so it
would never have produced this diagnostic's `initial-listener` entry even
if it had occurred) remains an open, unfixed, unconfirmed possibility, not
a ruled-out one. The diagnostics themselves remain in place as ordinary
safe local-development instrumentation for whenever this failure next
reproduces.

Gate 7.1 remains **paused**, pending a separately and explicitly scoped
approval — this non-reproduction is not that approval. Production durable
writes = zero. No production deployment or mutation occurred.

## F5d-54 — Runtime backend safety guard (Mock/Firestore ambiguity)

**Root cause of Gate 7.1's manual "success."** Production incident
verification proved zero production writes for the manual submit that
produced `BRN-2026-000001`/`SR-2026-000001`: the protected BRN was
unchanged, `BRN-2026-000002` never existed, both sequences were logically
0, no intake-key mapping existed, and the Worker's `POST /service-jobs` was
never reached. The browser was running the **Mock create path** — the
checked-in `.env.example`/local `.env` default is `VITE_BACKEND_KIND=mock`,
and the operator had no way to visually tell Mock mode from the required
Firestore/Worker runtime. This was compounded by `serviceJobsRepository.ts`
(Mock) deliberately formatting its generated IDs in the exact same
`BRN-YYYY-NNNNNN`/`SR-YYYY-NNNNNN` shape as the real Firestore/Worker path
(so a staff member never sees a jarring fake-looking ID during ordinary
development) — meaning the two paths' _results_ are indistinguishable by
design, and only the _runtime configuration that produced them_ can be
told apart. **This was a safe, no-op Mock-only execution: production
durable writes = zero.** Gate 7.1 itself was not executed and remains
pending.

**Runtime indicator (Objectives 1/2).** New `RuntimeModeIndicator`
component, wired into `Login.tsx` (visible before any staff action) and
`StaffShell.tsx`'s topbar (visible on every staff page, including New
Service Job's Save & Print flow). Mock mode renders a loud, high-contrast
amber banner — "โหมดทดสอบ — Mock Data (ไม่ใช่ระบบใช้งานจริง)" — impossible
to mistake for a quiet, easy-to-miss label. Firestore mode renders a calm
badge, "FIRESTORE + WORKER", that turns into the same amber warning style
("FIRESTORE (ยังไม่พร้อม Worker)") if the create path isn't fully provable
rather than presenting a half-configured Firestore session as trustworthy.
Both branches read `src/config/runtimeDiagnostics.ts` — one source of
truth, never a second independently-computed check — so the indicator can
never drift from what `useCreateServiceJob.ts` actually does.

**Create-path assertion (Objective 3) — three distinct roles, not one.**
`assertFirestoreWorkerCreatePath()` (`runtimeDiagnostics.ts`) is a **shared
readiness evaluation**: it computes, from the same configuration
`useCreateServiceJob.ts` and `repositoryProvider.ts` already branch on,
whether the active path is genuinely `backendKind=firestore` +
`filesBackend=worker` + Worker URL configured — a read, never a mutation,
architecturally general (no Gate 7.1 ID or brand hardcoded anywhere in
it). `RuntimeModeIndicator` and the dev-only `[Create Path] ...` console
log (`useCreateServiceJob.ts`) both consume this evaluation for **operator
observability only** — as F5d-54A's Terra audit correctly found, in the
original F5d-54 cut neither of those actually stopped a create from
proceeding. The **enforced fail-closed mutation boundary** is
`performServiceJobCreate()` (F5d-54B, below) — see that section for the
distinction this file previously blurred.

**Production build safety (Objective 4) — already guarded, reconfirmed
here, not newly built.** `backend.ts`'s `resolveBackendConfiguration()`
(F5d-33/34) already fails closed on `VITE_BACKEND_KIND=mock` in a
production build (`import.meta.env.PROD`), and `App.tsx` already wraps the
entire app in `BackendConfigurationGate`, which renders only a
configuration-unavailable message — no routes, no repositories — when that
check fails. F5d-54 did not introduce new production-build code; it
directly reconfirmed (via `resolveBackendConfiguration('mock', true)` and
the `BackendConfigurationGate`/`App.tsx` wiring) that a production build
cannot silently ship with the Mock backend. **The actual gap F5d-54 closed
was development/rehearsal-time observability** — the production guard was
never the problem; the operator's inability to see which mode a _locally
running, non-production_ session was in, was.

**Safe runtime diagnostics (Objective 5).** `getRuntimeDiagnostics()`
returns exactly `{backendKind, filesBackend, workerConfigured,
firebaseProject}` — a Firebase project ID is a public identifier (it
appears in the app's own URLs), not a credential. Never reads or exposes
`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_APP_ID`,
`VITE_FIREBASE_MESSAGING_SENDER_ID`, or the Worker URL's actual value
(only whether it's set, as a boolean).

18 new tests (`runtimeDiagnostics.test.mjs`) cover: Mock/Firestore/invalid
diagnostics shapes computed from explicit inputs (mirroring `backend.ts`'s
own `resolveBackendConfiguration(raw, isProduction)` testing pattern, so
none of this depends on whatever happens to be in the local `.env` at test
time), the returned shape never carrying a fifth key, the create-path
assertion's ok/mock/reasons contract including failing closed on a missing
Worker URL and on a non-worker files backend, that a Mock result's
assertion is always `ok: false` (so it can never present as verified), that
neither the API key nor other Firebase credential env vars are ever read,
the indicator/hook wiring, and that Mock workflows are unaffected. Full
validation: TypeScript build and Vite production build pass; ESLint
passes; Prettier passes on every source file this task touched (`prettier
--check` run directly against each changed `.ts`/`.tsx`/`.mjs` file); the
direct Node suite passes 202/203 in-process (the one already-known
emulator-only exception unchanged, `firestore.rules` untouched); the
production bundle was directly inspected and contains neither the
`[Firestore Init]` nor the `[Create Path]` dev-only console strings.
Live-verified in a running dev session (Firestore+Worker mode): the badge
correctly rendered "FIRESTORE + WORKER" on the Login page. **Correction
(F5d-54D):** a repo-wide `prettier --check .` also reports 8 pre-existing
Markdown formatting findings (`AGENTS.md`, `BUSINESS_RULES.md`,
`CLAUDE.md`, `DATABASE_SCHEMA.md`, `PRINT_SPECIFICATIONS.md`,
`PRODUCT_ROADMAP.md`, `SPRINT_ROADMAP.md`, `UI_GUIDELINES.md`) — these
predate F5d-54, are unrelated to it, were not introduced or touched by
this task, and are intentionally left unreformatted here (reformatting
them is out of this task's scope). The "Prettier pass" statement above
refers only to this task's own changed files, not a clean repo-wide
`prettier --check .`.

**Deployment/environment implications.** No `.env`/`.env.local` change was
made or is required by this task. Any future production frontend
deployment must set `VITE_BACKEND_KIND=firestore`, `VITE_FILES_BACKEND=worker`,
and `VITE_FILES_WORKER_URL` explicitly — the existing fail-closed guard
already prevents a production build from silently defaulting to Mock, and
this task adds no exception to that. A checked-in Mock default remains the
correct, safe default for ordinary local development; it must never be
read as production readiness, and Gate 7.1 acceptance must be judged by
verified production writes (as F5d-50/F5d-52B's own incident review did),
never by a superficially successful-looking ID.

Gate 7.1 remains **pending** (not resumed, not retried by this task).
Production durable writes = zero. No production deployment, mutation, or
Rules/Worker/Auth/IAM change occurred.

### F5d-54B — enforced fail-closed create guard (Terra F5d-54A blocker)

**Terra's F5d-54A finding (blocking).** `assertFirestoreWorkerCreatePath()`
was computed and logged, but nothing actually stopped a create from
proceeding when it reported `ok: false`. Concretely:
`backendKind=firestore` with a non-worker `filesBackend` (or a missing
Worker URL) still reached the Firestore-backed `repositories.serviceJobs.create()`
call — the indicator correctly showed a warning and the assertion
correctly said not-ok, but `useCreateServiceJob.ts`'s original `if
(backendKind === 'mock') {...} else {...}` branch never consulted the
assertion at all before taking the `else` (Firestore) path.

**The distinction this file now states explicitly, per Terra's own
wording:**

- **Runtime indicator** (`RuntimeModeIndicator`) = operator observability.
- **`assertFirestoreWorkerCreatePath()`** = shared readiness evaluation —
  a pure read, the single source of truth both the indicator and the
  guard consume.
- **`performServiceJobCreate()`** (new, `serviceJobCreation.ts`) =
  the enforced fail-closed mutation boundary. This is the only thing
  that decides whether a Firestore create is attempted at all.

**How the guard works.** `performServiceJobCreate(backendKind,
createPathReadiness, delegates)` takes two lazy delegates —
`createViaMock`/`createViaFirestore`, plain functions, not
already-started Promises — plus the current readiness evaluation. Mock
mode calls `createViaMock` unconditionally, exactly as before, with no
Worker dependency (Objective 2: Mock development must never require
Worker configuration). Any non-mock `backendKind` first checks
`createPathReadiness.ok`; if false, it throws `Firestore create path is
not ready for Worker mode (<reasons>). Contact a developer before
retrying.` — using only the already-sanitized `reasons` strings
`computeCreatePathAssertion()` produces (e.g. `'filesBackend is not
"worker"'`), never a raw URL, key, or env dump — and `createViaFirestore`
is never called. Because the Firestore delegate is a lazy closure,
nothing inside it (idempotency-key generation via `crypto.randomUUID()`,
the repository call, the eventual Worker fetch) can run before the
readiness check — confirmed by a dedicated test asserting the delegate's
side effect never fires on rejection.

**Firestore readiness truth table (Objective 3), all confirmed by
behavioral tests with spy delegates in `serviceJobCreateGuard.test.mjs`:**

| backendKind  | filesBackend | Worker URL | Result                                                                                                                                   |
| ------------ | ------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| mock         | any          | any        | Mock create allowed (Worker irrelevant)                                                                                                  |
| firestore    | worker       | configured | Firestore create allowed                                                                                                                 |
| firestore    | worker       | missing    | Rejected before any delegate runs                                                                                                        |
| firestore    | non-worker   | any        | Rejected before any delegate runs                                                                                                        |
| invalid/null | —            | —          | App-level `BackendConfigurationGate` already prevents this state from reaching the hook at all; the guard rejects defensively regardless |

10 new tests (`serviceJobCreateGuard.test.mjs`) prove actual dispatch
behavior with spy delegates (call counts, not just source-text pattern
matching): Mock invokes `createViaMock` exactly once regardless of
readiness; a ready Firestore path invokes `createViaFirestore` exactly
once; a missing Worker URL and a non-worker files backend each reject
with neither delegate invoked; an invalid `backendKind` never invokes
either delegate; the guard and `computeCreatePathAssertion()` agree
across every backend/filesBackend/worker combination; the rejection
message contains no secret-shaped content; and the Firestore delegate's
side effect provably never runs before rejection. Regression-confirmed
unchanged: all 18 `runtimeDiagnostics.test.mjs` tests still pass (the
indicator/assertion logic itself was not modified), the badge still
renders "FIRESTORE + WORKER" live in a running dev session, Mock
workflows are unaffected, `BackendConfigurationGate` still blocks a
production+Mock configuration, and both `[Create Path]` and `[Firestore
Init]` remain absent from the production bundle. Full validation: build
clean, lint clean, direct suite 212/213 in-process (the one already-known
emulator-only exception unchanged).

Gate 7.1 remains **pending**. Production durable writes = zero. No
production deployment, mutation, or Rules/Worker/Auth/IAM change occurred.

### F5d-54D — finalization: non-blocking hardening backlog

Terra's F5d-54C re-audit passed with non-blocking findings. Recorded here
as **low-priority future hardening only**, not implemented in this task:

- `performServiceJobCreate()` currently relies on the app-level invariant
  that `backendKind` and `createPathReadiness` are always derived
  together from the same `runtimeDiagnostics.ts` read. A hypothetical
  external caller could in principle supply an inconsistent pair (e.g.
  `backendKind: null` with `createPathReadiness.ok: true`), which the
  function would not catch on its own. No caller in this application can
  currently construct that inconsistent pair — `useCreateServiceJob.ts`
  is the only production caller, and it always derives both values from
  one `assertFirestoreWorkerCreatePath()` call. A future hardening could
  have `performServiceJobCreate()` explicitly reject any `backendKind`
  other than `'mock'`/`'firestore'` rather than trusting the caller — left
  as optional future work, not a defect in the current, sole call site.
- The existing Vite chunk-size warning (`firebase-*.js` / `index-*.js`
  exceeding the 500 kB default limit) predates this task and remains
  non-blocking technical debt.
- The 8 pre-existing Markdown Prettier findings noted above remain
  non-blocking technical debt, unrelated to and untouched by F5d-54.

## F5d-55 — Browser fetch receiver binding (Gate 7.1 failed safely, before HTTP transport)

**Gate 7.1's manual UI acceptance failed safely, at the transport layer,
before any HTTP request reached the network.** The browser reported
`Failed to execute 'fetch' on 'Window': Illegal invocation`. Independent
production verification confirmed this was a clean, no-op failure:
`BRN-2026-000002` absent, acceptance Service Job count = 0, no
intake-key mapping, both Bruno sequences absent/logically 0, the
protected `BRN-2026-000001` unchanged, and the Worker's
`POST /service-jobs` was **never reached**. **Durable production writes
from this attempt = ZERO.**

**Exact root cause.** `src/auth/workerTokenProvider.ts` built its default
browser fetch dependency as `const browserWorkerFetchDependencies = {
fetch }` — copying the native `fetch` function reference onto a plain
object with no receiver. Chrome's native `fetch` is a WebIDL
"unforgeable" method that requires Window (or another Window-like global)
as its `this`; calling it as `dependencies.fetch(...)` invoked native
fetch with `dependencies` — an ordinary plain object — as the receiver,
which Chrome rejects with exactly the observed error. This was purely a
JavaScript receiver-binding mistake, not an auth, token, CORS, Worker, or
Rules problem — reconfirmed below (Objective 4) by tracing the full
transport path end to end.

**The fix.** `browserWorkerFetchDependencies.fetch` is now
`globalThis.fetch.bind(globalThis)` — permanently rebinding the receiver
to the real global object, so the bound function behaves correctly
regardless of what object it's later attached to or called through. This
is the smallest possible correction: one `const` initializer, no redesign
of `WorkerTokenProvider`, `fetchWithWorkerToken`, or any caller. Dependency
injection is fully preserved — `fetchWithWorkerToken`'s `dependencies`
parameter and its default-value shape are unchanged, so every existing
test that injects a fake `fetch` (token refresh, 401 retry, 403, missing
token) continues to work exactly as before.

**Browser-faithful regression proof (not source-text only).** New
`workerFetchReceiverBinding.test.mjs` reproduces Chrome's actual receiver
check with a real `function` (not an arrow function, since only a real
function has call-site-dependent `this`) that throws
`"Illegal invocation"` unless invoked with `this === globalThis` — proving
the _old_ `{ fetch: nativeStyleFetch }.fetch(...)` pattern genuinely
throws, and the _fixed_ `.bind(globalThis)` pattern genuinely succeeds.
Critically, one test patches `globalThis.fetch` to this same
receiver-checking simulator and loads `workerTokenProvider.ts` fresh (a
dedicated Vite server, so the module-level `const` re-evaluates against
the patched global) with **no `dependencies` override at all** — directly
exercising the real production default path, not a re-implementation of
the pattern, and confirms the observed receiver is genuinely
`globalThis`.

**Token/credential safety (Objective 4), reconfirmed.** The full transport
path (Firebase authenticated user → `WorkerTokenProvider.getIdToken()` →
the bound fetch dependency → `Authorization: Bearer <idToken>` header →
`POST /service-jobs`) is unchanged by this fix — only the fetch
dependency's receiver was corrected, nothing about token
lifetime/caching/refresh semantics. `workerTokenProvider.ts` contains no
`console.*` call anywhere, and the ID token appears textually in exactly
one place: the `Authorization` header template. A test confirms the
"missing token" error message never contains a token/Bearer/API-key-shaped
value.

**F5d-54 create-path guard regression (Objective 5), reconfirmed
unchanged, no source touched:** all `serviceJobCreateGuard.test.mjs` and
`runtimeDiagnostics.test.mjs` tests still pass — Mock mode remains usable,
the FIRESTORE + WORKER indicator remains correct, the Firestore create
guard remains fail-closed (missing Worker URL and non-worker files backend
both still reject), and the idempotency-key `crypto.randomUUID()` remains
generated only after `performServiceJobCreate()`'s readiness check passes.

7 new tests (`workerFetchReceiverBinding.test.mjs`) plus the 5 existing
`workerTokenProvider.test.mjs` tests (unchanged, still passing) validate
this fix directly. Combined with the unchanged F5d-54 regression suites
(`serviceJobCreateGuard.test.mjs`: 10, `runtimeDiagnostics.test.mjs`: 18),
the F5d-55 focused total is **40/40 passing** (Terra F5d-55A-verified).
Full validation: TypeScript build and Vite production build pass; ESLint
passes; Prettier passes on every file this task touched; the direct Node
suite passes 219/220 in-process (the sole exception is
`firestoreRules.test.mjs` when run outside its dedicated emulator wrapper
— it independently passes 11/11 via `npm run test:firestore-rules`,
unaffected since `firestore.rules` was not touched). No Worker source or
contract was touched, so the Worker test suite was not re-run.

Gate 7.1 remains **PAUSED**, pending: a fresh independent audit of this
remediation, a local checkpoint/commit once that audit passes, and a
freshly-scoped preflight before any further live rehearsal is attempted.
This document does not claim Gate 7.1 succeeded — the historical manual
attempt failed safely before reaching the network, with zero durable
production writes and the protected BRN unchanged. No production
deployment, mutation, or Rules/Worker/Auth/IAM change occurred.

## F5d-56 — Worker allocator safe stage diagnostics (Gate 7.1 reached the Worker, returned a generic 500)

**F5d-55's fix let the next approved Gate 7.1 submit reach the live
Worker** — it returned `HTTP 500` / `Worker Service Job creation failed
(500)`. Independent production verification confirmed the same clean,
no-op outcome as every prior attempt: `BRN-2026-000002` absent, zero
acceptance Service Jobs, zero intake-key mappings, both Bruno sequences
absent/logically 0, the protected `BRN-2026-000001` unchanged, no
Customer/Product/R2 mutation, and full atomicity — no partial allocator
footprint exists anywhere. **Durable production writes = ZERO.** The
request reached the Worker and passed Firebase bearer verification and
staff/brand authorization (a 401/403 would look different), but the
Worker's `handleServiceJobCreate()` collapsed every allocator-internal
exception into one `console.error('...', error)` call and one generic
500, discarding exactly the stage detail needed to reproduce and fix it.
**The exact underlying stage that failed remains UNKNOWN** — this task
adds observability only, not a fix, and no controlled reproduction with
the new diagnostics in place has been run yet.

**Allocator pipeline traced (Objective 1).** `POST /service-jobs` →
`authorizeStaffCreation()` (Firebase bearer verify, then
`getAuthorizedStaffProfile()`) → request/idempotency-key validation
(`worker/src/index.ts`) → `allocateServiceJob()` (`serviceJobCreation.ts`):
begin transaction → intake-key read (idempotent-replay check) → tracking
sequence read → service-request sequence read → occupied-ID collision
probe (repeated `getServiceJob` reads) → one atomic `:commit` (intake key

- Service Job + both sequence documents) → response construction. Every
  Firestore-touching step first acquires a service-account OAuth token
  (`googleAuth.ts`'s `getAccessToken()`).

**Diagnostic stage model (Objective 2).** New `worker/src/allocatorDiagnostics.ts`
defines exactly eight stages matching the real source above:
`oauth-token`, `firestore-transaction-begin`, `intake-key-read`,
`tracking-sequence-read`, `service-request-sequence-read`,
`occupied-id-read`, `firestore-commit`, `response-build`. On failure it
logs one sanitized line — `[ServiceJob Allocator] <stage>: <code>` — via
`console.error`, e.g. `[ServiceJob Allocator] firestore-commit:
PERMISSION_DENIED`. `<code>` is drawn only from a closed, safe set: a
recognized Google gRPC-style error `status` (`PERMISSION_DENIED`,
`UNAUTHENTICATED`, etc., extracted only from a parsed `error.status`
field, never `error.message`), a bare `http-<status>` fallback, or a
handful of fixed literals (`not-configured`, `transaction-conflict`,
`unknown`). Never logged: the Authorization header, Firebase ID token,
service-account private key, access token, any intake field (customer
name/phone/email/serial/problem description/internal note), a raw request
body, a Firestore document path (this app's customer documents are legacy
phone-keyed — DECISIONS.md #031/#039 — so a path can itself be a phone
number), or a raw Google API response body.

**OAuth vs. Firestore REST coverage (Objective 5), full-boundary as of
F5d-56B.** `oauth-token` is distinguished from every Firestore-specific
stage by wrapping each allocator-relevant `firestoreClient.ts` method's
`getAccessToken()` call in its own try/catch, separate from the
subsequent operation — so a token-exchange failure is never folded into a
Firestore stage, and vice versa. Firestore transaction-begin, each of the
three distinct reads (intake-key, tracking-sequence, service-request-
sequence, occupied-id), and commit are each tagged independently — not
one collapsed "allocator" stage. As of F5d-56B (see below), each of these
stages covers the **full** non-OAuth operation boundary — network
transport, HTTP-status handling, response parsing, and local structural
validation — not only a non-OK HTTP response.

**Client-response safety (Objective 3) and error wrapping (Objective 4).**
`handleServiceJobCreate()`'s client-facing response is completely
unchanged — still the generic `{error: 'Unable to create Service Job'}` / 500. Its one change: the catch-all `console.error('...', error)` no longer
dumps the raw error object (which could embed a raw Google response body
via `FirestoreRequestError.message`) — the sanitized stage line was
already logged at the exact point of failure inside `firestoreClient.ts`,
so this line now reads `console.error('[files-worker] Service Job create
failed')` with nothing appended. `ServiceJobAllocatorStageError` exists as
a narrow typed carrier purely to format the log line consistently — it is
**never thrown or returned in place of the original exception**; every
stage-tagging wrapper logs, then rethrows the original error completely
unchanged, so `TransactionConflictError`'s `instanceof` check (and the
409/412 retry it drives) and every other existing control-flow decision
are untouched.

**Atomicity reconfirmed (Objective 6).** The single `:commit` request
still contains exactly the same four writes it always did (intake key +
Service Job + both sequence documents) — verified unchanged by the
existing `serviceJobAllocatorCommit.test.mts`, still passing without
modification. No diagnostic Firestore write of any kind was added;
diagnostics are `console.error`-only.

**Occupied-ID skip independently re-verified (Objective 7).** New
`allocatorOccupiedIdSkip.test.mts` proves, against the real
`createFirestoreClient()` with only the network boundary stubbed: the
occupied `BRN-2026-000001` is read (GET) and never appears in any write;
the allocator selects `BRN-2026-000002`; the tracking-sequence document is
written as `2` only inside the one atomic `:commit` (no sequence write
happens outside it); and the protected existing record is never part of
the commit write set.

Original F5d-56 validation (superseded in scope by F5d-56B below, kept
here as the historical starting point): 3 new files
(`allocatorDiagnostics.test.mts`, `allocatorStageAttribution.test.mts`,
`allocatorOccupiedIdSkip.test.mts`) proved stage attribution for the
non-OK-HTTP-response case only. `worker/src/allocatorDiagnostics.ts` and
the `firestoreClient.ts`/`index.ts` edits introduced zero new `tsc
--noEmit` errors.

**Non-blocking finding, pre-existing, not introduced by this task:**
`cd worker && npm run typecheck` currently fails with 6
`TS2339: Property 'env' does not exist on type 'ImportMeta'` errors in
`../src/config/backend.ts`/`filesBackend.ts`/`runtimeDiagnostics.ts`.
These three frontend files are pulled into the Worker's type-declaration
graph transitively via a `import type` chain
(`worker/src/serviceJobCreation.ts` → `src/services/serviceJobCreation.ts`
→ `src/config/backend.ts`/`runtimeDiagnostics.ts`, present since F5d-54
added that import) — `worker/tsconfig.json` has no Vite `ImportMetaEnv`
ambient types, so `import.meta.env` doesn't type-check there. Confirmed to
be a pure type-declaration artifact, not a runtime defect: because every
such import in the Worker source is `import type` (erased entirely before
execution), and the full Worker test suite — run directly via `node`,
which strips types without checking them — passes cleanly (`npm test`
exits 0, 0 `FAIL` lines) both before and after this task's changes,
confirmed identically after F5d-56B too. Not fixed here (out of this
task's scope); left as a discovered, non-blocking finding for a future
ticket. **`worker: npm run typecheck` is never described as "clean"
anywhere in this document** — it fails identically at the committed
baseline and after this task.

### F5d-56B — full operation-boundary attribution (Terra F5d-56A blocker)

**Terra's F5d-56A finding (blocking).** F5d-56's diagnostic only reliably
attributed a failure when a Firestore REST call returned a non-OK HTTP
response. A rejected `fetch()` promise, a response body that fails to
parse as JSON, or a structurally malformed-but-200-OK response could all
still escape unattributed — reaching the client as a bare generic 500
with no `[ServiceJob Allocator]` line at all, defeating the point of the
diagnostic on the next reproduction.

**Full-boundary design (Objective 1).** New `runAllocatorStage(stage,
operation)` in `allocatorDiagnostics.ts` wraps an allocator operation as
one unit — network transport, HTTP-status handling, response parsing, and
any local structural validation the operation performs — catching
whatever it throws, logging once, and rethrowing the original error
completely unchanged. OAuth token acquisition is never inside this
wrapper; every call site acquires its token in its own separate try/catch
tagged `oauth-token` first, so an OAuth failure is never misclassified as
a Firestore-stage failure (Objective 1, reconfirmed by 12 dedicated
tests — one per stage, proving the failure is attributed `oauth-token`
and never the stage that operation guards).

**Single-stage semantics without cascaded/double logging (Objective 2).**
`logAllocatorStageFailure()` tracks already-logged error objects by
_identity_ (a `WeakSet`, not by stage or message). `getSequence()`, for
example, wraps both `getDocument()`'s own read-level `runAllocatorStage`
call _and_ its own post-read numeric-validation check with the same
stage — when the read itself fails, the outer wrap sees the identical
already-logged error object and skips re-logging, but still rethrows;
when the read succeeds and only the later validation throws (a distinct,
never-before-seen error object), the outer wrap logs it for the first
time. The result: exactly one `[ServiceJob Allocator]` line per real
failure, always from the first/innermost boundary that actually saw it —
never an OAuth failure followed by a second, redundant Firestore-stage
line for the same error.

**Rethrow discipline (Objective 3).** Every wrap still only ever logs
then `throw`s the exact original error object — never a replacement.
`TransactionConflictError` remains the exact type `allocateServiceJob()`'s
retry logic checks via `instanceof`; `logAllocatorStageFailure()` itself
unconditionally skips logging it (a 409/412 is expected, retried
behavior, never a genuine failure to diagnose), independent of the
`WeakSet` dedup or how deeply it's wrapped.

**Coverage per stage (Objectives 4–7).** `beginServiceJobTransaction()`
and `commitServiceJobCreation()`'s full bodies (fetch → status check →
parse/validate) are each one `runAllocatorStage` call. Reads
(`intake-key-read`/`tracking-sequence-read`/`service-request-sequence-read`/`occupied-id-read`)
get this coverage through `getDocument()`'s own wrap; the two sequence
reads additionally wrap their own post-read numeric-validation throw
(`getIntakeKey`/`getServiceJob` have no post-read validation throw to
cover — a malformed document there already resolves to `null`,
unchanged, matching existing behavior, not a new gap). `response-build`
in `index.ts` is unchanged from F5d-56 — documented, not artificially
instrumented further: `JSON.stringify` over a `ServiceJob` this codebase
fully constructs from already-sanitized fields cannot realistically throw
(no circular reference, `BigInt`, or function reaches it), so this
remains a defensive wrap around a boundary that isn't realistically
triggerable, exactly as Objective 7 asked to document rather than fake.
Commit's response is never parsed on success (no `.json()` call exists on
that path), so "invalid JSON" does not apply there — documented, not
tested, for the same reason.

**Safe codes (Objective 8).** Two new codes, both drawn from the same
closed vocabulary: `network-error` (a rejected `fetch()` promise —
classified via `instanceof TypeError`, the Fetch API's own documented
rejection shape) and `invalid-json` (`response.json()`/`JSON.parse`
failing — via `instanceof SyntaxError`). A third, `invalid-response`, is
produced only by matching two exact, static, developer-authored message
strings this codebase itself throws
(`'Firestore returned malformed transaction'`,
`'Firestore sequence is malformed'`) — never derived from
`error.message` in general, a response body, a document path, or a
request body. `serialization-error` remains part of the documented
vocabulary but is never produced by any branch — the commit path's
`JSON.stringify` calls serialize only values this codebase already
validated, so there is no realistic input that reaches it.

**Adversarial sanitization (Objective 9) and behavioral tests (Objective
10).** New `allocatorFullBoundaryAttribution.test.mts` parameterizes all
six non-OAuth-token stages across: a rejected fetch (network-error), an
unparsable JSON body (invalid-json, for every stage that actually parses
a response body), a malformed-but-200-OK body (invalid-response, for the
two stages with a real post-read validation throw), and an adversarial
case where the stubbed Firestore error response embeds a phone number, a
Firestore document path, a Bearer-token-shaped string, a private-key
fragment, and acceptance problem text — verified, per stage, to never
appear in any logged diagnostic line. A twelfth block (one per stage)
reconfirms OAuth failures are attributed `oauth-token` and never
misclassified as that stage's own name.

**Occupied-ID test strengthened (Objective 11), no allocator behavior
changed.** `allocatorOccupiedIdSkip.test.mts` now additionally asserts
the allocated job's Service Request number is exactly
`SR-2026-000001`, and that the commit's Service Request sequence write
is `1` (unaffected by the tracking-ID collision) — alongside its existing
assertions that the occupied `BRN-2026-000001` is read and never written,
the allocator selects `BRN-2026-000002`, the tracking sequence commits as
`2`, and the protected record never appears in the write set.

**Tests/results, defensible accounting (Objective 12).** Deterministically
counted via `grep -c '  PASS'`/`'  FAIL'` on each file's own output, not
invented: `allocatorDiagnostics.test.mts` 16/0,
`allocatorStageAttribution.test.mts` 20/0,
`allocatorFullBoundaryAttribution.test.mts` (new) 46/0,
`allocatorOccupiedIdSkip.test.mts` 9/0 — 91 checks across these four
files, 0 failures. Pre-existing, unmodified-behavior files reconfirmed
still passing: `serviceJobAllocatorCommit.test.mts` 8/0,
`serviceJobCreation.test.mts` 13/0. Full suite (17 files, `npm test`
exits 0): 278 total `PASS` lines, 0 `FAIL` lines, counted the same
deterministic way across the complete run. `worker: npx tsc --noEmit`
produces the identical 6 pre-existing errors (see above) both before and
after this remediation — zero new errors introduced.

### F5d-56D — occupied-ID parser attribution closure (Terra F5d-56C blocker)

**Terra's F5d-56C finding (blocking).** F5d-56B's re-audit found that
`getServiceJob()` delegated its network read to `getDocument(...,
'occupied-id-read')`, but then called `parseServiceJobDocument(doc)`
_outside_ that wrap — the one accessor in this file, unlike every other
one, that reads `doc.name.split('/')` without optional chaining. Terra
reproduced this with a genuinely 200-OK, validly-JSON, but structurally
malformed Firestore response body — `{}` — which made
`parseServiceJobDocument()` throw a real `TypeError` (`doc.name` is
`undefined`) that escaped both the read-level wrap (the read itself
succeeded) and any outer wrap (there wasn't one), reaching the client as
a bare, unattributed generic 500. **F5d-56/F5d-56B's diagnostics were not
deploy-ready before this remediation** — this was a real, reproducible
gap in exactly the boundary Gate 7.1's own failure sits in.

**Fix.** `getServiceJob()`'s full body — the read _and_
`parseServiceJobDocument()` — is now one `runAllocatorStage('occupied-id-read',
...)` unit, the same pattern already used for `getSequence()`'s own
post-read validation. The parse call's error is caught and marked via a
new `markAsLocalValidationError()` (identity-tracked via a `WeakSet`, not
a replacement/wrapper) purely so `classifyAllocatorError()` can tell it
apart from a genuine `fetch()` rejection — both are `TypeError`, but only
one is a real network failure. The original error object, its
`instanceof`, `.stack`, and `.message` are all completely untouched; only
what gets logged is affected. Safe code: `invalid-response` (not
`network-error`) — reserved exclusively for this class of local
parsing/validation failure, never for an actual transport error.

**Single-stage guarantee reconfirmed.** For this exact path (malformed
200-OK → parser throws), exactly **one** `[ServiceJob Allocator]
occupied-id-read: invalid-response` line is emitted — proven directly,
not inferred.

**Primitive-throw dedup (Objective 6) — theoretical, non-blocking, not
broadened.** The `WeakSet`-based already-logged dedup (F5d-56B) cannot
track a thrown primitive (string/number/boolean), which could in
principle re-log at nested boundaries. Every throw site in
`worker/src/*.ts` was reviewed (`serviceJobCreation.ts`,
`firestoreClient.ts`, `googleAuth.ts`, plus the runtime `TypeError`/
`SyntaxError` this code can encounter) — none throws a bare primitive
today, so there is no currently-reachable path. Documented as low-priority
future hardening in `allocatorDiagnostics.ts` itself; not implemented,
per this ticket's own instruction not to broaden scope for a hypothetical.

**Regression reconfirmed, no allocator behavior changed.** The
strengthened occupied-ID success test
(`allocatorOccupiedIdSkip.test.mts`) still proves: `BRN-2026-000001` read,
never written; allocated job `BRN-2026-000002`; Service Request number
`SR-2026-000001`; tracking sequence commits as `2`; Service Request
sequence commits as `1`; the protected record absent from the commit
write set. Every previously-passing attribution scenario (OAuth,
transaction-begin, all four reads, commit, 409/412-not-logged) still
passes unmodified. The atomic commit still contains exactly the same four
writes (intake key, Service Job, tracking sequence, Service Request
sequence) — no diagnostic write, no extra transaction, no retry/
idempotency change.

**Tests/results, defensible accounting.** New
`allocatorOccupiedIdParserAttribution.test.mts`: 7/7, deterministically
counted via `grep -c '  PASS'`/`'  FAIL'` — and confirmed, by temporarily
reverting just the `getServiceJob()` fix and re-running, that 3 of its 7
checks genuinely fail against the pre-F5d-56D implementation (zero
`[ServiceJob Allocator]` lines emitted), then confirmed passing again
once restored. Combined with F5d-56B's four files (91 checks), the
allocator-diagnostics-specific total is 98 checks, 0 failures, across 5
files. Full Worker suite (18 files, `npm test` exits 0): **285 total
`PASS` lines, 0 `FAIL` lines** (278 + 7 new), same deterministic counting
method. `worker: npx tsc --noEmit` still produces the identical 6
pre-existing errors — zero new errors introduced by F5d-56D.

**Coverage claim, precisely scoped.** All realistic allocator transport/
parse/validation paths covered by current source and tests — network
transport, HTTP-status handling, response/body parsing, and every local
structural-validation throw this codebase's allocator methods actually
contain — are now attributed to a specific stage. This is not a claim of
absolute coverage against every conceivable JavaScript exception; it is
substantiated by the behavioral tests above, not asserted beyond them.

**Underlying defect status: still UNKNOWN.** F5d-56, F5d-56B, and F5d-56D
fix nothing about the live Worker 500 itself — all three add observability
only. The next controlled reproduction of Gate 7.1 (once separately
approved) will, for the first time, produce a `[ServiceJob Allocator]
<stage>: <code>` log line pinpointing exactly which stage failed, across
the full operation boundary — that reproduction has not yet happened.
Diagnostics remain **undeployed**. Production durable writes from the
prior Gate 7.1 attempt remain **ZERO**.

Gate 7.1 remains **PAUSED**. Production durable writes = ZERO. No
production deployment, mutation, or Rules/Worker/IAM/Auth change
occurred.

## F5d-59 — Transaction retry exhaustion diagnostic closure

**Latest approved Gate 7.1 reproduction.** The browser again showed
`Worker Service Job creation failed (500)`. Independent production
verification confirmed the same clean, no-op outcome as every prior
attempt: `BRN-2026-000002` absent, zero acceptance Service Jobs, zero
intake-key mappings, both Bruno sequences absent/logically 0, the
protected `BRN-2026-000001` unchanged — **durable production writes =
ZERO.** The F5d-56/56B/56D diagnostics Worker was active for this
reproduction, but the already-running `wrangler tail` stdout was not
retained in a form the verification task could inspect afterward, so
**the exact failing stage still could not be read back.** This document
does not claim the live failure was transaction-retry exhaustion
specifically — that remains one possibility among several the F5d-56
family of diagnostics can now distinguish, not a confirmed cause.

**Blind spot found by source review, independent of the above.**
`logAllocatorStageFailure()` (F5d-56) intentionally never logs a
`TransactionConflictError` — a 409/412 is expected, retried
optimistic-concurrency behavior, not a genuine failure, and logging it on
every retry would be noise. But `allocateServiceJob()`'s retry loop
(`worker/src/serviceJobCreation.ts`) rethrows the **final** attempt's
`TransactionConflictError` exactly the same way it rethrows a retryable
one — so that unconditional skip also silenced genuine exhaustion, which
could then reach the client as an unattributed generic 500 exactly like
the gaps F5d-56/56B/56D closed elsewhere.

**Retry loop, traced from source (Objective 1).** `MAX_TRANSACTION_RETRIES
= 5`. `allocateServiceJob()` loops `attempt = 0..4` (5 attempts total);
each attempt calls `dataAccess.commitServiceJobCreation()` once. Firestore
REST returns `409`/`412` on an optimistic-concurrency conflict against the
`:commit` request, which `firestoreClient.ts`'s `commitServiceJobCreation`
turns into `throw new TransactionConflictError()`. The loop's catch:
`if (error instanceof TransactionConflictError && attempt + 1 <
MAX_TRANSACTION_RETRIES) continue;` — i.e. only continues when there is at
least one attempt left; otherwise it falls through to `throw error`,
rethrowing the **original, unmodified** `TransactionConflictError`. One
correction to this ticket's own background: the terminal `throw new
Error('Service Job transaction retries exhausted')` after the loop (line 148) is source-confirmed **unreachable** given this control flow — every
loop iteration always either `return`s (success/idempotent replay) or
`throw`s (a non-conflict error immediately, or the final attempt's
`TransactionConflictError`) from inside the loop body itself, so the loop
can never fall through to its own end. This diagnostic therefore targets
the real exhaustion path (the final attempt's rethrown
`TransactionConflictError`), not the dead "retries exhausted" `Error`
literal the background section describes — the dead code itself was left
completely untouched, since removing it is out of this ticket's
diagnostics-only scope.

**Terminal exhaustion diagnostic (Objective 2).** A new
`logAllocatorTransactionRetriesExhausted()` in `allocatorDiagnostics.ts`
logs the fixed literal `[ServiceJob Allocator] firestore-commit:
transaction-retries-exhausted` — no error object, no interpolated content,
so nothing to sanitize by construction. It is called from exactly one
place: `allocateServiceJob()`'s catch block, only when a
`TransactionConflictError` reaches the point the loop has already decided
not to retry (i.e. `attempt + 1 >= MAX_TRANSACTION_RETRIES`). A retryable
conflict (any attempt before the last) hits `continue` first and never
reaches this call — normal retries stay completely silent, exactly one
line is emitted for genuine exhaustion, and the existing generic
client-facing 500 is unchanged.

**Retry semantics preserved exactly (Objective 3).** Attempt count (5),
`TransactionConflictError` `instanceof` behavior, idempotency (intake-key
replay), the transaction boundary, the four-write atomic commit,
occupied-ID collision handling, and sequence allocation are all completely
unmodified — confirmed by `serviceJobCreation.test.mts`'s unchanged
conflict/idempotency tests still passing. No new Firestore call and no
diagnostic write were added; the new call is a single `console.error`.

**Original/terminal error preserved (Objective 4).** The rethrown error at
exhaustion is the same `TransactionConflictError` instance the last
attempt threw — not wrapped, not replaced, not the dead "retries
exhausted" `Error`. The diagnostic call sits immediately before the
existing `throw error`, purely observing the transition; it does not
create a different HTTP contract (the client still receives the existing
generic `500` / `{"error":"Unable to create Service Job"}`).

**Tests (Objective 5), new file
`allocatorTransactionRetryExhaustion.test.mts` — 16/16.** Scenario A
(single retried conflict then success): no `[ServiceJob Allocator]` line,
normal success. Scenario B (`MAX_TRANSACTION_RETRIES - 1` conflicts, then
success on the last allowed attempt): still no diagnostic line, normal
success. Scenario C (every one of `MAX_TRANSACTION_RETRIES` attempts
conflicts): exactly one diagnostic line, `firestore-commit:
transaction-retries-exhausted`, the original `TransactionConflictError`
rethrown unchanged, and zero partial writes (the fake store's
`committed` flag never set). Scenario D: the logged line is the fixed
literal alone — proven to contain none of a synthetic phone number,
idempotency UUID, bearer-token-shaped string, or document path. A fifth
end-to-end block reruns scenario C against the real
`createFirestoreClient()` + `createWorkerHandler()` stack with only
`fetch` stubbed, confirming exactly `MAX_TRANSACTION_RETRIES` `:commit`
REST calls occur, the client response stays the existing generic 500, and
the same one diagnostic line is emitted server-side. **Necessity proven
directly**: temporarily reverting the new call site in
`serviceJobCreation.ts` and rerunning reproduced 4 genuine failures (no
diagnostic line / wrong content on scenarios C, D, and the E2E block);
restoring the fix reconfirmed all 16 passing.

**Regression (Objectives 5/9).** `serviceJobCreation.test.mts`'s existing
conflict/idempotency tests unchanged and passing. All five prior
allocator-diagnostics files re-run unmodified: `allocatorDiagnostics.test.mts`
16/16, `allocatorStageAttribution.test.mts` 20/20,
`allocatorFullBoundaryAttribution.test.mts` 46/46,
`allocatorOccupiedIdParserAttribution.test.mts` 7/7,
`allocatorOccupiedIdSkip.test.mts` 9/9 — zero regressions. Full Worker
suite (19 files, `npm test` exits 0): **301 total `PASS` lines, 0 `FAIL`
lines** (285 prior + 16 new), counted the same deterministic
`grep -c '  PASS'`/`'  FAIL'` way. `worker: npx tsc --noEmit` produces the
identical 6 pre-existing `ImportMeta.env` errors both before and after —
zero new errors, including from the new `serviceJobCreation.ts` ↔
`allocatorDiagnostics.ts` circular import (confirmed safe: neither module
uses the other's binding at top-level module-evaluation time, only inside
function bodies called later at runtime).

**Log capture procedure — superseded by F5d-59B (Terra F5d-59A
blocker).** The original procedure above (F5d-59) did not guarantee an
explicit Worker name, an explicit deployed-version target, guaranteed
directory creation, guaranteed stderr capture, a known retained file path
before submit, or a documented way to verify retention was actually
happening before the click. Terra blocked F5d-59 on this gap alone — the
F5d-59 source remediation itself (retry-loop tracing, the terminal
diagnostic, sanitization, tests) passed audit unchanged. See ### F5d-59B
below for the corrected, verified procedure; do not use the version that
was here.

### F5d-59B — reliable Wrangler tail retention procedure (Terra F5d-59A blocker)

**What was verified before documenting this, and how.** `npx wrangler
tail --help` was run against the actually-installed CLI
(`wrangler 4.120.0`, from `worker/package.json`'s devDependency) to
confirm every flag below is real, not guessed: `[worker]` is a
positional argument (not a flag), and `--version-id` is a supported
option. `npx.cmd` (not the bare `npx` shim) was confirmed to resolve on
this machine (`C:\Program Files\nodejs\npx.cmd`) — using the `.cmd`
explicitly avoids PowerShell's separate `npx.ps1` execution-policy path.
The chosen log directory, `C:\service\.runtime-logs`, does **not** need a
`.gitignore` change: `git check-ignore -v` confirms its `*.log` files are
already matched by the existing root `.gitignore`'s unqualified `*.log`
rule (line 2) — verified directly with a throwaway probe file, which was
then deleted; `.gitignore` itself was not touched. The live-view +
retention mechanism (`2>&1 | Tee-Object -FilePath ...`) was validated
with a safe, local, non-production PowerShell probe (a background job
writing to stdout and stderr with delays between lines, never touching
the Worker or Firestore) — confirmed the target file already contained
line 1 while the job's `State` was still `Running` (proving Tee-Object
writes incrementally, not just at process exit), and confirmed the final
file contained every stdout and stderr line after completion. No
`wrangler tail` connection was opened against the real Worker and no
Service Job was created by this verification.

**Approved diagnostics Worker/version to target.** Worker
`service-tech-files-worker`, version-id
`a3261063-2b5c-48e8-8b69-2f3e252ae265` — the future reproduction must
target this exact version unless a later approved deployment changes it.

**The procedure, run from `C:\service` in PowerShell:**

```powershell
# 1. Local, already-gitignored runtime-log directory (created fresh each
#    time; safe to re-run). Outside worker/src and worker/test — never a
#    tracked source location.
$logDir = "C:\service\.runtime-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# 2. The exact retained file path is known BEFORE the tail is started,
#    and therefore before the Gate 7.1 submit.
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$tailLog = Join-Path $logDir "gate71-worker-tail-$stamp.log"
Write-Output "Tail log will be retained at: $tailLog"

# 3. Start tail BEFORE the browser submit, in its own dedicated terminal
#    window (this command blocks that window for the duration of the
#    session). Explicit Worker name + explicit --version-id pin this to
#    the approved diagnostics deployment, never "whatever is live now."
#    2>&1 merges Wrangler's own stderr (connection errors, auth failures)
#    into the same stream Tee-Object captures; Tee-Object writes both to
#    the console (live view) and to $tailLog (retained) as each line
#    arrives, not only when the process exits.
npx.cmd wrangler tail service-tech-files-worker `
  --format pretty `
  --version-id a3261063-2b5c-48e8-8b69-2f3e252ae265 `
  2>&1 | Tee-Object -FilePath $tailLog
```

**Pre-submit retention check — superseded by F5d-59D (Terra F5d-59C
finding).** The check above assumed Terminal 2 could simply reuse
`$tailLog` — but `$tailLog` is a PowerShell _variable_, scoped to
Terminal 1's own session. Terminal 1 is occupied for the whole tail
duration by the long-running `wrangler tail | Tee-Object` pipeline, so a
genuinely separate Terminal 2 (a different PowerShell process, as any
real second terminal window is) never inherits `$tailLog` and cannot run
`Test-Path $tailLog` against the intended file — it would either error on
an undefined variable or silently check the wrong thing. Terra caught
this before it could cause a false "capture confirmed" read on the live
operator machine. See ### F5d-59D below for the corrected, persisted-
pointer-based procedure; do not rely on a bare `$tailLog` variable across
terminals.

This procedure captures only `console.log`/`console.error` output and
request metadata (method/URL/status/outcome) that `wrangler tail` reports
by default — it never logs Authorization headers, ID tokens,
service-account keys, or request/response bodies, because no code path in
this Worker logs those today (see the sanitization guarantees documented
throughout F5d-56/56B/56D). No production reproduction, `wrangler tail`
connection to the real Worker, or Service Job creation was performed by
F5d-59, F5d-59B, or F5d-59D — only local, non-production mechanics were
ever verified.

### F5d-59D — cross-terminal tail path remediation (Terra F5d-59C finding)

**The defect.** F5d-59B's Terminal 1 created `$tailLog` and immediately
occupied that terminal with the long-running tail pipeline. Its
documented Terminal 2 checks (`Test-Path $tailLog`, `Get-Item $tailLog`,
`Get-Content $tailLog -Tail 5`) assumed `$tailLog` would be available
there too — it is not, since PowerShell variables are per-session.
Terra's F5d-59C finding blocked the procedure on exactly this gap; no
Worker source concern was involved.

**Fix: a persisted pointer file.** Terminal 1 now also writes the
resolved log path, as plain text, to a second well-known file —
`gate71-active-tail-path.log` — in the same already-ignored
`C:\service\.runtime-logs` directory. Terminal 2 reads that fixed,
well-known pointer path (never a variable) to resolve the real log path,
with no dependency on Terminal 1's session state.

**Terminal 1 (start tail, before the browser submit) — superseded by
F5d-59F (Terra F5d-59E finding).** The `npx.cmd wrangler` invocation below
relies on ambient `npx` resolution, which Terra found unreliable from
`C:\service` (no `node_modules\.bin\wrangler.cmd` at the repo root, no
npm workspace config resolving the Worker package). See ### F5d-59F below
for the corrected procedure, which pins the exact reviewed
`worker\node_modules\.bin\wrangler.cmd` binary; do not use the
`npx.cmd`-based command shown here.

```powershell
$logDir = "C:\service\.runtime-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$tailLog = Join-Path $logDir "gate71-worker-tail-$stamp.log"
$tailPointer = Join-Path $logDir "gate71-active-tail-path.log"

# Persist the resolved path to disk — Terminal 2 reads this file, never
# a PowerShell variable, so it has no dependency on Terminal 1's session.
Set-Content -Path $tailPointer -Value $tailLog -Encoding utf8

Write-Host "Tail log:"
Write-Host $tailLog
Write-Host "Tail pointer:"
Write-Host $tailPointer

# Explicit Worker name + explicit --version-id pin this to the approved
# diagnostics deployment. 2>&1 merges Wrangler's stderr into the same
# stream Tee-Object captures; Tee-Object writes both to the console
# (live view) and to $tailLog (retained) as each line arrives.
npx.cmd wrangler tail service-tech-files-worker `
  --format pretty `
  --version-id a3261063-2b5c-48e8-8b69-2f3e252ae265 `
  2>&1 | Tee-Object -FilePath $tailLog
```

**Terminal 2 (a genuinely separate PowerShell process/window — run before
clicking anything in the browser), including fail-closed path-safety
validation (Objective 5):**

```powershell
$logDir = "C:\service\.runtime-logs"
$tailPointer = Join-Path $logDir "gate71-active-tail-path.log"

if (-not (Test-Path $tailPointer)) {
    throw "Gate 7.1 tail pointer not found. DO NOT SUBMIT."
}
$tailLog = (Get-Content -Path $tailPointer -Raw).Trim()

# Fail closed rather than trust the pointer's content blindly: the
# resolved path must sit directly inside the expected runtime-log
# directory and match the exact filename pattern Terminal 1 produces —
# never execute/read an arbitrary path from the pointer file.
$resolvedParent = Split-Path -Parent $tailLog
$resolvedName = Split-Path -Leaf $tailLog
if ($resolvedParent -ne $logDir) {
    throw "Resolved tail log directory ($resolvedParent) does not match expected $logDir. DO NOT SUBMIT."
}
if ($resolvedName -notmatch '^gate71-worker-tail-\d{8}-\d{6}\.log$') {
    throw "Resolved tail log filename ($resolvedName) does not match the expected pattern. DO NOT SUBMIT."
}

Write-Host "Resolved tail log (validated):"
Write-Host $tailLog

Test-Path $tailLog
Get-Item $tailLog
Get-Content $tailLog -Tail 5
```

`Test-Path $tailLog` must return `True`, and `Get-Content $tailLog -Tail
5` must show Wrangler's connection/subscription output actually received
by the active tail — before Save & Print is allowed. **Do not submit** if
the pointer is missing, the resolved path fails validation, the tail log
is missing, the tail file is not receiving Wrangler output, a Wrangler
startup warning/error creates any uncertainty (a non-fatal debug-log
warning seen in a sandboxed test run must **not** be assumed harmless on
the live operator machine — treat any live startup ambiguity as
no-submit), the Worker/version target doesn't match, the tail process has
exited, or capture status is otherwise unclear.

**Two-session local test — actually run, not assumed.** Validated with
two genuinely separate `powershell.exe` OS processes (not PowerShell jobs
or scriptblocks sharing a session) and a safe, non-production,
non-Wrangler command — no Worker invocation, no Firestore/R2 access.
Session A (a real detached child process) wrote the pointer file, then
produced output incrementally over ~10 seconds via
`2>&1 | Tee-Object -FilePath`. Session B — a freshly started, completely
independent `powershell.exe` process with zero access to any of Session
A's variables — was launched partway through Session A's run, and:
resolved `$tailLog` purely from the fixed pointer path, passed the
path-safety validation above, `Test-Path $tailLog` returned `True`, and
`Get-Content $tailLog -Tail 5` showed the partial output written so far
(only the first line — proving it read genuinely live, in-progress data,
not a finished file). `Get-Process -Id <Session A's PID>` was checked
independently at that exact moment and confirmed Session A was still
running. All probe files (`gate71-worker-tail-*.log`,
`gate71-active-tail-path.log`, and the two throwaway driver `.ps1`
scripts) were deleted immediately afterward; `C:\service\.runtime-logs`
was confirmed empty. No `.gitignore` change was needed — both the tail
log and the pointer file end in `.log`, already covered by the existing
root `.gitignore`'s unqualified `*.log` rule.

**Stop/retention policy, unchanged from F5d-59B.** Terminal 1: `Ctrl+C`
only after enough post-submit output has arrived. Terminal 2: verify the
retained file still exists afterward. Neither the tail log nor the
pointer file is ever deleted automatically — both are kept until incident
analysis is complete. After exactly one future Gate 7.1 attempt
(success, another 500, timeout, or browser crash alike): never retry;
read the retained tail and independently verify production state first.

**Post-submit safe extraction, from Terminal 2's resolved `$tailLog`:**

```powershell
Select-String -Path $tailLog -Pattern '\[ServiceJob Allocator\]'
```

The full raw tail file is never pasted or shared — only these sanitized
allocator lines are reported.

### F5d-59F — deterministic Worker-local Wrangler invocation (Terra F5d-59E finding)

**The defect.** F5d-59D's Terminal 1 (like F5d-59B before it) invoked
`npx.cmd wrangler tail ...` from `C:\service`. `npx` resolves a package by
walking up from the current directory looking for
`node_modules\.bin\wrangler.cmd` (or falling back to a temporary
download) — but `C:\service` has no such `node_modules\.bin` entry and no
npm workspace configuration linking it to `worker/`'s own
`node_modules`. The reviewed, version-pinned Wrangler install actually
lives at `C:\service\worker\node_modules\.bin\wrangler.cmd`
(`wrangler@4.120.0`, from `worker/package.json`'s devDependency). An
ambient `npx` resolution could silently fall back to a different
installed/cached/downloaded Wrangler version, which was never the
reviewed binary this procedure's flag verification (F5d-59B) was actually
checked against. Terra's F5d-59E finding caught this before any live
reproduction relied on it; no Worker source concern was involved.

**Fix: pin the exact reviewed binary, verified before every use.** Both
terminals now reference `$wrangler =
"C:\service\worker\node_modules\.bin\wrangler.cmd"` as an absolute path —
never `npx`, never a bare `wrangler` relying on `PATH`, never a
global/cached/downloaded fallback. Terminal 1 fails closed if the binary
is missing, and explicitly checks its reported version before starting
any tail.

**Verified locally before documenting this (not assumed).** Via
PowerShell, from `C:\service` (the documented working directory):
`Test-Path "C:\service\worker\node_modules\.bin\wrangler.cmd"` →
`True`; `& $wrangler --version` → exactly `4.120.0`; `& $wrangler tail
--help`, invoked through this exact binary, confirmed it accepts the
positional `[worker]` name plus `--format` and `--version-id` — the same
three things the documented tail command uses. No production tail
connection was opened and no Worker route was invoked to verify any of
this.

**Terminal 1 version check — superseded by F5d-59H (Terra F5d-59G
finding).** The check below merges stdout and stderr with `2>&1` before
matching, then only checks that the combined text _contains_ `4.120.0`
via `-notmatch`. That is not fail-closed: the real Wrangler process can
exit `0`, print the approved version, and _also_ emit unrelated
diagnostic/warning text on stderr (an update notice, a deprecation
warning, anything) — the regex still matches, and the check still
passes, even though the invocation was not actually clean. See

### F5d-59H below for the corrected strict preflight; do not use the

`2>&1`/`-notmatch` version shown here for the version check (the tail
command itself further below is unaffected and unchanged — see F5d-59H's
own note on that).

```powershell
$wrangler = "C:\service\worker\node_modules\.bin\wrangler.cmd"

if (-not (Test-Path $wrangler)) {
    throw "Reviewed Worker-local Wrangler not found. DO NOT SUBMIT."
}

# Superseded — see F5d-59H.
$wranglerVersionOutput = (& $wrangler --version 2>&1 | Out-String).Trim()
if ($wranglerVersionOutput -notmatch '4\.120\.0') {
    throw "Wrangler version mismatch (got '$wranglerVersionOutput', expected 4.120.0). DO NOT SUBMIT."
}
Write-Host "Wrangler version confirmed: $wranglerVersionOutput"

$logDir = "C:\service\.runtime-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$tailLog = Join-Path $logDir "gate71-worker-tail-$stamp.log"
$tailPointer = Join-Path $logDir "gate71-active-tail-path.log"

Set-Content -Path $tailPointer -Value $tailLog -Encoding utf8

Write-Host "Tail log:"
Write-Host $tailLog
Write-Host "Tail pointer:"
Write-Host $tailPointer

& $wrangler tail service-tech-files-worker `
  --format pretty `
  --version-id a3261063-2b5c-48e8-8b69-2f3e252ae265 `
  2>&1 | Tee-Object -FilePath $tailLog
```

**Terminal 2 — unchanged from F5d-59D.** The cross-terminal pointer
mechanism, path-safety validation (expected directory + filename
pattern), `Test-Path`/`Get-Item`/`Get-Content -Tail 5` checks, and the
fail-closed no-submit conditions are all identical to ### F5d-59D above —
Terminal 2 never invokes Wrangler itself, so it has no dependency on
which binary Terminal 1 used. The absolute `C:\service\.runtime-logs` log
location is unchanged and remains independent of either terminal's
current working directory.

**Fail-closed policy, extended.** In addition to every F5d-59D no-submit
condition, also **do not submit** if: the exact
`worker\node_modules\.bin\wrangler.cmd` path is missing; its reported
version is anything other than `4.120.0`; `tail --help` through that
exact binary is missing the expected `[worker]`/`--format`/`--version-id`
support; or the tail startup produces any error. Do not install, update,
or otherwise modify Wrangler tooling during the reproduction gate to make
a check pass.

### F5d-59H — strict Wrangler version preflight (Terra F5d-59G finding)

**The defect.** F5d-59F's version check ran `& $wrangler --version 2>&1
| Out-String`, merging stdout and stderr into one string before matching
it with `-notmatch '4\.120\.0'` — a substring search, not an exact
comparison. A real Wrangler invocation can exit `0`, print the approved
version on stdout, and _also_ write unrelated diagnostic or warning text
to stderr (an update notice, a deprecation warning, anything Wrangler or
Node itself decides to emit); merging the streams and substring-matching
means that contaminated invocation still passes. Terra's F5d-59G finding
demanded the streams be evaluated independently and exactly, not
combined and searched. No Worker source concern was involved.

**Fix: independently evaluate exit code, exact stdout, and empty
stderr — all three must pass.** Stdout and stderr are captured
separately (stderr redirected to its own file under
`C:\service\.runtime-logs`, never merged with `2>&1`, for this check
only). The preflight passes only when: the exit code is `0`; stdout,
trimmed, is an exact (case-sensitive, whole-string) match for the
reviewed clean output — not a substring/regex search; and stderr,
trimmed, is empty. Any one of those three failing is a hard "DO NOT
SUBMIT," including a `0` exit code with a clean version string
accompanied by any stderr text at all — the exact case Terra found F5d-59F
would have silently accepted.

**Exact reviewed clean output, determined locally (not assumed).**
Invoking `C:\service\worker\node_modules\.bin\wrangler.cmd --version`
from `C:\service` with stdout and stderr genuinely separated: exit code
`0`; stdout is a single line, trimmed value exactly `4.120.0` (no
`wrangler` prefix, no extra text); stderr file created empty (0 bytes).
This exact clean profile is what the preflight below requires bit for
bit.

**Terminal 1 version preflight — corrected, replaces the F5d-59F block
above:**

```powershell
$wrangler = "C:\service\worker\node_modules\.bin\wrangler.cmd"

if (-not (Test-Path $wrangler)) {
    throw "Reviewed Worker-local Wrangler not found. DO NOT SUBMIT."
}

$logDir = "C:\service\.runtime-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# Stdout and stderr for THIS check only are captured separately — never
# 2>&1 — so a clean version string cannot mask unrelated stderr text.
$versionErrFile = Join-Path $logDir "wrangler-version-check.stderr.log"

$versionStdoutLines = @( & $wrangler --version 2> $versionErrFile )
$versionExitCode = $LASTEXITCODE
$versionStdout = ($versionStdoutLines -join "`n").Trim()
$versionStderr = if (Test-Path $versionErrFile) {
    (Get-Content -Path $versionErrFile -Raw -ErrorAction SilentlyContinue)
} else { $null }
if ($null -eq $versionStderr) { $versionStderr = "" }

# Exact (case-sensitive) whole-string comparison against the reviewed
# clean output — never a substring/regex search. All three conditions
# must hold; any failure is a hard stop.
$expectedVersionStdout = "4.120.0"
if ($versionExitCode -ne 0) {
    throw "Wrangler version check exited $versionExitCode (expected 0). DO NOT SUBMIT."
}
if ($versionStdout -cne $expectedVersionStdout) {
    throw "Wrangler stdout was '$versionStdout', not an exact match for '$expectedVersionStdout'. DO NOT SUBMIT."
}
if ($versionStderr.Trim().Length -ne 0) {
    throw "Wrangler version check produced stderr output — even alongside a correct version string, this is not a clean invocation. DO NOT SUBMIT. (See $versionErrFile for local diagnosis; do not paste it into chat.)"
}

Write-Host "Wrangler version preflight passed: exact clean '$versionStdout', no stderr."
Remove-Item -Path $versionErrFile -Force -ErrorAction SilentlyContinue

# ... proceed with $logDir/$tailLog/$tailPointer setup and the tail
# command exactly as shown in the F5d-59F block above — unchanged.
```

**The long-running tail itself is intentionally unchanged.** `2>&1 |
Tee-Object -FilePath $tailLog` is still correct and required for the
actual tail capture — both streams must be retained together there for
incident evidence. The strict stdout/stderr separation above applies
**only** to this one-shot version preflight, never to the tail command.

**Version-error file handling.** `wrangler-version-check.stderr.log`
lives under `C:\service\.runtime-logs`, already covered by the existing
root `.gitignore`'s unqualified `*.log` rule — no `.gitignore` change.
Removed automatically on a clean pass; left in place for local operator
diagnosis on failure. Never pasted into chat automatically — only
sanitized allocator lines are ever meant to be reported, per the existing
Objective 6/7 extraction policy.

**Success condition, explicit.** The preflight passes only if: the exact
reviewed binary exists; its exit code is `0`; its stdout, trimmed,
exactly equals `4.120.0`; its stderr, trimmed, is empty; and no other
invocation ambiguity exists. Otherwise: do not start Wrangler tail, do
not submit Gate 7.1. Do not install, update, or reconfigure Wrangler
during the gate to force a pass.

**Test matrix — actually run against fake local binaries, not
assumed.** Five throwaway `.cmd` files (outside the repository, in the
session scratchpad — never committed) simulated each case, invoked
through the exact same separated-stream capture logic as the real check:

| Scenario                                    | exit | stdout                          | stderr    | Verdict                 |
| ------------------------------------------- | ---- | ------------------------------- | --------- | ----------------------- |
| A: clean                                    | 0    | `4.120.0`                       | empty     | **PASS**                |
| B: nonzero exit                             | 1    | `4.120.0`                       | empty     | FAIL (exit code)        |
| C: contaminated stderr (Terra's exact case) | 0    | `4.120.0`                       | non-empty | FAIL (stderr not empty) |
| D: wrong version                            | 0    | `4.119.0`                       | empty     | FAIL (stdout mismatch)  |
| E: extra stdout lines                       | 0    | `wrangler 4.120.0` + extra line | empty     | FAIL (stdout mismatch)  |

All five matched their expected verdict, and the real reviewed binary
(`C:\service\worker\node_modules\.bin\wrangler.cmd`) independently passed
the same logic (exit `0`, stdout exactly `4.120.0`, empty stderr).
Scenario C is exactly the case F5d-59F's `2>&1`/`-notmatch` check would
have silently accepted — it now correctly fails. All fake binaries and
the test-generated stderr file were deleted immediately afterward; no
Wrangler tail connection to the real Worker was opened, and no Worker
route was invoked.

**Underlying defect status: still UNKNOWN.** F5d-59, like F5d-56/56B/56D
before it, fixes nothing about the live Worker 500 itself — it closes one
more diagnostic blind spot (genuine transaction-retry exhaustion). Its
source remediation passed Terra audit and was never touched again by
F5d-59B/C/D. F5d-59A was blocked solely on the tail-retention procedure
being unreliable. F5d-59B corrected explicit Worker/version targeting,
guaranteed directory creation, and guaranteed stderr capture, but its
Terminal 2 checks depended on a `$tailLog` PowerShell variable that a
genuinely separate terminal never inherits — Terra's F5d-59C finding
caught this before it could produce a false "capture confirmed" read on
the live machine. F5d-59D replaces the variable dependency with a
persisted pointer file (`gate71-active-tail-path.log`), validated
fail-closed against the expected directory/filename pattern, and proved
working end to end with a genuine two-process local test. F5d-59E then
found that both terminals' `npx.cmd wrangler` invocation depended on
ambient `npx` resolution, which has no valid target from `C:\service`
(no root-level `node_modules\.bin\wrangler.cmd`, no workspace config) —
an unverified fallback could silently run a different Wrangler build
than the one this procedure's flags were ever checked against. F5d-59F
pins both terminals to the exact reviewed
`worker\node_modules\.bin\wrangler.cmd` (`4.120.0`), verified present and
version-matched immediately before every tail start, with no
global/cached/downloaded fallback permitted. F5d-59G then found F5d-59F's
version check itself was not genuinely fail-closed — it merged stdout and
stderr with `2>&1` and only substring-matched the result, so a `0` exit
with the correct version string _and_ unrelated stderr text would have
silently passed. F5d-59H separates stdout and stderr, requires exit code
`0`, an exact (not substring) stdout match, and empty stderr — all
three, or no submit — verified against a five-scenario local test matrix
including the exact contaminated-stderr case Terra identified. The next
controlled, separately-approved reproduction — this time with tail output
reliably retained, independently verifiable from a second terminal,
started through a deterministically-pinned Wrangler binary, and gated by
a genuinely strict version preflight per F5d-59D/F/H — has the best
chance yet of pinpointing the real cause. Diagnostics remain
**undeployed**.

Gate 7.1 remains **PAUSED**. Production durable writes = ZERO. No
production deployment, mutation, or Rules/Worker/IAM/Auth change
occurred.

## F5d-60/F5d-60A — Allocator remediation and production verification closeout

F5d-60 remediation is deployed to `service-tech-files-worker` as production
version `55d9120c-af26-416b-bd68-1b3a4a3d271a` with 100% traffic. The
deployment message was `F5d-60 production rollout`; rollback target
`5b6c1278-630f-4fed-9973-cc04b9eeb1ad` remains available. Gate 7.1 is
**PASS**.

Two source defects were confirmed. First, the Worker previously converted
every Firestore commit HTTP `409` or `412` into `TransactionConflictError`,
even though only canonical `ABORTED` is allocator-retryable. The commit path
now reads a non-OK body exactly once and reuses the existing closed
Google-status parser. Only an allow-listed `ABORTED` envelope paired with
HTTP `409` becomes `TransactionConflictError`. `ALREADY_EXISTS`,
`FAILED_PRECONDITION`, empty/malformed/unknown/inconsistent `409` responses,
and every `412` fail immediately through the existing
`FirestoreRequestError` plus sanitized allocator diagnostic path. Retry
policy remains in `allocateServiceJob()`, and `MAX_TRANSACTION_RETRIES`
remains exactly `5`.

Second, candidate collision probing previously called `getServiceJob()`,
whose canonical parser returns `null` for a successfully read legacy
document missing required modern fields such as `brandId`. A separate
transaction-bound `serviceJobExists()` read now treats **any** document at a
candidate ID as occupied without fabricating it into a `ServiceJob`.
`getServiceJob()` remains unchanged for idempotency replay, where a valid
canonical job is required. The regression fixture now represents the real
protected legacy shape by omitting `brandId`; it proves
`BRN-2026-000001` is read-only/occupied, `BRN-2026-000002` is selected,
tracking sequence becomes `2`, Service Request sequence becomes `1`, and
the protected document is absent from the four-write commit.

The transaction invariants are unchanged: one atomic commit still contains
exactly the intake-key create-only write, Service Job create-only write,
tracking sequence write, and Service Request sequence write; both create
writes retain `currentDocument.exists=false`; Bangkok year, independent
counters, idempotency replay, authorization, and the generic client failure
remain unchanged. The full Worker suite passes 338 checks across its 19 test
programs. The normal Worker typecheck command still reports the pre-existing
six `ImportMeta.env` errors caused by its config traversing frontend Vite
modules without `vite/client`; the same strict command with `vite/client`
added as a non-persistent command-line type input passes, with no F5d-60
errors.

The earlier failed Gate attempt retained
`firestore-commit: transaction-retries-exhausted`; read-only verification
proved it produced zero durable production writes. The two confirmed source
defects explain that allocator incident and are resolved by F5d-60. An
`ALREADY_EXISTS` create-only collision remains a strong, source-supported
explanation, but the historical Firestore response body was not retained, so
its exact live canonical status is **not proven** and must not be described as
observed production evidence.

Gate 7.1 visibly confirmed the `FIRESTORE + WORKER` runtime path and performed
exactly one production Gate attempt. It completed without HTTP 500 and created
Service Job `BRN-2026-000002` with Service Request number
`SR-2026-000001`. The new document update time is
`2026-08-14T08:22:42.834387Z`. The protected legacy Service Job
`BRN-2026-000001` remained present and unchanged at update time
`2026-08-08T06:19:09.065089Z`.

Post-Gate verification found exactly one `serviceJobIntakeKeys` document, and
that intake key maps to `BRN-2026-000002`. Bruno Thailand's 2026 tracking
sequence is `2`, and its 2026 `service_request` sequence is `1`. The retained
F5d-60 Worker tail contained no `[ServiceJob Allocator]` diagnostic for the
successful attempt.

The next logical development task is a separately reviewed production
frontend rollout scope and preflight, since the privileged Worker allocation
path is now production-verified. F5d-60A does not authorize or implement that
rollout.

## F5d-61 Phase 2 — Production frontend readiness (source/config only)

Firebase Hosting is the approved frontend target and
`https://luxace-service.web.app` is the approved initial production URL. The
initial rollout is staff-only. `firebase.json` now publishes only `dist` and
rewrites all unmatched paths to `/index.html`, so the existing
`BrowserRouter` routes can resolve on direct navigation and refresh.

Production configuration now fails closed unless business data uses
Firestore, files use the Worker, and `VITE_FILES_WORKER_URL` resolves exactly
to the approved HTTPS production Worker origin
`https://service-tech-files-worker.sacool-spizy.workers.dev`. Missing,
malformed, HTTP, localhost, loopback, path-bearing, and other unapproved
production Worker URLs are rejected by one shared configuration boundary used
by the app gate and both Worker-backed repositories. Development Worker use
remains possible only through an explicitly configured URL; there is no
silent local fallback.

Production build preflight must supply `VITE_BACKEND_KIND=firestore`,
`VITE_FILES_BACKEND=worker`, the approved `VITE_FILES_WORKER_URL`, and all six
Firebase web values: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`,
`VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`,
`VITE_FIREBASE_MESSAGING_SENDER_ID`, and `VITE_FIREBASE_APP_ID`. Real values
remain in ignored environment files or the future deployment environment,
never committed. The built artifact must be rejected if it contains a local
Worker endpoint or any server credential marker.

Public tracking remains production-disabled and unavailable for this
staff-only rollout. A missing `VITE_PUBLIC_TRACKING_WORKER_URL` now returns
the existing unavailable result instead of falling back to localhost. No
public Worker route, issuance flow, or rate-limit configuration was enabled or
changed.

The production Worker CORS change adding the approved frontend origin remains
pending separate approval, as does the Firebase Hosting deployment. No data
migration is required. F5d-61 Phase 2 performs no Worker/Firebase/Auth/Rules/
IAM/R2/Cron/DNS mutation and does not deploy the frontend.

## F5d-62/F5d-62A — Staff frontend production rollout and verified closeout

F5d-61 source checkpoint `1767797048f44595f762323c95c678defc52e940`
(`f5d-61`) supplied the reviewed frontend artifact. F5d-62 first deployed the
production-only CORS expansion to `service-tech-files-worker` as version
`06bc88e9-1437-4708-b68e-07f82caaf916`, deployment message
`F5d-62 production frontend CORS rollout`, at 100% traffic. Its versioned
`ALLOWED_ORIGINS` is
`http://localhost:5173,https://luxace-service.web.app`; the Firestore project
and R2 binding remain `luxace-service` and `service-tech-attachments-prod`.
The correct rollback target for this CORS-only rollout is the immediately
preceding F5d-60 version `55d9120c-af26-416b-bd68-1b3a4a3d271a`, which keeps
the allocator fixes while restoring localhost-only CORS.

The first Firebase Hosting production release is now live at
`https://luxace-service.web.app`: release
`projects/luxace-service/sites/luxace-service/channels/live/releases/1786711638834000`
(`DEPLOY`, `2026-08-14T12:47:18.834Z`), version
`projects/luxace-service/sites/luxace-service/versions/ba65c4997440c3c4`
(`FINALIZED`). The deployed user artifact contains 21 files totaling
1,117,909 bytes. Its canonical manifest SHA-256 is
`e99aa57f713e48666d1947a3eea0c6292e335de3a522f38c4a47a83d1d14bcb8`.
The Hosting API reports 23 paths because it additionally exposes the two
Firebase-generated reserved resources `/__/firebase/init.js` and
`/__/firebase/init.json`.

The original Mutation 2 pre-deploy PowerShell gate **failed as a control**.
The interactive host did not support `[System.IO.Path]::GetRelativePath()`,
relative-path generation emitted errors, and the resulting non-authoritative
aggregate was
`985ef6f7c14eb51a937868583c14c178cfae907a217b82befa045b75a9a813ed`.
The expected-hash mismatch threw, but the separately entered interactive
deployment commands remained runnable and subsequently executed. Incident
classification is **A — control failure occurred, but the deployed artifact
was independently proven correct after deployment**. This must not be
described as a successful pre-deploy gate.

Independent post-deploy verification passed. The untouched local `dist`
matched all 21 approved filenames, sizes, and SHA-256 values with no missing
or unexpected user files, and recomputed the approved aggregate. All 21 live
user files then returned HTTP 200 and matched the approved decoded byte size
and SHA-256 exactly. `/`, `/login`, `/dashboard`, `/service-jobs`,
`/service-jobs/new`, and `/track/example` returned the approved application
shell. Live code resolves to `FIRESTORE + WORKER`, uses only the approved
production Worker endpoint, contains no local or preview Worker endpoint, and
leaves the public-tracking Worker URL empty. No rollback or redeployment was
needed.

Future artifact gates must use resolved-root prefix verification plus
substring removal for Windows relative paths, `/` normalization, ordinal
sorting, lowercase SHA-256 plus two spaces plus relative path plus LF, and a
final LF. The whole gate and deployment must run as one non-interactive
process with `$ErrorActionPreference = 'Stop'`; any capability, file, count,
size, hash, or aggregate mismatch must exit non-zero before the deployment
command becomes reachable. `dist` must not be rebuilt or modified between
verification and deployment.

F5d-62 production rollout is complete. The staff-only frontend has no known
production-critical rollout blocker. Public tracking remains unavailable and
is a separate future scope; no public route enablement, issuance, or
rate-limit change occurred. Post-deploy verification used no production write
and did not create a Service Job or mutate attachments. No new implementation
phase is selected by this closeout; the next roadmap-listed incomplete work is
the UX/accessibility/Thai-first and brand-identity hardening scope, subject to
separate approval.

## F5d-63 Phase 2 — Production Trust & Thai-first (historical source checkpoint)

F5d-63 removes fabricated operational content from the Dashboard, removes
inert notification/sort/assignment controls, and limits the staff-shell search
field to the Service Jobs and Product Master list routes that actually consume
it. Operational date/time presentation is deterministic in `Asia/Bangkok`,
staff dates use `DD/MM/YYYY`, quotes use THB, warranty language is product-
neutral Thai, and customer-facing Buddhist Era dates remain explicit.

The highest-safety change makes technician reassignment fail closed in the
Firestore runtime. Service Job details show the durable technician read-only
in production, and the update builder omits `technician` for Firestore even if
a caller explicitly supplies one. Mock mode retains its mock technician
selector. Canonical brand labels are derived only from the authenticated staff
profile or durable Service Job `brandId`; no tracking-prefix inference or new
authorization behavior was added. Existing save/sign-in in-flight states now
disable their corresponding actions.

At this Phase 2 checkpoint, the implementation was source-only and prepared
for independent review. No Worker, repository, Firebase configuration,
Firestore Rules, schema, migration, package, lockfile, dependency, or
environment change was part of the source patch, and no production mutation
or deployment had yet occurred. Production therefore still remained on the
verified F5d-62 Firebase Hosting release at that checkpoint. The production
state from this historical checkpoint is superseded by the closeout below.

## F5d-63/F5d-63C — Production Trust & Thai-first deployment closeout

Reviewed source checkpoint `a8caf3811199e6de158ab4e0251b59032c3b7f14`
(`f5d-63`) is live at `https://luxace-service.web.app`. The separately
approved Hosting-only deployment created live-channel release
`projects/luxace-service/sites/luxace-service/channels/live/releases/1786723383971000`
at `2026-08-14T16:03:03.971Z` on finalized version
`projects/luxace-service/sites/luxace-service/versions/b9e59a97e9ded5cc`.
The previous F5d-62 release `1786711638834000` and version
`ba65c4997440c3c4` are the captured Hosting rollback baseline.

The approved user artifact contains 21 files totaling 1,116,259 bytes. Its
canonical aggregate SHA-256 is
`5682d24b635ae2c32b4849d306836e6878b980d6e3ce2059d44d835913b98eab`.
Independent post-deploy verification matched all 21 decoded live files to
their approved byte sizes and SHA-256 values. `/`, `/login`, `/dashboard`,
`/service-jobs`, and `/service-jobs/new` returned HTTP 200 with the approved
SPA shell; direct deep links passed, the Thai-first frontend rendered, the
runtime reported `FIRESTORE + WORKER`, and unauthenticated staff routes
remained protected.

The Worker was not part of this deployment. It remains at deployment
`57cf2207-af36-4af1-a77c-ca1f2d5a7c09`, version
`06bc88e9-1437-4708-b68e-07f82caaf916`, with 100% traffic. Read-only checks
returned `GET /health` 200 and `OPTIONS /health` 204 with
`https://luxace-service.web.app` accepted by CORS. Public Tracking remains
unavailable and its production Worker URL remains unset.

The first post-deploy read-only artifact verifier reported a size mismatch
caused by its manifest lookup logic. A direct diagnostic returned the expected
bytes and SHA-256, and the corrected read-only verifier subsequently matched
all 21/21 files. This caused no redeployment and was not a production artifact
defect.

F5d-63B performed exactly one Hosting deployment with zero retries. It made
zero Service Job writes, attachment mutations, Worker mutations, or
Firestore/Auth/Rules/IAM/R2 mutations. No documentation-closeout production
mutation occurred. The next roadmap-listed work remains the broader
accessibility pass, remaining Thai/responsive-content QA, and broader brand
identity work described in `SPRINT_ROADMAP.md`; none is authorized by this
closeout.

## F5d-64 — P0/P1 accessibility hardening (Production, 2026-08-16)

The approved F5d-64 patch removes the two audited desktop keyboard blockers
by adding native detail links to the Service Jobs and Product Master tables.
The active mobile staff drawer and shared modal now expose labelled modal
semantics, contain focus, close with Escape, isolate background interaction,
and restore focus. Staff routes have route-specific document titles, a
skip-to-main boundary, and conservative route focus that explicitly leaves
New Service Job's customer-search autofocus in control.

Intake chips expose pressed state, Service Job status selection uses native
radio semantics, and Product Detail implements a complete tab relationship
with arrow/Home/End keyboard behavior. Core Service Job fields and Product
Master filters have accessible names; login/create/update failures use alert
semantics; photo removal actions identify their files. Public locale selection
updates the root document language and restores Thai when leaving the public
surface without enabling Public Tracking. Successful Service Job creation and
delivery-note preview transitions gain bounded focus handling while the
existing automatic `window.print()` behavior remains in place.

Final independent review passed with 19/19 focused tests and 260/260 complete
non-emulator application tests. The production gate repeated those results by
native process exit code, along with lint, build, and `git diff --check`, before
executing exactly one Firebase Hosting deployment with zero retries.

F5d-64 is live on Hosting release
`projects/769692662603/sites/luxace-service/channels/live/releases/1786857261574000`,
finalized version
`projects/769692662603/sites/luxace-service/versions/fd13206179cf6474`, released
at `2026-08-16T05:14:21.574Z`. The approved artifact contains 21 user files,
totals 1,127,214 bytes, and has canonical aggregate SHA-256
`95b8d499946daa707f0f833e65ed9f866a7fd78945b2a5ba985055f22dbee0a1`.
All 21/21 decoded live user files matched their approved size and SHA-256, and
the live canonical aggregate matched exactly. `/`, `/login`, `/dashboard`,
`/service-jobs`, and `/service-jobs/new` returned HTTP 200 with the approved SPA
shell. The live runtime remained `FIRESTORE + WORKER` with only the approved
Worker origin, and Public Tracking remained unavailable.

Read-only browser smoke confirmed that Login renders with Thai document
language, a route-specific Thai title and heading, one main landmark, and the
production runtime label; an unauthenticated `/dashboard` visit redirected to
`/login` as required. Neither the isolated browser nor the connected Chrome
surface had an existing authenticated staff session, so StaffShell, the live
Service Jobs list, native desktop detail-link traversal, drawer interaction,
and authenticated route-focus behavior were not exercised in production. No
credentials were fabricated or entered.

The Worker remained unchanged at version
`06bc88e9-1437-4708-b68e-07f82caaf916` with 100% traffic; health returned 200
and Hosting-origin CORS returned 204. F5d-64 made zero Service Job, attachment,
or Firestore writes and zero Worker, Auth, Rules, IAM, or R2 mutations. The
verified F5d-63 rollback baseline is Hosting release
`projects/769692662603/sites/luxace-service/channels/live/releases/1786723383971000`
and version
`projects/769692662603/sites/luxace-service/versions/b9e59a97e9ded5cc`.
Rollback remains a separately approved production mutation. The audit's P2/P3
items remain intentionally deferred.

## F5d-65 — Atomic new-customer + product registration (source only, not deployed)

F5d-65 Phase 2 implements, in source only, the workflow its own Phase 1
read-only audit identified as missing: staff can now create a new customer
and register a new customer product when Universal Search finds no match,
and continue directly into New Service Job without a separate durable write
before Save & Print.

**New customer creation remains Worker-only, atomic with Service Job
creation.** No Firestore client-side write path was added and no
`firestore.rules` change was made — the `customers` collection's existing
`allow create, update, delete: if false` stays exactly as strict as it is.
`POST /service-jobs`'s intake contract gained one additive, discriminated
field, `customer: { kind: 'existing'; customerId } | { kind: 'new' }`
(`src/services/serviceJobCreation.ts`, imported into the Worker the same way
`ServiceJobIntakePayload` already was). When `kind` is `'new'`, the
allocator's existing atomic `:commit` (already writing the intake key,
Service Job, and two sequence documents) gains exactly one more create-only
`customers/{id}` write — succeeding or failing together with the rest, never
a separate request. The new customer's id is a fresh `crypto.randomUUID()`
generated per attempt, never the phone number, so two real customers sharing
a phone number are never structurally forced onto one document
(`DATABASE_SCHEMA.md`'s own "no hard uniqueness constraint on phone"). Its
`brandIds` is always `[authenticated staff's own verified brand]`, derived
server-side the same way `ServiceJob.brandId` already is — never
client-supplied. The existing-customer path is unchanged: omitting
`customer` (every pre-F5d-65 caller) still writes no customer document and
still exactly four writes.

**Duplicate prevention remains staff-driven UX, not a database constraint** —
no server-side phone-uniqueness check was added, matching the
already-decided `DATABASE_SCHEMA.md` rule. The "+ New Customer" action
(`SearchNoResults.tsx`) is reachable only from a dead-end search (no
result), in every backend mode now, replacing F5d-49B's mode-conditional
hide (that hide existed only because the action was unwired everywhere; it
is wired now). A new inline `NewCustomerForm` (name + phone required, email
optional) holds the entry as pending client-side state only
(`IntakeCustomer`/`NewCustomerSummaryCard`) — nothing is written until the
existing single Save & Print action runs.

**Product registration adds no new entity.** Per Decision #037 (no
`product_instances` collection exists on any backend), "Register New
Product" collects intake fields for the new Service Job only — the same
free-text `product`/`productCategory`/`serialNumber` fields every existing
derived `RegisteredProduct` already flattens into. `ProductSelection.tsx`'s
previously inert notice is replaced by `RegisterProductForm`, which reuses
the existing, already brand-neutral Product Master catalog
(`useProductMaster`) for brand/product/model selection with a free-text
fallback (`BUSINESS_RULES.md`'s `model_other` escape hatch), plus an
optional serial number. A blank serial remains accepted (intake proceeds;
repeat-visit recognition is forfeited, an already-documented limitation, not
a new one).

**Warranty has no silent or default path (blocker fix, P1 #1).** An
independent review found the first cut discarded the staff member's actual
warranty choice: the radio selection lived in its own component state while
`buildManualRegisteredProduct()` read a separate `ManualProductEntry`
field that `createEmptyManualProductEntry()` hardcoded to
`'out_of_warranty'` — so choosing "in warranty" still produced
`warranty: false` on the durable Service Job, and the UI copy additionally
told staff to record `out_of_warranty` whenever the real status was unknown.
Both are removed. `ManualProductEntry` no longer carries a warranty field at
all, so no default exists to fall back to; warranty is a required, explicitly
passed argument, making the two values structurally incapable of diverging.
The radio group starts fully unselected, submission is blocked until staff
pick one of the two known states, and the "unknown → out_of_warranty" copy is
replaced with an instruction to verify the unit's real warranty status first.
The `WarrantyStatus` domain union is unchanged (`'in_warranty' |
'out_of_warranty'`) — "not yet chosen" is form state only, never a persisted
third value.

**Manual registration no longer uses phone as customer identity (blocker
fix, P1 #2).** The same review found the first cut decided whether a serial
"belonged to" the selected customer by comparing normalized phone numbers,
then either auto-selected that customer's product or declared a
cross-customer conflict. That inference is invalid: `DATABASE_SCHEMA.md`
explicitly permits two distinct customers to share one phone number, and the
historical Service Job model has no stable customer foreign key (Decision
#039 treats the phone join as an accepted legacy convenience, never an
identity proof). Phone-based ownership inference is removed entirely — the
phone is no longer passed into this path at all.
`checkSerialAgainstServiceHistory()` now makes no ownership claim: any
non-blank serial that already appears anywhere in the loaded, brand-scoped
Service Job history **blocks** manual registration with Thai guidance to
verify and select the existing customer/product through the normal search
path. Two customers sharing a phone cannot bypass this, and a blank or
unresolvable historical phone is not an ownership exception. Historical
serial ownership cannot currently be proven reliably from phone-based
Service Job history, and this code no longer pretends otherwise.

**Known limitation — P2 hardening, not solved here.** Serial-conflict
checking is client-side and advisory: it sees only the Service Jobs already
loaded in the authenticated staff member's own brand-scoped cache, so it is
race-prone and not an enforcement boundary. Server-side enforcement was
deliberately **not** implemented, because the only shapes available today
would be either a phone-based ownership rule (rejected above as invalid) or
schema expansion introducing a real customer/product-instance relation (out
of F5d-65's approved scope). This remains an explicit production
consideration for a later, separately approved phase; Worker validation was
not relaxed to accommodate it.

**One narrowly-scoped pre-existing constraint was loosened.** The Worker's
`parseServiceJobIntake()` required a non-blank `serialNumber` for every
Service Job, existing customer or not — never previously exercised as a
real limit because every derived `RegisteredProduct` already guarantees a
real serial. Manual product registration's approved "blank serial allowed"
behavior needed this widened to optional; every existing caller already
sends a real serial and is unaffected.

Validation after the blocker fix: Worker TypeScript typecheck reproduces
only the pre-existing `ImportMeta.env` baseline (unrelated files, unchanged);
the full Worker test suite (21 files, 371 checks) passes, re-confirming the
legacy `{ intake }` body, the four-write existing-customer commit, and the
five-write new-customer commit; the complete non-emulator application suite
(29 files) passes 291/291; the Firestore Rules emulator suite passes 11/11
unchanged (`firestore.rules` itself was not touched); `tsc -b`, `eslint .`,
`vite build`, and Prettier (scoped to changed files only) are clean;
`git diff --check` reports only pre-existing LF/CRLF normalization notices,
no real whitespace errors.

F5d-65 is **source only and not production complete**. It has not been
committed, tagged, pushed, or deployed, and no Firestore/Rules/IAM mutation
or production write occurred. Independent re-review is still required before
commit. Production remains F5d-64. Public Tracking remains unavailable.

## Development Principles

1. **Docs before backend expansion.** Any future repository or production-data expansion gets the same documentation, review, and approval treatment as the delivered Firestore repositories, not a silent bulk migration.
2. **Data-access seam before data-source swap.** Realized in code, not just planned: every page reads through `repositories.<name>`, so a future backend swap touches the Repository Provider, not every page — proven out already by the Product Master Firestore cutover.
3. **No premature abstraction.** Don't build for hypothetical future requirements — extract shared components only where duplication already exists, not speculatively.
4. **Thai-first, localization-ready.** UX-L10N1 establishes Thai-first staff presentation, Thai dates, Thai/CJK system fallbacks, and the narrow public tracking locale layer while preserving the approved security/domain boundaries.
5. **Brand-scoped by design.** Bruno Thailand and Join Lux Club are modeled as first-class entities from the schema up ([DECISIONS.md](DECISIONS.md) #002); production staff repositories, Rules, and Worker authorization enforce canonical brand scope.
6. **Customer and product identity are durable, not per-transaction.** Reflected today via stable `customerId` and `RegisteredProduct` concepts in the UI layer, even though the full Customer Master / Product Instance schema in `DATABASE_SCHEMA.md` isn't backed by a real database yet.
7. **Incremental, reviewable phases.** Each sprint is scoped, executed, validated, and reported before the next one starts — matching the F-series production rollout and its separately approved gates.
