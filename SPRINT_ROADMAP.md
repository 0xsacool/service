# Sprint Roadmap

> Logical, reviewable chunks of work. Each sprint should be small enough to approve and complete independently — matching how this project has been run so far (review → approve → execute, one phase at a time). Scope estimates are relative sizing (S/M/L/XL), not calendar commitments. Terminology: the core entity is the **Service Job** — see [DECISIONS.md](DECISIONS.md) #009.

> **Note on sprint numbering:** the plan below was originally written before Product Master, the Import Framework, or the Firebase/Firestore direction existed. Actual execution diverged from the original Sprint 1–8 outline once real feature work started — extra sprints (1B, Search/Identity/Intake phases, Product Master P1–P4, Firestore F0–F2.2) were inserted as the product's real shape became clearer. This file now documents what **actually happened**, consolidated where the original per-sprint granularity no longer matters, plus what's realistically next. See [PROJECT_STATE.md](PROJECT_STATE.md) "Completed Milestones" for the same history from an architecture-snapshot angle rather than a sprint-log angle.

---

## Completed Sprints

### Sprint 0 — Documentation Foundation *(complete)*

**Objective:** Establish a shared, written foundation before any backend/auth/database work begins.

**Deliverables:** `PROJECT_STATE.md`, `PRODUCT_ROADMAP.md`, `SPRINT_ROADMAP.md`, `DATABASE_SCHEMA.md`, `BUSINESS_RULES.md`, `UI_GUIDELINES.md`, `DECISIONS.md`, `CLAUDE.md`, `PRINT_SPECIFICATIONS.md` — including the Customer Master, Product Instance, and Service Job (rename) architecture finalized across all documents.

**Estimated Scope:** S

---

### Sprint 1 — Architecture Cleanup *(complete)*

**Objective:** Fix the structural gaps that would otherwise make every later sprint harder — routing, duplicated components, and the data-access seam — without changing what the app looks like or adding any backend.

**Delivered:**
- `react-router-dom` adopted, replacing the `PageId` `useState` switch in `App.tsx`; every page now has a real, shareable URL ([DECISIONS.md](DECISIONS.md) #007).
- Shared components extracted: `Row`, `Timeline`, `PhotoGallery`, `ProgressBar`, `Logo` — no longer duplicated between what were `ClaimDetails.tsx`/`TrackResult.tsx`.
- Code-level rename `Claim` → `ServiceJob` completed (types, files, routes) ([DECISIONS.md](DECISIONS.md) #009).
- Invalid tracking-number search no longer falls back to an unrelated real record — resolved via the router's catch-all `NotFoundPage`.
- ESLint + Prettier configured and passing.
- Feature-based folder restructure (`src/features/`, `src/shared/`, etc.).

**Estimated Scope:** M

---

### Sprint 1B — Repository & Shared-UI Foundation *(complete)*

**Objective:** Formalize the data-access seam and shared UI primitives that every later feature sprint would otherwise rebuild ad hoc.

**Delivered:** Constants layer (routes, statuses, app name); typed repository interfaces per entity ([DECISIONS.md](DECISIONS.md) #006, since superseded/consolidated by #017); `ErrorBoundary`, `EmptyState`/`LoadingState`/`ErrorState`; validation-layer scaffolding; existing pages retrofitted to the new constants and shared UI.

**Estimated Scope:** M

---

### Search, Product Identity & Service Intake Phases *(complete)*

**Objective:** Turn the static intake form into a real, progressively-revealed flow: find-or-recognize the customer and product first, then capture the problem and intake details.

**Delivered (consolidated from several internally-tracked phases):**
- Universal search (`searchRepository`, `useUniversalSearch`, recent-searches/recent-customers UI) and a search-first rewrite of `NewServiceJob`.
- `RegisteredProduct` concept, `registeredProductsRepository`, `useCustomerProducts`, product identity UI — plus two architecture refinements made after initial delivery: switching to a stable `customerId` (not phone) as identity, and modeling warranty independently per registered product rather than as a flat flag.
- Service intake types/validation, intake section components (accessories, problem, photo evidence, internal notes).
- `serviceJobCreation` business-logic service, `useCreateServiceJob`, `ServiceRequestPrintPreview` with working `@media print` output, and the full save/print/reset flow wired end-to-end into `NewServiceJob`.

**Estimated Scope:** L (across all phases combined)

---

### Product Master, Sprint P1–P3 *(complete)*

**Objective:** Replace the flat, per-serial mock lookup with a real, admin-manageable product catalog — the foundation every later Product Master/Knowledge feature builds on.

**Delivered:**
- Product Master types, a real Bruno Thailand mock catalog, `productMasterRepository`.
- A generic, reusable import framework (`src/imports/shared/`: parser, validator helpers, preview/summary builder) specialized for products (`src/imports/products/`: normalizer, validator, importer).
- Add Product form + validation, CSV/Excel export, `ProductsPage` (search/filter/sort/table), and a full CSV import wizard (choose file → preview → validation → completed summary).

**Estimated Scope:** L

---

### Product Knowledge, Sprint P4 *(complete)*

**Objective:** Give each product a knowledge base (accessories, common problems) and a real detail/edit view, not just a catalog row.

**Delivered:** `CommonProblemDefinition` (Active/Inactive status), `productKnowledgeRepository`, `ProductDetail` page with General/Accessories/Common Problems tabs, all edit-in-place through the repository layer.

**Estimated Scope:** M

---

### Sprint F0 — Backend Abstraction *(complete)*

**Objective:** Prepare the application so a real backend can be plugged in later with minimal changes, before any actual backend SDK is introduced.

**Delivered:** `RepositoryProvider` (`src/repositories/repositoryProvider.ts`) as the single seam every hook resolves repositories through, replacing direct per-repository imports; `BackendKind` config stub. No business logic changed. [DECISIONS.md](DECISIONS.md) #017.

**Estimated Scope:** S

---

### Sprint F1 — Firebase SDK Integration *(complete)*

**Objective:** Introduce Firebase into the application without connecting it to anything yet — the app must keep running entirely on Mock.

**Delivered:** `firebase` package installed; `src/lib/firebase/firebase.ts` with lazy, fail-fast-on-first-use getters (`getFirestoreDb()`, `getFirebaseAuth()`); `.env.example`; Vite env-var typings. Repository Provider unchanged; Mock remained the only active backend.

**Estimated Scope:** S

---

### Sprint F2 — Firestore Product Repository *(complete)*

**Objective:** Stand up the first real Firestore-backed repository, scoped to Product Master only.

**Delivered:** `firestoreProductMasterRepository.ts` (async factory, synchronous-facade-over-live-cache design — [DECISIONS.md](DECISIONS.md) #018); `seedProductMasterFromMock.ts` idempotent seed-once migration; `BackendKind` widened to `mock | firestore`, resolved from `VITE_BACKEND_KIND`. Live-validated against a real Firebase project (`asia-southeast3`): Add/Update/Search/Detail all correct, no duplicate reseed on refresh. Every other repository stayed Mock, as scoped.

**Estimated Scope:** M

---

### Sprint F2.1 — Firestore Hardening *(complete)*

**Objective:** Improve maintainability and deployment readiness of the Firestore infrastructure — no new business features, no UI changes.

**Delivered:** Checked-in Firebase deployment config (`firestore.rules`, `firestore.indexes.json`, `firebase.json`, `.firebaserc`); fixed a crash-on-bad-config bug where a missing/invalid `.env` with `backendKind=firestore` could fail the entire app instead of falling back to Mock ([DECISIONS.md](DECISIONS.md) #021); deduplicated the `PRODUCTS_COLLECTION` constant; captured the previously-discarded `onSnapshot` unsubscribe handle. Validated repeated `mock ↔ firestore` switching (4 full cycles) plus a deliberate bad-config fallback test, all without an app restart.

**Estimated Scope:** S

---

### Sprint F2.2 — Documentation Refresh *(complete)*

**Objective:** Bring `PROJECT_STATE.md`, `PRODUCT_ROADMAP.md`, `SPRINT_ROADMAP.md` (this file), `DATABASE_SCHEMA.md`, and `DECISIONS.md` back in sync with the actual codebase after the Product Master / Firestore work above. Documentation only — no application code touched.

**Delivered:** All five documents reviewed and updated; this file restructured to reflect real sprint history instead of the original pre-Product-Master plan; `DATABASE_SCHEMA.md` gained a Firestore implementation section; `DECISIONS.md` gained entries #019–#021 plus resolution notes on #006/#007/#009.

**Estimated Scope:** S

---

## Remaining Roadmap

The original plan's Sprint 3 ("Supabase Foundation") was superseded by the
F-series. Later F5 phases completed the Firestore-backed staff repositories,
staff Auth/Rules boundary, Worker/R2 attachment path, allocator production
verification, and the first staff-only Firebase Hosting rollout. The current
production record is in `PROJECT_STATE.md`; `@supabase/supabase-js` remains an
unused, orphaned dependency.

### Sprint 2 — UX, Accessibility & Thai-First Pass *(in progress; F5d-64 P0/P1 live)*

**Objective:** Bring the UI up to a real, launch-shaped standard: usable by screen readers/keyboard, and dressed in Thai-market conventions instead of English/placeholder content. (Note: the intake form itself is no longer non-functional — that part of the original Sprint 2 scope was delivered early, during the Search/Intake phases above.)

**F5d-63 production slice delivered:** fabricated Dashboard facts and staff
identity are removed; production technician reassignment is read-only and
cannot add a mock technician to an update patch; inert controls and
unsupported search surfaces are removed; staff date/time, THB, warranty, and
auth/config presentation are Thai/Thailand-correct; and canonical text-only
brand context is visible. The reviewed `f5d-63` source is live on Firebase
Hosting release `1786723383971000`, version `b9e59a97e9ded5cc`, with its
21-file artifact independently verified byte-for-byte. Public Tracking
remains unavailable.

**F5d-64 P0/P1 production slice delivered:** native desktop table links, mobile
drawer/shared-dialog focus containment, route titles and skip/main focus,
public document-language synchronization, selected-state semantics, Product
Detail keyboard tabs, core form names, async error alerts, and bounded focus
for creation/delivery-preview transitions passed final independent review with
19/19 focused tests and 260/260 complete non-emulator application tests. The
production gate repeated both suites, lint, and build successfully, then made
exactly one Hosting deployment with zero retries. Release
`1786857261574000`, version `fd13206179cf6474`, went live at
`2026-08-16T05:14:21.574Z`. Its 21 user files total 1,127,214 bytes and have
canonical aggregate SHA-256
`95b8d499946daa707f0f833e65ed9f866a7fd78945b2a5ba985055f22dbee0a1`;
all 21/21 live files and all five approved SPA routes matched. The Worker is
unchanged at `06bc88e9-1437-4708-b68e-07f82caaf916`, 100% traffic, with zero
production data writes or backend mutations. Public Tracking remains
unavailable. Unauthenticated Login/protected-route accessibility smoke passed;
authenticated StaffShell/list/link/drawer smoke was unavailable because neither
safe browser surface had an existing staff session.

**Remaining deliverables:**
- Deferred P2/P3 accessibility work: `aria-current="step"` timeline and
  progress semantics, PhotoGallery and DownloadMenu improvements, import
  chooser and broader ProductFieldsForm cleanup, contrast, reduced motion,
  and optional polish.
- Remaining Thai copy and responsive/content QA beyond the bounded F5d-63 trust surfaces.
- Any broader brand visual identity work beyond the canonical text badges delivered in F5d-63 ([DECISIONS.md](DECISIONS.md) #008).

**Estimated Scope:** M

---

### F5d-65 — Atomic new-customer + product registration *(Production, 2026-08-17)*

**Objective:** Close the gap the New Service Job flow has had since the
Firestore cutover — Universal Search could find an existing customer, but
staff had no way to register a first-time walk-in customer or a product
with no prior visit history, so intake was blocked for exactly that case.

**Delivered (source only):** New-customer creation is Worker-only and
atomic with Service Job creation — one more create-only `customers/{id}`
write added to the existing allocator's atomic `:commit`, using a fresh
opaque id (never the phone number) and staff-derived `brandIds`; no
`firestore.rules` change. The "+ New Customer" action is wired end-to-end in
every backend mode; entry is held as pending client state until the single
existing Save & Print write. "Register New Product" collects intake fields
only (Decision #037 — no `product_instances` entity), reusing the existing
Product Master catalog. `WarrantyStatus` remains unchanged as a domain type.

**Two P1 defects found by independent review and fixed here:** warranty is no
longer defaulted or discarded — the staff member's explicit radio selection is
the value used, the control starts unselected, submission is blocked until one
of the two known states is chosen, and the "unknown → out_of_warranty" copy is
gone. Phone is no longer used as customer identity — manual registration makes
no ownership claim, and any already-known non-blank serial blocks manual
registration rather than inferring ownership from a phone number that
`DATABASE_SCHEMA.md` explicitly allows two customers to share. Blank serials
remain allowed.

**Known limitation (P2, documented not solved):** serial-conflict checking is
client-side and advisory; server-side enforcement needs either a rejected
phone-based ownership rule or schema expansion, both outside this scope.

Full validation (Worker + application test suites, Firestore Rules emulator
suite, build, lint, format) passes — see `PROJECT_STATE.md`'s F5d-65 entry
for the complete record.

**Resolved by F5d-65A:** independent re-review, commit, and deployment are
complete. F5d-65 is live in production — Hosting release `1786958174254000`,
version `7b540ddfdd52d38f`, 21/21 files verified byte-for-byte against the
approved manifest, Worker unchanged at `1da88d90-0131-4859-8e10-2c5546199971`
(100% traffic). See `PROJECT_STATE.md`'s F5d-65/F5d-65A entry for the full
record. Production is F5d-65.

**Estimated Scope:** M

---

### Sprint F3/F4 repository expansion *(delivered through later F-series work)*

Customer, Service Job, Search, Registered Product, attachment, and related
staff repositories now have Firestore/Worker production paths. Their actual
incremental delivery history and security gates are recorded in
`PROJECT_STATE.md`; the earlier F3/F4 proposal is retained here only as the
roadmap lineage it superseded.

---

### Auth expansion *(staff Auth delivered; broader roles remain)*

Firebase Email/Password staff login, staff-profile/brand authorization, and
the reviewed Firestore Rules are live. Broader Admin and Customer role models,
account lifecycle, and administration UX remain future scopes.

---

### Photos & Attachments *(production foundation delivered; UX expansion remains)*

Private production attachment storage uses the authenticated Cloudflare
Worker plus R2 path. Remaining work is product/UI scope such as broader
attachment presentation and any separately approved customer-visible flow;
Firebase Storage is not the selected production design.

**Estimated Scope:** M

---

### Notifications *(not yet scoped)*

Customer status-change notifications via SMS/LINE/email — channel choice still undecided (see `PRODUCT_ROADMAP.md`).

**Estimated Scope:** M (pending channel decision)

---

### Repair Reports, Approvals & Admin Console *(not yet scoped)*

Factory-facing Repair Report workflow (multiple reports per service job, parts, append-only approval log — [DECISIONS.md](DECISIONS.md) #016) and brand/user/settings management for Admins.

**Estimated Scope:** L

---

### QA Hardening & Launch Readiness *(not yet scoped)*

Print-layout implementation for all three V1 documents (per
`PRINT_SPECIFICATIONS.md` — Service Request print preview already exists,
Repair Report and Return Form don't yet), expanded automated coverage,
cross-device QA, and performance/error-state review.

**Estimated Scope:** M
