# Architectural Decisions

> A running log of decisions that shape the project, in the order they were made. Each entry captures why, not just what โ€” so a later contributor can tell whether a decision still holds or needs revisiting. Add new entries at the bottom; don't edit past entries except to mark status changes (append a note, don't rewrite history).

---

## 001 โ€” Documentation before backend implementation

**Reason:** The project had a UI prototype and a completed architectural review, but no written agreement on schema, business rules, or conventions. Starting backend work without that risks rework once real requirements surface mid-implementation.

**Alternatives considered:** Skip documentation and let the schema/rules emerge organically during backend implementation.

**Decision:** Produce a documentation foundation (this file and its siblings) before any Supabase/auth/database work begins.

**Impact:** Backend work (Sprint 3+) has an agreed target to build against. Documentation must be kept current as decisions evolve โ€” a stale doc is worse than no doc.

**Status:** Decided.

---

## 002 โ€” Brand is a first-class schema dimension

**Reason:** The product serves two distinct brands (Bruno Thailand, Join Lux Club) sharing one system. The existing prototype has no brand concept at all โ€” brand isn't even a field.

**Alternatives considered:** Model brand as a plain attribute on `claims` (like a dropdown), with no access-control or settings implications โ€” simpler schema, but would require a costly migration later if brand-scoped access, branding, or reporting become necessary (which the product goals already imply โ€” see `PRODUCT_ROADMAP.md`).

**Decision:** `brands` is a real table. `claims`, `settings`, and staff `users` all relate back to a brand. Staff access is scoped by brand; Admin can be cross-brand.

**Impact:** Every claim-related table carries a `brand_id`. Row-Level Security (Sprint 3) must enforce brand scoping at the database level, not just in the UI. Tracking number format (Decision 004) encodes brand for human readability.

**Status:** Decided (explicit user directive).

---

## 003 โ€” Thai-first for Version 1

**Reason:** Both brands operate in Thailand; the prototype currently defaults to English UI, `en-US` dates, and USD (`$`) โ€” none of which match the actual market.

**Alternatives considered:**

- Bilingual from the start, no primary language โ€” more flexible but doubles the localization surface before V1 even ships.
- Keep English/USD as-is and treat localization as a fully separate future project.

**Decision:** Version 1 targets Thailand only:

- Primary UI language: **Thai**.
- Currency: **THB (เน€เธเธ)**.
- Date format: **DD/MM/YYYY**.
- Timezone: **Asia/Bangkok**.
- **Buddhist Era (B.E.)** dates supported where appropriate, especially on printed documents.
- English remains the language of source code, database fields, and technical documentation.
- Architecture stays localization-ready (no hardcoded strings baked into logic, centralized formatting), but full multilingual UI support is **not required** for V1.

**Impact:** Affects `UI_GUIDELINES.md` (typography must support Thai script โ€” current Apple system font stack does not), `DATABASE_SCHEMA.md` (currency/timezone defaults), `BUSINESS_RULES.md` (timeline timestamp display), and Sprint 2 scope directly. Any future second-locale work should extend, not rewrite, whatever formatting/copy layer Sprint 2 introduces.

**Status:** Decided (explicit user directive).

---

## 004 โ€” Tracking number format: `{BRAND_CODE}-{YYYY}-{SEQUENCE}`

**Reason:** Needed a human-readable, unique, brand-identifying tracking number now that brand is first-class (Decision 002). The prototype's existing format (`SRV-2026-0481`) has no brand identifier.

**Alternatives considered:**

- Keep the prototype's `SRV-YYYY-NNNN` format with a single global sequence โ€” simpler, but doesn't identify brand at a glance and mixes both brands' sequences together.
- Fully random/opaque IDs (e.g. UUID-based) โ€” better for guessing-resistance, worse for a customer or staff member reading it aloud or writing it on a receipt.

**Decision:** `{BRAND_CODE}-{YYYY}-{SEQUENCE}`, e.g. `BRN-2026-0481`, `JLC-2026-0001`. Sequence resets yearly, per brand, zero-padded to 4 digits.

**Impact:** `brands.code` must be defined and stable before any claim is created under it. Documented fully in `BUSINESS_RULES.md`.

**Status:** Decided. **Updated by #010** โ€” sequence padding widened from 4 to 6 digits (`BRN-2026-000123`); "claim" in this entry's original wording is superseded by "Service Job" per #009.

---

## 005 โ€” Add Cancelled and Rejected claim statuses

**Reason:** The prototype's 7-status flow (Received เนยโ€ เนโฌเธ เนยโ€ Completed) has no way to represent a claim that doesn't finish normally โ€” a customer declining a quote, or a claim being withdrawn, currently has nowhere to go.

**Alternatives considered:** Leave the flow as-is and handle cancellations informally (e.g. an internal note) โ€” rejected because it would make reporting and customer communication inconsistent, and the public tracker would show a customer's claim stuck indefinitely mid-flow with no accurate status.

**Decision:** Add two terminal exception statuses: **Cancelled** and **Rejected**, reachable from any non-terminal status.

**Impact:** `DATABASE_SCHEMA.md`'s status enum and `UI_GUIDELINES.md`'s status color mapping both need entries for these; not present in the current prototype code and must be added during Sprint 2/3 implementation, not assumed to already exist.

**Status:** Decided.

---

## 006 โ€” Data-access seam (`useClaims()`) before backend swap

**Reason:** Every page currently receives `claims: Claim[]` as a prop sourced directly from the static array in `App.tsx`. Introducing Supabase without an intermediate seam would mean touching every page component at once during Sprint 3/4.

**Alternatives considered:** Swap the data source directly when Supabase is introduced, updating each component's props as needed โ€” faster short-term, but couples every page to the specific data source and makes the backend cutover a large, risky, all-at-once change.

**Decision:** Introduce a single data-access hook (`useClaims()` or equivalent) in Sprint 1, backed by the mock array initially. Sprint 4 swaps its internal implementation to real Supabase queries without changing how any page consumes it.

**Impact:** Scoped into Sprint 1 (`SPRINT_ROADMAP.md`) as a prerequisite, ahead of any backend work.

**Status:** Decided. **Resolved in Sprint 1/1B** โ€” implemented as typed repository interfaces (`src/repositories/types.ts`) with per-entity Mock singletons; later formalized into a single resolution seam by #017's Repository Provider. (Sprint F2.2 note.)

---

## 007 โ€” Router adoption for deep links

**Reason:** Navigation is currently a single `useState<PageId>` in `App.tsx` with no URL sync โ€” no deep links, no shareable claim URLs, unreliable browser back/forward. This is a functional gap for the public tracker in particular (a customer can't bookmark or share their own tracking link).

**Alternatives considered:** Keep the state-based navigation and add manual URL synchronization (e.g. `history.pushState` calls without a routing library) โ€” more code to maintain for less capability than an established router.

**Decision:** Adopt a routing library (React Router is the natural default for this stack) to replace the `PageId` state machine.

**Impact:** Scoped into Sprint 1. Specific library version/config is an implementation detail for that sprint, not decided here.

**Status:** Proposed โ€” direction agreed (router needed), specific library **not yet formally locked in**, no package installed as of this writing. **Resolved in Sprint 1** โ€” `react-router-dom` adopted, `BrowserRouter` wired in `src/app/App.tsx`. (Sprint F2.2 note.)

---

## 008 โ€” Global UI palette is a placeholder pending brand identity

**Reason:** Current colors/typography (`UI_GUIDELINES.md`) are Apple-support-styled defaults from the Bolt.new generation, not Bruno Thailand or Join Lux Club branding, and the font stack lacks Thai-script support entirely.

**Alternatives considered:** None yet โ€” this entry exists to flag the gap, not to resolve it. Actual brand assets/colors need to come from the brand owners.

**Decision:** Treat current visual tokens as a working baseline only. No permanent brand decision made yet.

**Impact:** Scoped into Sprint 2. Blocks: Thai-script-capable font selection, per-brand color theming approach (single palette vs. brand-switchable).

**Status:** Open โ€” needs brand assets/input before it can be decided.

---

> **Note on entries below:** decisions #001เนโฌโ€#008 above were written before the "Service Job" rename (#009) and use "claim"/"Claim" in their original prose. Per this file's own convention, that prose is left as-written rather than edited after the fact โ€” read "claim" in those entries as synonymous with "Service Job" going forward.

---

## 009 โ€” Rename "Claim" to "Service Job"

**Reason:** "Claim" reads as an insurance/warranty-specific term, but this system also handles ordinary paid, out-of-warranty repairs โ€” the term doesn't match what the entity actually represents. The user's own description of the repair-report relationship model consistently used "Service Job" instead.

**Alternatives considered:** Keep "Claim" for continuity with the existing prototype code and prior documentation โ€” rejected because the term is actively misleading for non-warranty repairs, and it's cheaper to correct the terminology now, before Sprint 1 code changes, than after.

**Decision:** The core business entity is renamed **Service Job** across all documentation. Database table: `service_jobs` (was `claims`). The current prototype source code still uses "Claim" internally โ€” that code-level rename is Sprint 1+ scope, not done as part of this documentation-only phase.

**Impact:** Every doc referencing "claim" as the business entity is updated going forward (`DATABASE_SCHEMA.md`, `BUSINESS_RULES.md`, `PRINT_SPECIFICATIONS.md`, `PROJECT_STATE.md`, `PRODUCT_ROADMAP.md`, `SPRINT_ROADMAP.md`, `CLAUDE.md`). `PROJECT_STATE.md` continues to describe the current prototype's actual code accurately (still "Claim"-named) while noting this rename is pending.

**Status:** Decided. **Code-level rename completed in Sprint 1** โ€” types, files, and routes use `ServiceJob`/`service-jobs` throughout; isolated comment/mock-data references to "claim" are historical residue, not identifiers. (Sprint F2.2 note.)

---

## 010 โ€” Tracking number format confirmed: brand-coded, 6-digit sequence

**Reason:** Confirming/refining #004 after reviewing tracking-number vs. document-number examples together โ€” needed to settle whether the tracking number keeps the brand code (some example phrasing had briefly used a generic `ST` prefix) and to lock the sequence width.

**Alternatives considered:** Generic prefix with no brand code (e.g. `ST-2026-000123`), relying only on document-type prefixes to distinguish context โ€” rejected because the tracking number is the one identifier a customer uses standalone (not always alongside a specific document), and losing the brand code there removes an at-a-glance signal with no offsetting benefit.

**Decision:** Tracking number keeps the brand code and widens to 6-digit padding: `{BRAND_CODE}-{YYYY}-{SEQUENCE}`, e.g. `BRN-2026-000123`, `JLC-2026-000456`. Document numbers (Service Request, Factory Report, Return Form โ€” see #014) use generic type prefixes without the brand code.

**Impact:** `BUSINESS_RULES.md` "Tracking Number Generation" updated to 6-digit padding. `DATABASE_SCHEMA.md`'s `service_jobs.tracking_number` example updated to match.

**Status:** Decided.

---

## 011 โ€” Introduce a Customer Master

**Reason:** A customer may have multiple service jobs over time (repeat repairs, multiple products). Without a customer entity, every service job re-enters the same person's name/phone/email from scratch, with no way to see a customer's full history or attach stable identity data (marketplace usernames, contact channels) to the _person_ rather than to one job.

**Alternatives considered:** Keep customer data as flat fields on each service job (the original V1 design in `DATABASE_SCHEMA.md`'s prior revision) โ€” rejected per explicit direction; also would have made marketplace-identity data (#013) impossible to model correctly, since a stable identity re-entered per job invites drift and duplication.

**Decision:** Introduce `customers` as a real table (`DATABASE_SCHEMA.md`). Scoped per-brand (`customers.brand_id` not null) โ€” a person who buys from both Bruno Thailand and Join Lux Club gets two separate customer records, consistent with brand-first scoping (#002) and avoiding unintended cross-brand data sharing without a deliberate consent/merge decision (relevant under Thailand's PDPA). `service_jobs.customer_id` replaces the earlier flat `customer_name`/`customer_phone`/`customer_email` fields.

**Impact:** Intake becomes a lookup-or-create flow against the customer master (`BUSINESS_RULES.md`), not a flat form. Flagged as an assumption, not a hard requirement: if a unified cross-brand customer view is actually wanted later, that's a deliberate follow-up decision.

**Status:** Decided.

---

## 012 โ€” Introduce a Product Instance entity

**Reason:** The system should track a physical product's full repair history across its lifetime, not just one isolated service job. Without a distinct instance entity, a customer bringing the same appliance in for a second repair has no link to the first visit.

**Alternatives considered:** Keep product data flat on each service job (original design) โ€” rejected per explicit direction; would make "has this exact unit been serviced before" unanswerable without fuzzy matching on serial number text.

**Decision:** Introduce the ownership chain `brands` เนยโ€ `products` (product line) เนยโ€ `models` (SKU/variant) เนยโ€ `product_instances` (the physical unit, ideally identified by serial number) เนยโ€ `service_jobs` (a repair event for that unit). `service_jobs.product_instance_id` replaces the earlier flat `product_name`/`product_category`/`serial_number` fields.

**Impact:** Enables per-unit service history and consistent product/model reporting (also resolves the "Model vs. Product" open question from `PRINT_SPECIFICATIONS.md`). Requires product/model catalog maintenance โ€” mitigated by a `model_other` free-text escape hatch so intake is never blocked on missing catalog data (`DATABASE_SCHEMA.md`). History linkage depends on serial number capture โ€” when absent, a repeat visit isn't automatically recognized as the same unit (documented as a limitation in `BUSINESS_RULES.md`, not solved by this decision).

**Status:** Decided.

---

## 013 โ€” Marketplace and contact channel identities belong to the Customer, not the Service Job

**Reason:** A Shopee username or LINE ID identifies the _person_, not a single repair event โ€” it stays the same across all of a customer's service jobs. An earlier design (from the Phase 1.1 print-spec analysis) had proposed a `claim_channel_contacts` table keyed to the service job; that was provisional pending exactly this direction.

**Alternatives considered:** Keep channel identity on the service job (simpler, no dependency on the customer master) โ€” superseded by #011 once a customer entity existed; storing it per-job would mean re-entering the same LINE ID every visit and losing the "one identity, many jobs" relationship.

**Decision:** `customer_channel_contacts` (`customer_id`, `channel`, `identity_value`, `purpose`) replaces the earlier `claim_channel_contacts` design, per `DATABASE_SCHEMA.md`. `purpose` (`purchase` | `contact`) distinguishes "identity used to buy" from "channel used to reach them," since the same platform (e.g. LINE) can serve either role.

**Impact:** Resolves the "Marketplace Username" question from the prior analysis turn. Directly reusable by the future Notifications sprint (Sprint 6) โ€” a customer's `contact`-purpose channel identity is exactly what a notification delivery feature needs.

**Status:** Decided.

---

## 014 โ€” Document numbering: independent per-type sequences, no brand code on document numbers

**Reason:** Once a service job can have multiple repair reports (#012's lifecycle tracking implies repeat visits; the repair-report relationship model implies repeat attempts within one job), a single tracking number can no longer uniquely identify "which specific document is this" โ€” Service Request, Factory Report, and Return Form each need their own numbering.

**Alternatives considered:** Mirror the tracking number's sequence value for 1:1 documents like the Service Request (a `SR` number that always numerically matches its job's `ST`/tracking sequence) โ€” rejected in favor of one consistent generation mechanism for all document types, avoiding a special case for documents that happen to be 1:1 vs. 1:N with their parent job.

**Decision:** Every document type (`service_request`, `return_form`, `repair_report`) gets its own sequence via a shared `number_sequences` mechanism (`brand_id`, `document_type`, `year` เนยโ€ `current_value`), documented in `DATABASE_SCHEMA.md`. Printed format uses a generic type prefix without the brand code (`SR-2026-000123`, `FR-2026-000078`, `RT-2026-000045`) โ€” brand separation is still enforced in the underlying counter (per-brand, per-year), just not shown in the printed prefix, since every document already carries its parent service job's brand-coded tracking number for cross-reference.

**Impact:** `BUSINESS_RULES.md` "Document Number Generation" section added. `service_jobs` gains `service_request_number`/`return_form_number` columns; `repair_reports` gains `report_number`.

**Status:** Decided.

---

## 015 โ€” Purchase channel, order reference, and warranty data belong to the Product Instance

**Reason:** These facts (where/when a unit was bought, its warranty window) are determined once, at purchase โ€” they don't change across repeat repair visits for the same unit. The prior analysis had proposed evolving `claims.warranty` from a boolean into a richer enum directly on the service job; introducing Product Instance (#012) makes a better home available.

**Alternatives considered:** Keep `purchase_channel`/`order_reference`/`warranty_type` on `service_jobs` as originally proposed โ€” rejected because a second service job for the same unit would either duplicate this data or risk it drifting out of sync with the first job's values, when it's actually one fact about the physical unit, not about each repair event.

**Decision:** `product_instances` carries `purchase_channel`, `order_reference`, `purchase_date`, `warranty_type` (`manufacturer`/`extended`/`none`/`unknown`), `warranty_start_date`, `warranty_end_date`. `repair_reports.warranty_decision` remains separately on each repair report โ€” whether _this specific repair_ is covered can differ from the unit's overall warranty status (e.g. accidental damage on a unit still within its warranty window).

**Impact:** Resolves the "Warranty Type" gap flagged in `PRINT_SPECIFICATIONS.md`'s Data Requirements table more cleanly than the originally-proposed boolean-to-enum change on the service job.

**Status:** Decided.

---

## 016 โ€” Repair Report approval modeled as an append-only log

**Reason:** A repair report can be rejected and resubmitted (e.g. a factory quote initially rejected on cost, then resubmitted after renegotiation). A single mutable `approved_by`/`approved_at` pair on the repair report would lose that history โ€” the rejection would simply be overwritten by the later approval.

**Alternatives considered:** Approval fields directly on `repair_reports` (`approved_by`, `approved_at`, `rejection_reason`) โ€” simpler, one fewer table, but loses multi-round history and is inconsistent with the append-only pattern this project already committed to for `timeline_events` (`BUSINESS_RULES.md`).

**Decision:** `repair_report_approvals` (`repair_report_id`, `approver_id`, `decision`, `decided_at`, `notes`) as a separate, append-only table โ€” every approval attempt is preserved, not just the latest one.

**Impact:** One more table in `DATABASE_SCHEMA.md`, but consistent with the existing audit-trail pattern rather than introducing a second, different way of tracking decision history.

**Status:** Decided.

---

## 017 โ€” Repository Provider as the single resolution seam (Sprint F0)

**Reason:** Each repository (`serviceJobsRepository`, `customersRepository`, `productsRepository`, `searchRepository`, `registeredProductsRepository`, `productMasterRepository`, `productKnowledgeRepository`) was already interface-typed (#015-era pattern, formalized Sprint 1B), but every hook imported its specific mock singleton directly from that repository's own file. That works today, but it means a future Firestore cutover has seven independent import sites to change instead of one, and nothing in the codebase enforces that hooks only ever depend on the interface.

**Alternatives considered:**

- Leave repositories as directly-imported singletons and swap each file's implementation in place when Firestore lands โ€” rejected because it's the same number of files touched either way, but leaves no single seam to point to, audit, or feature-flag against, and risks a partial cutover (some hooks migrated, some not) going unnoticed.
- A React Context-based provider (`<RepositoryProvider>` wrapping the app, consumed via `useRepositories()`) โ€” rejected for now as unnecessary indirection: nothing here is request-scoped, per-user, or needs to change at runtime yet (no auth, no multi-tenant swap-per-session). A plain module-level factory is simpler and achieves the same "one resolution point" goal; Context can be introduced later if a real runtime-swap need appears (e.g. per-brand backend routing), without changing the `RepositoryProvider` interface itself.

**Decision:** Introduce `src/repositories/repositoryProvider.ts`, exporting a `RepositoryProvider` interface (one field per existing repository) and a `repositories` singleton resolved by `createRepositoryProvider()`. Every hook now depends on `repositories.<name>` from this one module instead of importing an individual repository file. `createRepositoryProvider()` switches on `backendKind` from the new `src/config/backend.ts` (hard-coded to `'mock'` โ€” no environment variables or Firebase config introduced this sprint); adding a Firestore-backed provider later is a new `case` in that switch plus a new provider module, not a restructure. Repository-to-repository composition that already existed internally (`registeredProductsRepository` reading `productMasterRepository`; `productMasterRepository` reading `productKnowledgeRepository`) is left as direct module imports โ€” that's composition within the Mock Repository implementation layer, not a UI-facing dependency, and stays that way even once a Firestore implementation exists.

**Impact:** `UI เนยโ€ Repository Interface เนยโ€ Repository Provider เนยโ€ Mock Repository` is now the actual, enforced dependency flow, not just documentation. All 8 hooks (`useServiceJobs`, `useCustomers`, `useProducts`, `useUniversalSearch`, `useCustomerProducts`, `useCreateServiceJob`, `useProductMaster`, `useProductDetail`) resolve repositories through `repositories`. No repository interface, mock implementation, or business logic changed โ€” this sprint is resolution-path only. Firestore implementation itself remains out of scope (explicitly deferred, matches `SPRINT_ROADMAP.md` Sprint 3+).

**Status:** Decided.

---

## 018 โ€” Firestore Product Master: synchronous facade over an async backend, via a live local cache

**Reason:** Sprint F2 implemented the first real Firestore-backed repository (`firestoreProductMasterRepository.ts`), scoped to Product Master only. `ProductMasterRepository`'s interface (#015-era) is synchronous โ€” every method returns a value directly, not a `Promise` โ€” because it was designed against the Mock Repository, where an in-memory `Map` read is genuinely synchronous. Firestore has no synchronous read API; every hook and component built against this interface since Sprint P1 assumes synchronous calls, and this sprint's own scope explicitly ruled out UI/component changes.

**Alternatives considered:**

- Widen `ProductMasterRepository` to return `Promise`s and add loading states to `useProductMaster`/`useProductDetail` and their consuming pages โ€” the technically "correct" long-term shape, but ripples into every page that reads Product Master (`ProductsPage`, `ProductDetail` and its three tabs, `AddProductModal`, the Import wizard) and into `registeredProductsRepository`'s existing synchronous read of `productMasterRepository`. Explicitly out of scope for this sprint ("no component changes"); revisit when more repositories go async at once, so the loading-state work is done once, not per-repository.
- Block app startup on a full Firestore fetch before rendering anything โ€” rejected as a worse user experience than a live-updating cache, and doesn't solve the underlying sync-vs-async mismatch, just moves it earlier.

**Decision:** `createFirestoreProductMasterRepository()` is an async _factory_ (not the repository object itself) that: (1) runs the seed-if-empty migration, (2) opens a Firestore `onSnapshot` listener on `products`, (3) awaits the first **server-confirmed** snapshot (`metadata.fromCache === false`) before resolving โ€” confirmed live that Firestore's listener can deliver a stale, partial snapshot from local cache before the real one, and resolving on that first-of-any-kind event left `getProducts()` permanently wrong for the repository's lifetime, since nothing else re-syncs the caller's React state afterward. Every method on the returned `ProductMasterRepository` reads/writes an in-memory cache synchronously, satisfying the unchanged interface exactly; the live listener keeps that cache current in the background for the rest of the session. `createProduct`/`updateProduct` update the cache optimistically and fire the Firestore write in the background โ€” its failure is logged, not surfaced to the caller (the sync return type has nowhere to put it). `repositoryProvider.ts`'s `'firestore'` case `await`s this factory (already made feasible by dynamic-importing the module โ€” see below), so by the time any hook receives `repositories.productMaster`, it already reflects real server data.

**Also decided in this sprint:** `firestoreProductMasterRepository.ts` (and its Firebase/Firestore SDK imports) is dynamically imported inside `repositoryProvider.ts`'s `'firestore'` case, not statically imported at the top of the file โ€” a static import added ~500KB gzipped to the production bundle for every user regardless of `backendKind`, confirmed by build output (373KB เนยโ€ 899KB gzipped-main-chunk before the fix). The dynamic `import()` is code-split by Vite into its own chunk, fetched only when that branch actually runs. This required making `createRepositoryProvider()` itself async and adding a top-level `await` to `repositories`' export โ€” supported cleanly by this project's ESM/Vite setup.

**Impact:** `src/lib/firebase/firebase.ts` (Sprint F1) was changed from eager top-level `initializeApp()`/env-validation to lazy getters (`getFirestoreDb()`, `getFirebaseAuth()`) โ€” discovered necessary because `repositoryProvider.ts` statically imports every repository module including the Firestore one, so without laziness, merely running the app in Mock mode with no `.env` at all would have crashed on startup. `ProductMasterRepository`'s interface, all other repositories, and all hooks/components are unchanged. Only `productMaster` switches per `backendKind`; every other repository (including `registeredProductsRepository`'s existing direct read of the Mock `productMasterRepository`) stays Mock regardless, per this sprint's explicit scope.

**Status:** Decided.

---

## 019 โ€” Lazy initialization for any module that talks to Firebase

**Reason:** `src/lib/firebase/firebase.ts` originally called `initializeApp()` and validated all six `VITE_FIREBASE_*` env vars eagerly, at module top level. Because `repositoryProvider.ts` imports every repository module (including the Firestore one) so it can switch on `backendKind`, merely importing that module โ€” which happens on every app load, in every mode โ€” would crash the entire app in **Mock** mode if no `.env` existed at all, even though Mock mode never needs Firebase. This was discovered as a bug during Sprint F2, not designed in from the start.

**Alternatives considered:**

- Validate env vars only when `backendKind === 'firestore'`, keeping eager `initializeApp()` โ€” rejected because it still initializes the Firebase SDK unconditionally on import, doing real work (and importing SDK code) nobody asked for in Mock mode.
- Move the Firestore repository import behind a conditional `require`/dynamic check inside `firebase.ts` itself rather than making the getters lazy โ€” rejected as more complex for the same result; the dynamic-import decision below already solves the "don't load the SDK unless needed" half of this problem, and lazy getters solve the "don't run Firebase code unless needed" half.

**Decision:** `firebase.ts` exports lazy getters (`getFirestoreDb()`, `getFirebaseAuth()`) instead of eager top-level `app`/`firestore`/`auth` constants. `initializeApp()` and env-var validation only run the first time a getter is actually called โ€” which only happens from inside `firestoreProductMasterRepository.ts`, which is itself only reached when `backendKind === 'firestore'`. This is now the standing pattern for **any** future module that touches Firebase: initialize lazily, on first real use, never at import time.

**Impact:** Mock mode with zero `.env` configuration works exactly as before this decision โ€” no Firebase code runs, no validation errors, nothing imported eagerly. `firestore` mode still fails fast with an actionable error the first time Firestore is actually touched, just not merely from importing the module. Every future Firestore/Firebase-Auth-backed repository should follow this same lazy-getter shape.

**Status:** Decided.

---

## 020 โ€” Dynamic `import()` for backend-specific repository code

**Reason:** `firestoreProductMasterRepository.ts` (and its Firebase/Firestore SDK imports) was originally statically imported at the top of `repositoryProvider.ts`. Confirmed via build output that this added the entire Firebase/Firestore SDK to the production bundle for **every** user regardless of `backendKind` โ€” 373KB เนยโ€ 899KB gzipped on the main chunk, even for the default all-Mock configuration that never touches Firestore.

**Alternatives considered:**

- Accept the bundle-size cost as a one-time fixed overhead โ€” rejected given the app's default (and, for now, only real-world) configuration is Mock; paying ~500KB gzipped on every load for a feature most sessions never use is a bad tradeoff, and would get worse as more repositories gain Firestore implementations.
- Split Firebase into its own manually-configured Vite chunk (`build.rollupOptions.manualChunks`) but still import it eagerly โ€” rejected because the chunk would still be _fetched_ on every load, just cached separately; the goal is to not fetch it at all in Mock mode.

**Decision:** `repositoryProvider.ts`'s `'firestore'` branch (`createFirestoreBackedRepositoryProvider()`) loads `firestoreProductMasterRepository.ts` via dynamic `import()`, which Vite code-splits into its own chunk, fetched only when that branch actually executes (i.e. only when `backendKind === 'firestore'`). This required making `createRepositoryProvider()` async and adding a top-level `await` to the `repositories` export โ€” supported cleanly by this project's ESM/Vite setup. This is now the standing pattern for any future backend-specific repository module (Firestore or otherwise) with a non-trivial dependency footprint: dynamically import it from inside the branch that selects it, not statically at module top level.

**Impact:** Main bundle size is restored to baseline (~373เนโฌโ€374KB gzipped) for the default Mock configuration; the Firestore/Firebase code lives in its own isolated chunk (~519KB gzipped as of Sprint F2.1), fetched only by sessions that opt into `firestore` mode. Confirmed to hold across Sprint F2.1's repeated backend-switching validation.

**Status:** Decided.

---

## 021 โ€” Firestore initialization failure falls back to Mock, not a crash

**Reason:** Because `repositories` is resolved via a top-level `await` in `repositoryProvider.ts`, an unhandled rejection from `createFirestoreBackedRepositoryProvider()` (e.g. missing/invalid Firebase env vars, denied Security Rules, network failure) would fail that whole module's evaluation โ€” and every hook in the app imports this module. Discovered during Sprint F2.1 review: setting `backendKind` to `'firestore'` with a bad `.env` would have broken the **entire app** (Dashboard, Service Jobs, everything โ€” none of which touch Firestore), not just Product Master.

**Alternatives considered:**

- Let it fail loudly (crash to a white screen / error boundary) so a misconfiguration is impossible to miss โ€” rejected because the blast radius is disproportionate: a Product-Master-only backend problem shouldn't take down features that never touch Firestore, especially once more of the app depends on this same module as later repositories go Firestore-backed.
- Surface a user-visible banner/toast on fallback, not just a console error โ€” considered but deferred as unnecessary complexity for a pre-launch, internally-used app with no end users yet relying on Firestore; revisit once this app has real users who'd otherwise have no signal they're seeing stale Mock data (flagged in `PROJECT_STATE.md`).

**Decision:** `createRepositoryProvider()` wraps the Firestore-backed path in try/catch. On failure, it logs a single, actionable, chained console error (naming the likely causes โ€” bad `.env`, Security Rules โ€” and pointing at `.env.example`) and returns the all-Mock provider for that session instead of propagating the rejection. Verified live: blanking `VITE_FIREBASE_API_KEY` with `backendKind=firestore` left the app fully functional on Mock data, with the real cause visible in console, not hidden.

**Impact:** A bad Firestore configuration degrades gracefully to Mock instead of bricking the app, at the cost of the failure being console-only (not user-visible) for now. This pattern โ€” try/catch around any backend-specific branch inside `createRepositoryProvider()`, falling back to Mock โ€” should be reused as more repositories gain Firestore implementations, so one repository's misconfiguration never threatens the rest of the app the way it now would if this decision were skipped for a future repository.

**Status:** Decided.

---

## 022 โ€” Attachment metadata: deterministic doc IDs via key-encoding, and durable (not optimistic) writes

**Reason:** F5d-1 gave Service Job attachment metadata a durable Firestore home (`serviceJobAttachments`), replacing F5b's session-only in-memory index. Two things about attachments don't fit the established Firestore-repository template (`ServiceJob`/`Customer`/Product Master, per DECISIONS.md #018) cleanly: (1) an attachment's natural unique key is its R2 object key (e.g. `service-jobs/{jobId}/{category}/{uuid}-{name}`), which contains `/` โ€” illegal in a Firestore document ID; (2) `create()`/`deleteAttachment()` here always run immediately after a real, already-committed R2 side effect (a successful upload or delete against the Worker), unlike editing an already-synced business record.

**Alternatives considered:**

- Let Firestore auto-generate a random document ID and query by a `path` field when a specific attachment is needed โ€” rejected because the R2 key is already a guaranteed-unique natural key; a random ID would require an extra query for something otherwise directly addressable, and the task explicitly called for deterministic IDs "where appropriate."
- Keep attachment metadata writes optimistic or hard-delete metadata after a manual R2 delete โ€” rejected. `create()` only runs after bytes are durably in R2, so a failed metadata write must surface. A hard delete destroys audit history and conflicts with the retained-metadata lifecycle.

**Decision:** Firestore document IDs for `serviceJobAttachments` are the R2 key with `/` replaced by `__` (`attachmentDocId()` in `src/repositories/firestore/attachmentMapping.ts`) โ€” safe because R2 keys are otherwise restricted to `[a-zA-Z0-9._-]` by the Worker's own key-validation pattern, so the transform is lossless and collision-free. The real key is still stored as a `path` field (not reconstructed from the doc ID), so `fromFirestoreData()` doesn't need a `decode` step. Creation is genuinely awaited by its caller (`workerAttachmentsRepository.ts`), not fired in the background. Manual deletion retains the document and writes `deletedAt` after a successful idempotent R2 delete.

**Impact:** A `serviceJobAttachments` document is always addressable directly by its R2 key (via the same deterministic transform) without a query. Attachment metadata writes are slightly slower than `ServiceJob`/`Customer` writes (genuinely awaited, not optimistic) and failures surface to the caller. A missing parent Service Job is rejected before any upload request, preventing newly-created orphans through the application repository path.

---

## 023 โ€” Extend Retention: duration reuse, and audit history as an embedded append-only array

**Reason:** F5d-4 needed an explicit staff "Extend Retention" action. Two open questions had no answer anywhere in the project: (1) how long an extension should grant โ€” no document (the original F5 proposal, F5c.1's retention writeup, `BUSINESS_RULES.md`) ever defined a distinct "extension period," only the 365-day standard retention period (`RETENTION_PERIOD_DAYS`); (2) where the resulting audit trail (`extendedBy`/`extendedAt`/`previousDeleteAfter`/`newDeleteAfter`/`reason`) should live.

**Alternatives considered:**

- Invent a new extension-duration constant (e.g. 90 days, or "extend by the same 30-day warning window") โ€” rejected: nothing in this project ever decided a number, and the F5d-4 brief explicitly required stopping rather than inventing one. Reusing `RETENTION_PERIOD_DAYS` itself, anchored to the moment of extension instead of `closedAt`, introduces no new duration at all.
- Store each extension as a document in a `retentionExtensions` subcollection under the attachment โ€” rejected in favor of matching this project's own established precedent: `ServiceJob.timeline` and `ServiceJob.notes` are both append-only histories embedded directly on their parent document, not subcollections. A subcollection would be more scalable at real volume, but this project has never needed that tradeoff yet, and introducing a second pattern for the same kind of data (an append-only log on a record) without a concrete reason to would be inconsistent for no benefit.
- Read-modify-write the array in application code (`getById` เนยโ€ push เนยโ€ `setDoc`) โ€” rejected in favor of Firestore's `arrayUnion()`, which appends atomically server-side; two near-simultaneous extensions on the same attachment can't race and clobber each other's entry the way a local read-modify-write could.

**Decision:** `computeExtendedRetention()` (`src/services/attachmentRetention.ts`) computes `deleteAfter = now + RETENTION_PERIOD_DAYS` and always resolves `retentionStatus` to `'active'` โ€” the same shared math every other retention state uses, just anchored to the extension moment rather than `closedAt`. `Attachment.retentionExtensions: RetentionExtension[]` is an embedded, append-only array, written to only via `firestoreAttachmentsRepository.ts`'s new `extendRetention()`, which uses `arrayUnion()` inside the same atomic `updateDoc()` call that also sets `deleteAfter`/`retentionStatus` โ€” one write, never a separate read-then-write. `src/services/attachmentRetentionExtension.ts`'s `extendAttachmentRetention()` is the orchestrating "service/action" a future UI or admin tool would call; it does not itself enforce any authorization, because none exists in this app yet (documented prominently in that file's own comment, not silently assumed).

**Impact:** "Extend Retention" always grants a fresh full standard retention period rather than an arbitrary or partial one, and always clears `'expiring-soon'` back to `'active'`. Every extension is permanently recorded, oldest first, never overwritten. This function is reachable by anyone with app or console access today โ€” there is no login anywhere in this project โ€” and must be gated behind real auth/roles before it's ever wired to a UI or exposed outside a trusted development environment.

**Status:** Decided.

**Status:** Decided.

---

## 024 โ€” Deletion safety limits: max 50 deletions per run, halt after 3 failures

**Reason:** F5d-13 built the deletion-safety foundation (`worker/src/deletionSafety.ts`) with two required, non-defaulted parameters โ€” `maxDeletionsPerRun` and `failureThreshold` โ€” deliberately left unset because no prior document or sprint had ever decided real numbers for them, and inventing them silently was explicitly out of scope. F5d-14 settles that open question.

**Alternatives considered:** None generated internally โ€” per F5d-13's own instruction, this project does not invent deletion-policy numbers; the values were supplied directly by the user as explicit policy, not derived or guessed by this assistant.

**Decision:** Two production deletion-safety limits, effective once a deletion executor is eventually built and separately approved:

- **Maximum deletions per run: 50** โ€” a hard cap `selectDeletionCandidates()` truncates to; a run never proposes more than 50 deletions regardless of how many attachments are actually eligible.
- **Failure threshold: 3** โ€” `shouldHaltRun()`'s circuit breaker; a run stops attempting further deletions once 3 individual deletion failures have occurred within it.

Chosen deliberately conservative given the project is pre-launch, production currently holds zero attachment metadata documents (confirmed as of F5d-11/F5d-13), and no deletion mechanism has ever been activated โ€” there is no real-world deletion volume yet to size these against.

**These are execution-throttling limits only โ€” not a retention or eligibility rule:**

- They do **not** change `RETENTION_PERIOD_DAYS` (365 days, decided pre-F5d-4, unchanged).
- They do **not** change `EXPIRING_SOON_WINDOW_DAYS` (30 days, unchanged).
- They do **not** change `deleteAfter` on any attachment, and are not a grace period โ€” an attachment's eligibility (`now >= deleteAfter`, per F5d-13's `isEligibleForDeletion()`) is computed identically regardless of these limits.
- They only bound how much destructive execution a single run is allowed to perform, and when it must stop early, **once a deletion executor exists and is separately approved to run** โ€” nothing in this decision authorizes building, wiring, or activating that executor.

**Impact:** `deletionSafety.ts`'s `selectDeletionCandidates()`/`shouldHaltRun()` now have real, approved values (50 / 3) any future deletion executor must pass โ€” no code change was made in F5d-14 to wire these in (that remains F5d-15+ scope). Cron activation and the deletion executor itself both remain separate, explicitly-gated approvals โ€” this decision authorizes the _numbers_, not the _capability_.

**Status:** Decided.

---

## 025 โ€” Firestore attachment lifecycle: retain metadata, mark `deletedAt`, never hard-delete

**Reason:** F5d-15 built the real R2 deletion executor but stopped immediately after a successful R2 delete because nothing in this project defined what should happen to the `serviceJobAttachments` metadata document afterward โ€” `RetentionStatus`'s own comment explicitly flagged this as an open question ("no distinct expired/deleted state yet... revisit once real deletion is introduced"). F5d-16 evaluated three options and this entry records the approved choice.

**Alternatives considered:**

- **Option A โ€” hard-delete the Firestore document after a successful R2 delete.** Already the shipped pattern for manual staff delete (`workerAttachmentsRepository.deleteAttachment()`), but rejected for the automatic/batched retention path: it destroys all audit history (uploader, category, timestamps โ€” everything) for a repair-tracking system where an attachment may carry dispute or audit value after a service job closes, and leaves an unmarked stale document (pointing at a now-gone R2 object) on a mid-sequence Firestore failure, with nothing distinguishing it from a live record.
- **Option B โ€” widen `RetentionStatus` with a new `'deleted'` value.** Preserves full audit history, but conflates two signals `worker/src/deletionSafety.ts` deliberately keeps separate: `retentionStatus` describes a time-based retention window, and that module's own comments already warn a future maintainer never to read it as a deletion-eligibility or deletion-outcome signal. Widening the union here would re-introduce exactly the ambiguity those comments guard against, and requires updating two manually-synced copies of the type (`src/types/attachment.ts` and `worker/src/attachmentRetention.ts`/`firestoreClient.ts`).

**Decision:** Retain the Firestore metadata document permanently โ€” never hard-delete it as part of the automatic retention/deletion path. Add `deletedAt: string | null` to `Attachment` (`src/types/attachment.ts`) and to the Worker's `AttachmentRetentionRecord` (`worker/src/firestoreClient.ts`): `null` means the R2 object has not been physically deleted; a timestamp means the R2 object was deleted and this document is deliberately being kept as the audit record. `RetentionStatus`'s meaning and two-value set (`'active' | 'expiring-soon'`) are unchanged.

Repository read methods (`AttachmentMetadataStore.getForJob()`/`getById()` and, transitively, the public `AttachmentsRepository` every hook consumes) exclude `deletedAt !== null` records by default, so normal application flows never see a deleted attachment. A deliberate internal-only path, `getForJobIncludingDeleted()`, exists on `AttachmentMetadataStore` for a future audit/history view โ€” not part of the public `AttachmentsRepository` interface, so it is never reachable from ordinary UI data flow.

**Impact:** F5d-17 implemented the automatic-path foundation; F5d-22 converged the manual path. `worker/src/deletionExecutor.ts` marks `deletedAt` after a genuine R2 delete or a confirmed absent object. `workerAttachmentsRepository.deleteAttachment()` now follows the same retained-metadata lifecycle: its idempotent R2 DELETE must succeed before `markDeleted()` writes `deletedAt`; Firestore failure surfaces to the caller for a later self-heal. `deletionSafety.ts` rejects records already marked deleted.

**Status:** Decided (explicit user directive, F5d-16 approval).

---

## 026 โ€” Service Job closure is the durable retention anchor

**Reason:** Future attachment retention needs one durable, trusted closure-time input. F5d-20.1 confirmed that the existing Firestore Service Job repository and `closedAt` field already provide the correct persistence boundary, but its writes were optimistic and `closedAt` originated from browser time.

**Decision:** In Firestore mode, `serviceJobs/{jobId}.closedAt` is the only durable closure-time input that a future retention reconciler may trust. Closing a Service Job is terminal for the current product lifecycle and remains anchored to the original closure time. On the first non-terminal-to-terminal transition, the Firestore repository writes `closedAt` with Firestore server time. Later saves, terminal-to-terminal transitions, and unsupported reopening attempts must not move it. Historical terminal records without a trustworthy closure value remain ambiguous and must not become retention-deletable until an explicitly approved reconciliation process addresses them.

**Impact:** Service Job create/update mutations are acknowledged promises in both repository implementations. The Firestore implementation updates its cache only after a committed server read; it uses a transaction so the server timestamp is written only for the first eligible transition. This does not activate Firestore mode, migrate data, wire the Worker to `serviceJobs`, or implement retention reconciliation.

**Status:** Decided (explicit user directive, F5d-20.1 approval).

---

## 027 โ€” Retention lifecycle guardrails for late attachments and manual deletion

**Reason:** F5d-20.1 resolved policy gaps identified during production-readiness review without authorizing retention orchestration.

**Decision:** An attachment added to an already-closed Service Job must inherit `deleteAfter = closedAt + 365 days`. Manual attachment deletion must converge to Decision #025's retained-metadata lifecycle (`R2` object removed, metadata retained, `deletedAt` written), rather than hard-deleting metadata. Automatic retention performs no immediate within-run retry and has no grace period beyond the approved 365-day retention rule.

**Impact:** F5d-22 implements these app-side lifecycle rules. Automatic deletion remains unwired and inactive; this decision does not authorize Cron, lease/pagination infrastructure, Worker authorization, or a production migration.

**Status:** Decided (explicit user directive, F5d-20.1 approval).

---

## 028 โ€” Canonical brand identity is durable and separate from display and tracking codes

**Reason:** F5d-23.1 confirmed the current Firestore Service Job documents have no durable brand scope, even though Decision #002 already requires brand-scoped authorization. The current `BRN` tracking prefix is a human-readable `brands.code`, not a canonical authorization identifier, and must not be inferred as one.

**Decision:** The canonical Firestore brand document IDs are `bruno-thailand` and `join-lux-club`. Their corresponding documents are `brands/bruno-thailand` (`code: "BRN"`, `name: "Bruno Thailand"`) and `brands/join-lux-club` (`code: "JLC"`, `name: "Join Lux Club"`). `ServiceJob.brandId` is required for every newly created durable Service Job, immutable after creation, and never receives a mapping fallback/default. Missing or malformed `brandId` fails closed for Worker authorization.

**Impact:** Future authorization compares only the canonical `brandId`, never a display name or tracking-number prefix. The Service Job creation path must obtain the ID from trusted authenticated staff context and write it explicitly. Existing records require an explicitly approved per-document backfill; the seven checked-in seed records are approved to map to `bruno-thailand`, while `BRN-2026-000001` remains unresolved/unclassified and is not approved for backfill.

**Status:** Decided (explicit user directive, F5d-23.2 approval).

---

## 029 โ€” Staff access is a one-brand Firebase UID allowlist, with a source-only first implementation phase

**Reason:** F5d-23 needs a durable staff authorization boundary without introducing customer accounts or speculative RBAC. The current application has no active authentication, session, role, or authorization model.

**Decision:** Staff identity is represented by `staffProfiles/{firebaseUid}` with exactly one field for this phase: `brandId: string`. The document ID is the Firebase UID; document existence is the staff allowlist; one brand per staff member is sufficient; no role field is added. Initial staff provisioning is manual and privileged through Firebase Auth plus Firestore Console. Browser clients must never create, update, or delete a staff profile. Email/password is the approved future staff sign-in direction; no provider or user is enabled/created by this decision.

F5d-24 is source-only: brand types/model, immutable Service Job `brandId`, staff-profile parsing, Firebase ID-token verification, Worker route authorization, and offline/fake tests only. It does not deploy the Worker, alter Firestore rules, enable an Auth provider, create a user/profile/brand document, backfill Firestore, or change IAM, secrets, or Cron.

**Impact:** Firestore client rules must be separately designed and deployed before any live staff sign-in or profile provisioning: client reads/writes must be brand-scoped, profile writes must be denied to clients, and Worker IAM-backed REST access remains a separate boundary. Public/customer tracking remains separate from staff authentication and cannot make generic file access public.

**Status:** Decided (explicit user directive, F5d-23.2 approval).

---

## 030 โ€” Products are a global reference catalog, not a brand-authorized resource

**Reason:** F5d-27 found a shared manufacturer catalog: legacy Apple and BRUNO
products coexist, while `bruno-thailand` and `join-lux-club` are the business
authorization brands. `Product.brand` therefore cannot be authorization scope.

**Decision:** Products are a global reference catalog. `Product.brand` remains
manufacturer/display metadata; no authorization `brandId` is added. Valid
staff may eventually read the shared catalog. Client catalog writes remain
denied until a separately approved privileged workflow exists. Brand, SKU,
manufacturer, model, and name remain explicit product metadata.

**Impact:** Future browser rules allow valid-staff catalog reads without a
brand predicate and deny client catalog writes. Service Job `brandId` remains
the technical authorization scope. No product migration or deployment is
authorized.

**Status:** Decided (explicit user directive, F5d-27.1 approval).

---

## 031 โ€” Customers are global identities with explicit business-brand memberships

**Reason:** A person may use both business brands. Duplicating PII per brand
creates reconciliation and privacy risks; phone-number document IDs are
mutable PII, not durable identity.

**Decision:** Customers use opaque stable IDs and `brandIds: BrandId[]`. A
customer may belong to more than one business brand; staff access requires
membership containing `staffProfiles/{uid}.brandId`. Customer PII is not
duplicated for another brand. Existing phone-number IDs are legacy and no
production migration is authorized.

**Impact:** Future queries use `array-contains` on the validated staff brand
and Rules enforce the same membership. New durable Service Jobs need a trusted
customer reference in a later source phase; legacy records remain unbackfilled.
No customer RBAC or client profile-write capability is introduced.

**Status:** Decided (explicit user directive, F5d-27.1 approval). Gate 5.2/5.3
(see PROJECT_STATE.md) executed the `brandIds`-only backfill this decision
authorizes for the seven reviewed legacy customers. The phone-number document
ID scheme itself remains unmigrated and still has no authorized production
migration.

---

## 032 โ€” Public tracking uses a separate bearer secret and a minimal customer-safe DTO

**Reason:** Sequential tracking references are useful but guessable. Public
tracking must not expose generic Service Job access or operational data.

**Decision:** The sequential brand-coded tracking reference is an identifier,
never authorization. A future eligible Service Job may have a cryptographically
random 256-bit public token; only `SHA-256(token)` is stored. The raw token is
shown only at issuance, never derived from business data, rotates by replacing
the hash, and revokes by setting it to `null`. Legacy jobs have no public
access until explicitly issued a token.

The customer URL is `https://<app>/track/<trackingReference>#<token>`. The
browser extracts the fragment and POSTs the token to
`/public/tracking/{trackingReference}`. A future backend directly reads that
one Service Job, hashes and constant-time compares the token, returns the
public DTO only, and uses indistinguishable failures where practical. It must
not authorize staff APIs, expose generic Firestore reads, attachment paths, or
R2 downloads.

The initial public DTO is tracking reference, current status, product display
name, model/SKU, last four serial characters, customer-safe status timeline
timestamps, and `lastUpdatedAt`. Customer contact data, full serial, issue or
diagnostic content, notes, technician/staff identity, internal timeline,
warranty/quote/internal claim data, attachments, R2 paths, and internal IDs
are staff-only. Public attachments are prohibited in the first secure release.

**Impact:** Public timeline mapping is a narrow DTO boundary, never direct
`ServiceJob` serialization. Public access is Worker/backend mediated and
requires rate-limit/abuse review before deployment. This decision implements
no endpoint, production token, Rule, IAM, or deployment change.

**Status:** Decided (explicit user directive, F5d-27.1 approval).

---

## 033 - One active draft Service Report per Service Job

**Reason:** Service Jobs support multiple independent Service Reports over
time, but concurrent unfinished drafts would make the staff workflow
ambiguous and could create competing report state for the same work.

**Decision:** A Service Job may have multiple Service Reports over its
lifetime, but only one report with `status = draft` may exist at a time. A new
draft may be created only after the existing draft is finalized. Finalized
reports remain immutable and later reports are new records, not revisions.
Both the UI and repository creation paths must fail closed when an active draft
already exists.

**Impact:** The Service Report UI surfaces the active draft with Continue
Editing, View, and Finalize actions. The Mock repository rejects duplicate
active drafts, and the source Firestore repository checks for an existing draft
before allocating a new report number. No Firestore Rules or production data
change is implied by this decision.

**Status:** Decided (explicit user directive, SR-2 approval).

## 034 - Service Report V1 finalization is a completeness gate, not approval

**Reason:** The current source model supports draft/final Service Reports and
immutable snapshots, but the approved Repair Report domain separately models
approval as an append-only `repair_report_approvals` history (#016). The V1
source workflow must prevent incomplete reports from becoming final without
inventing signature persistence or collapsing approval into a mutable field.

**Decision:** A draft Service Report may be saved while incomplete. The V1
finalization gate requires a non-blank customer-reported problem, non-blank
technical inspection findings, at least one typed service action, a typed
result status, and valid description/remark/positive whole-number quantity for
every part row when parts are present. Claim number, factory reference,
evidence IDs, technician remark, result detail, and technician display text are
optional for this gate. Finalization creates the existing immutable snapshot;
it does not record a signer, signature image, cryptographic signature, or
approval decision.

The printed Repair Report keeps the approved Technician and Approval signature
lines as capture-at-print placeholders. The approval history and any trusted
approver identity remain a later live-persistence/authorization phase and are
not represented as Service Report V1 fields.

**Impact:** Mock and source Firestore repositories use the same pure
finalization validation before changing status. Finalization errors are
reported without changing the draft. Firestore Rules still do not permit live
Service Report persistence, so this decision authorizes no deployment or data
write.

**Status:** Decided (SR-4 source-only scope; aligned with BUSINESS_RULES,
PRINT_SPECIFICATIONS, and DECISIONS #012/#014/#016).

---

## 035 - Human-enterable public tracking code is a separate, narrow bearer credential

**Reason:** Customers need a safe way to enter a code from a document or
message, while sequential Service Job references remain identifiers and must
not become public authorization. The existing fragment-token link remains
useful for compatibility, but a manually entered credential needs its own
bounded lookup and abuse-control boundary.

**Decision:** A trusted future issuance flow may create one public tracking
code in the form `SRV-{YYYY}-{MMDD}-{XXXXXX}`. The six-character suffix uses
cryptographically secure, unbiased random uppercase base36 characters only;
it is never sequential, customer-derived, timestamp-only, job-ID-derived, or
generated with `Math.random`. The code space is `36^6 = 2,176,782,336` and is
approximately 31 bits of suffix entropy, and is not equivalent to the existing
256-bit legacy token, so production issuance
requires a fail-closed rate-limit/abuse-control policy before activation.
With no limiter, distributed guessing is unlimited; a basic per-IP limiter
only slows casual abuse and is bypassable across sources. Production therefore
needs layered edge/IP/device throttling, generic responses, monitoring, and a
fail-closed decision when the limiter is unavailable.

The durable Service Job stores only `publicTrackingCodeHash`. A private,
Worker-mediated direct lookup component such as
`publicTrackingCodes/{normalizedCode}` may map a normalized code to exactly
one `serviceJobId`; it must not be a browser-readable collection or a full
collection scan. Public lookup verifies the hash, then returns the existing
narrow PublicTrackingDTO only. It must not authorize staff routes, Firestore
reads, attachments, R2, Service Reports, internal IDs, notes, full serials,
or staff identity. Raw codes are shown only once by a trusted issuance
boundary and are never logged, stored in browser persistence, or returned in
the public DTO.

The browser accepts a complete code from `/track#CODE`, normalizes only
unambiguous pasted input, removes credentials from history, and never accepts
ordinary query parameters as credentials. The existing
`/track/{trackingReference}#<256-bit-token>` route remains a transitional
legacy compatibility path until a separately approved migration. No legacy
code or token is backfilled by this decision. Delivery/share UI may include an
already-issued raw code only when explicitly supplied by a trusted staff
context; it must never fabricate a URL or expose a hash.

**Impact:** PUB-TRACK-1 is source/offline and emulator-test scope only. It adds
generation, parsing, hashing, trusted-preparation, narrow app/Worker seams,
and tests, but no live issuance route, Firestore write, Rule, Auth provider,
IAM, secret, R2, deployment, Cron, or production-data change. Firestore
Rules must continue to deny browser access to the private lookup component;
the exact production rate-limit policy and privileged issuance transaction
remain prerequisites for activation.

**Status:** Decided (explicit PUB-TRACK-1 scope; live activation remains
unapproved).

---

## 036 - Service Job creation is a privileged, idempotent Worker transaction

**Reason:** Browser-side sequence allocation cannot safely probe occupied Service Job IDs under brand-scoped Firestore Rules without exposing a cross-brand existence oracle.

**Decision:** New durable Service Jobs are created only by authenticated Worker `POST /service-jobs`. The Worker derives the canonical staff brand, Asia/Bangkok civil numbering year, tracking/Service Request numbers, document ID, timestamps, and initial security fields. It atomically commits the private idempotency key, both sequence updates, and a create-only Service Job. The browser supplies only bounded intake data and one retained UUIDv4 idempotency key per logical attempt. Existing authorized Service Job updates remain browser Firestore operations. Browser Rules deny Service Job creation, `numberSequences`, and `serviceJobIntakeKeys`.

**Impact:** Production activation additionally requires the reviewed IAM source specification (including `datastore.entities.create`) and a Rules deployment. No IAM, Rules, Worker, or production data change is authorized by this source-only decision. `BRN-2026-000001` is legacy and remains untouched.

**Status:** Decided (F5d-32 Phase 2 approval).
