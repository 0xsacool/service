# Service Tech Backlog

> Authoritative active-work index reconciled against repository source, deterministic tests, and the accepted production state on 2026-09-27. Historical roadmap and decision entries remain useful for lineage, but this file is the current backlog source of truth. See `PROJECT_STATE.md` for runtime history and `DECISIONS.md` for architectural decisions.

## Baseline

- Source baseline entering N7.4: `30d39ae3a7d4da5f56813412a09f961bdd793ba1` (`n7-3-dom-test-foundation-20260927`). N6 remains the underlying full clean-baseline certification.
- Accepted production Worker: D24 V1-history hotfix source `cff31a0`, version `b2534996-977d-45d3-96f7-641599d66f1c`.
- Production `SERVICE_REPORT_V2_MODE=compatibility`.
- Production Public Tracking is disabled and must remain disabled until a separately approved activation phase.
- N5/N6 are source/tooling certification only; they are not the production Worker source.
- N3 Production Remediation is **FINAL SUCCESS / CLOSED**: Writes 1–7 were completed and verified once, active V1 drafts are zero, and A–E are final. Never rerun Writes 1–7 and never create Write 8 without a new explicit production business-data decision.

## DONE — remove from active backlog

- **Marketplace username / order-number Universal Search.** Firestore search matches Service Job `contactChannelIdentity` and `orderNumber` snapshots in `src/repositories/firestoreSearchRepository.ts`; focused coverage is in `test/f5d69Search.test.mjs`.
- **Approval Console / D24 / D25 production activation.** Production acceptance and the D24 compatibility hotfix are recorded in `PROJECT_STATE.md` and the dated closeout reports.
- **Basic Service Report / Repair Report printing.** `src/features/service-jobs/components/ServiceReportPrintPreview.tsx` provides the existing printable report. This does not mean trusted V2 approval/warranty print integration is complete.
- **Delivery Note printing.** `DeliveryNotePrintPreview.tsx` is implemented. It is not the Product Return Form defined in `PRINT_SPECIFICATIONS.md`.
- **Manual customer notification share/copy.** `src/services/customerNotificationShare.ts` provides the staff-initiated Web Share / clipboard flow. Automatic delivery is separate work.
- **Targeted mounted component/hook testing.** `test/support/componentRuntime.mjs` and `hookRuntime.mjs` mount real project components/hooks in custom test runtimes. They deliberately do not provide a browser DOM.
- **Thai-capable font fallback.** `src/index.css` includes `Noto Sans Thai` and Tahoma fallbacks. Full brand typography is still open.
- **N7.2 source-of-truth documentation reconciliation.** Current-state documentation and the authoritative backlog were reconciled against source, deterministic evidence, and accepted production state; historical decisions were preserved with supersession notes rather than rewritten.
- **N7.3 browser-like DOM test foundation.** A test-only jsdom environment now mounts real React/ReactDOM components for behaviors the custom renderer cannot prove. Focused coverage verifies Modal portal/background inert/focus trap/restoration/preventClose timing, StaffShell mobile-drawer inert/focus trap/Escape/current-route/desktop-transition focus, and RouteAccessibility detail-vs-New-Service-Job focus policy. The older custom hook/component runtimes remain for deterministic lifecycle/race coverage. This is browser-like DOM coverage, not real-browser layout/print proof.
- **N7.4 V2 trusted-print UI integration.** Service Report preview now calls the existing Worker-backed trusted-print contract before opening the printable view. All six states remain distinct (legacy V1, V2 draft, pending, approved, rejected, integrity incident); approval/warranty/evidence verification is displayed from the trusted server result, normal mode is always attempted first, diagnostic mode is used only after the fail-closed evidence-integrity error, and integrity incidents cannot invoke `window.print()`. The browser now validates trusted-print report/event/evidence/verification-time coherence at runtime instead of trusting a TypeScript cast, and UI error mapping never renders raw provider/internal error text. The printable UI exposes display-name/business decision data only, not raw UIDs or digests.

## ACTIVE

### A1 — Product Return Form implementation

**What remains:** implement the distinct Product Return Form from `PRINT_SPECIFICATIONS.md`, including the accepted numbering/data contract and customer acceptance/signature semantics.

**Why active:** `DeliveryNotePrintPreview.tsx` is a delivery/handover note, not the Return Form. No Return Form UI was found.

**Dependencies:** resolve any still-open Return Form numbering/acceptance/cost semantics before implementation.

**Risk:** medium; document identity and customer acceptance must not be conflated with the Delivery Note.

**Recommended order:** first active implementation item unless owner reprioritizes.

**Production mutation required:** source implementation no; deployment separate.

**Independent review:** yes because customer-facing document semantics are involved.

### A2 — Accessibility P2/P3

**What remains:** timeline/progress semantics, PhotoGallery and DownloadMenu improvements, import chooser keyboard/label behavior, broader ProductFieldsForm semantics, measured contrast, reduced-motion behavior, and remaining bounded Thai/content QA.

**Evidence:** current components plus the deferred list in `SPRINT_ROADMAP.md`.

**Dependencies:** none for most source work; the N7.3 browser-like DOM harness is now available for interaction regressions.

**Risk:** medium.

**Recommended order:** after the higher-integrity print/test work unless owner reprioritizes.

**Production mutation required:** no for source work.

**Independent review:** recommended.

## BLOCKED / DEFERRED

- **Public Tracking activation.** Implementation exists but production activation remains deliberately deferred/disabled. Activation is a separate production phase.
- **Legacy opaque `PUBLIC_TRACKING_ENABLED` cleanup.** Current production has historical `secret_text` state. Future Worker promotion must first make the candidate state verifiable by removing the legacy binding or using visible plain-text `false`. This is a separately approved Cloudflare production-config mutation; never weaken N5 guard.
- **Admin / Staff Role Management UI.** Approval role enforcement exists, but account/role lifecycle administration does not. Browser `staffProfiles` writes remain denied; privileged provisioning architecture must be explicitly scoped.
- **BRUNO / JLC full visual identity.** Generic visual tokens remain until brand assets/palette/theming direction are supplied.
- **Durable Product Instance / server-side serial uniqueness.** Current Registered Products are derived from Service Job history; durable physical-unit identity and authoritative serial-conflict enforcement need an architecture decision.
- **Automatic retention/deletion / Cron activation.** Retention and deletion foundations exist, but default Wrangler config contains no Cron trigger and destructive automatic execution remains separately gated.
- **Automatic LINE/SMS/email notifications.** Manual share/copy exists; channel choice, canonical customer contact/consent, retry and delivery-audit design remain unresolved.
- **Customer quote approval.** Staff/report approval via D25 is not customer quote acceptance.
- **Technician workload management.** No complete durable workload/assignment workflow has been approved.
- **Full customer history / full physical-product history.** Partial repeat/latest history exists; complete physical-unit history depends on durable Product Instance identity.
- **Customer feedback.** Not yet scoped.
- **Customer-visible attachment expansion.** Private Worker/R2 staff evidence exists; broader customer visibility needs a separate security/product decision.

## OBSOLETE / SUPERSEDED CURRENT-STATE CLAIMS

The following statements may remain in historical context but must not be used as current truth:

- Firestore Universal Search cannot match marketplace username or order number.
- The project has no mounted component tests at all.
- The project has no browser-like DOM harness for focus/inert/portal interactions.
- Public Tracking is currently live in production.
- Product Master is the only real backend entity and all other repositories are Mock.
- Repair Reports / Approvals / Approval Console are not yet scoped.
- Repair Report printing is absent.
- The UI font stack has no Thai-capable fallback.
- F5d-23 is the exact next work.
- The source still uses the flat prototype folder structure or the Claim rename is incomplete.

## OPTIONAL / POLISH

- Remove orphaned `@supabase/supabase-js` after a separately approved dependency-cleanup change.
- Cosmetic print spacing, brand font packaging, and non-blocking visual polish.
- Worktree/local orchestration hygiene when explicitly scheduled; do not remove retained safety worktrees/stashes casually.

## Recommended sequence

1. Implement Product Return Form.
2. Continue the remaining P2/P3 accessibility/content work according to owner priority.
3. Keep this backlog/source-of-truth documentation current as each phase closes.
4. Revisit deferred operational/product work only after its dependency or owner decision is resolved.
