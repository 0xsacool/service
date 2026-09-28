# Service Tech Backlog

> Authoritative active-work index reconciled against repository source, deterministic tests, and the accepted production state after N8 closeout on 2026-09-28. Historical roadmap and decision entries remain useful for lineage, but this file is the current backlog source of truth. See `PROJECT_STATE.md` for runtime history and `DECISIONS.md` for architectural decisions.

## Baseline

- Current published source checkpoint: `daa010cc2f138399a192a435f9ba87b84e27ce7e` (`n8-gatea-guard-preview-fix-20260928`). The only delta from N7.8 certified runtime source `30d2b32d3048b50f8d8aaccc8748a416e919fa44` is the tested production-version guard script/test correction; `src`, `worker/src`, Firestore Rules/indexes, Firebase Hosting config, and Wrangler runtime config are unchanged by that publication.
- Accepted production Worker: version `341775c9-9c60-4703-842f-89b565a33545`, deployment `6265a345-6c36-4c0b-b0ba-8b94e04ba956`, 100% traffic.
- Accepted production Hosting: release `1790599550496000`, version `55b6074514a25278`, serving the exact 25-file frozen N8.2R1 artifact with canonical manifest SHA-256 `4ceef18d3fad081421f754affb3a785757251c23d06b11369e97423338ca4302`.
- Accepted production Firestore Rules: ruleset `9070ddb3-234e-4e06-b7fa-58fc544d52e5`, raw SHA-256 `ae8f93454b61f49df31244c4de31d8c5fa5887c5c7e6db967c67edae2df04867`.
- Production `SERVICE_REPORT_V2_MODE=compatibility`; `PUBLIC_TRACKING_ENABLED=false` is visible plain-text and Public Tracking remains disabled until a separately approved activation phase.
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
- **N7.5 Product Return Form contract reconciliation.** Decision #049 fixes the implementation contract before source work: Return Forms are for `Completed` jobs only; `closedAt` is the V1 pickup/acceptance timestamp only in that state; `RT-{YYYY}-{SEQUENCE}` is allocated exactly once by a trusted backend boundary during the first Completed transition; the latest report must be a normal trusted-print `v2-approved` result; customer and staff both countersign the paper form; no price/cost is printed in V1; legacy V1/draft/pending/rejected/integrity-incident reports fail closed for Return Form generation.
- **N7.6 Product Return Form implementation + N8 production activation.** The application has explicit `returnFormNumber`, a Worker-mediated `POST /service-jobs/{jobId}/complete` boundary, atomic Completed/`closedAt`/RT-number/`return_form`-sequence commit, replay-safe completion, browser update sequencing that saves ordinary edits before trusted completion, a distinct `ProductReturnFormPrintPreview`, and normal-only trusted-print gating against the latest D24 documentary report. Firestore Rules make `returnFormNumber` Worker-owned and prevent browser entry to or exit from `Completed`; historical Completed jobs missing trusted RT/closure metadata remain fail-closed and are not silently backfilled. N8 deployed the certified Worker/frontend/Rules in dependency order and credentialed read-only production acceptance confirmed the new Return Form surfaces/fail-closed behavior without business-data writes.
- **N7.7 Accessibility/content source hardening.** Timeline/progress now expose current-step and numeric progress semantics; PhotoGallery thumbnails expose labelled selected state; DownloadMenu behaves as a disclosure with explicit expanded/controlled state plus deterministic focus/Escape restoration; ProductFieldsForm associates validation errors and status selection semantics; the CSV chooser remains keyboard-focusable with labelled/error state; bounded Product Import copy is Thai-first; secondary/status/import text uses measured higher-contrast tokens; and global reduced-motion handling is present. The focused mounted suite passes 7/7, app build/lint/format/diff-check pass after final corrections, broader affected regressions passed, and final GPT-6 Astra read-only review returns `VERDICT: PASS` / `FINDINGS: NONE`. This is source work only; real-browser assistive-technology/rendering verification and production deployment remain separate.
- **N7.8 N7.x final certification/closeout.** The published N7.7 checkpoint is re-certified in a fresh isolated worktree: app build/lint/format and every documented root package-script suite pass, Worker typecheck/full tests pass, Firestore Rules pass 35/35, production-dependency audits report zero vulnerabilities, and tracked source remains unchanged. The standalone Product Master Import diagnostic still exposes the same three pre-existing non-gating baseline failures recorded by N7.7; they remain deferred rather than being hidden inside closeout. Final independent GPT-6 Astra re-review returns `VERDICT: PASS` / `FINDINGS: NONE` after correcting two closeout-document consistency findings; the review loop is recorded in the N7.8 closeout report.
- **N8 production reconciliation / rollout / closeout.** N8.1 audited the production delta and safe rollout order; N8.2/N8.2R1 produced the frozen compatibility-mode artifact; N8.3/N8.3A independent GPT-6 Sol review found and verified correction of the initial disabled-mode build defect; Gate A prepared guard-compliant forward/fallback Worker versions; Gate B freshly captured the Rules rollback baseline; N8.4 deployed Worker -> Hosting -> Rules and verified exact live identities/hashes. Credentialed read-only production UI acceptance then loaded dashboard, D24 trusted print, D25 Approval Console, Product Return Form eligibility and legacy fail-closed behavior. N8 is CLOSED; detailed evidence is in `reports/Service-Tech-N8-Production-Rollout-Final-Closeout-20260928.txt`.

## ACTIVE

N8 is closed after controlled production rollout and credentialed read-only acceptance. No N7.x/N8 rollout item remains active; blocked/deferred operational and product items below retain their own approval boundaries and require separately approved phases.

## BLOCKED / DEFERRED

- **Public Tracking activation.** Implementation exists but production activation remains deliberately deferred/disabled. Activation is a separate production phase.
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

1. Keep N8 closed and preserve the accepted production/rollback identities unless a new explicitly scoped phase is approved.
2. Public Tracking activation remains a separate production decision even though the live Worker now carries visible plain-text `false` and passes the deployment guard.
3. Treat broader real-browser assistive-technology/device/print-pagination work as separate verification/polish, not unfinished N8 rollout work.
4. Revisit deferred operational/product work only after its dependency or owner decision is resolved.
