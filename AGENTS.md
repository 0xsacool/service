# AGENTS.md

> Working guide for Codex sessions on this project. Read this first, then [PROJECT_STATE.md](PROJECT_STATE.md) for current status before starting any task. If a decision here conflicts with something newer in [DECISIONS.md](DECISIONS.md), the more recent decision wins — update this file to match.
>
> **Terminology:** the core business entity is the **Service Job**, not "Claim" — see [DECISIONS.md](DECISIONS.md) #009. Use "Service Job" in all new documentation, code, and naming. The current prototype code still says "Claim" — that's a known, tracked gap (Sprint 1), not something to silently work around or copy into new code.

## Read Before Starting Work

1. [PROJECT_STATE.md](PROJECT_STATE.md) — what actually exists right now.
2. [DECISIONS.md](DECISIONS.md) — why things are the way they are; don't re-litigate a decision logged here without flagging it to the user first.
3. Whichever of [BUSINESS_RULES.md](BUSINESS_RULES.md), [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md), [UI_GUIDELINES.md](UI_GUIDELINES.md), or [PRINT_SPECIFICATIONS.md](PRINT_SPECIFICATIONS.md) is relevant to the task at hand.

## Coding Standards

- TypeScript strict mode — no `any`, no unchecked casts. Prefer narrowing/discriminated unions over type assertions.
- Functional components with hooks only — no class components.
- No business logic embedded in components — a component reads data via a hook/data-access seam ([DECISIONS.md](DECISIONS.md) #006) and renders it; it doesn't compute domain rules inline (e.g. status-transition legality belongs in a shared function, not scattered across `onClick` handlers).
- No comments explaining *what* code does — code should read clearly from naming. Only comment a genuinely non-obvious *why* (a workaround, a business-rule constraint that isn't visible from the code itself).
- No premature abstraction — extract a shared component/hook when duplication actually exists (see current known duplication in `PROJECT_STATE.md`), not speculatively for hypothetical future reuse.

## Architecture Rules

- **Feature-based folders**, not one flat `components/` directory — see Folder Structure below.
- **Data access only through hooks** (`useServiceJobs()`, `useCustomers()`, `useProductInstances()` and successors) — never call Supabase directly from inside a page/component once the backend lands. This is what makes the Sprint 3/4 backend cutover safe.
- **Routing owns navigation** once adopted ([DECISIONS.md](DECISIONS.md) #007) — no reintroducing a `useState<PageId>`-style manual page switch.
- **Brand scoping is not optional** — any new query, component, or table touching `service_jobs`, `customers`, `products`, or `settings` must account for `brand_id` per [DECISIONS.md](DECISIONS.md) #002. If a feature seems to need to ignore brand scoping, stop and ask rather than assuming it's fine.
- **Respect the entity chain.** Customer identity (name, contact channels) belongs to `customers`; a physical unit's purchase/warranty facts belong to `product_instances`; only the specific repair event's details belong to `service_jobs`. Don't collapse these back into flat fields on one table — that's exactly the design [DECISIONS.md](DECISIONS.md) #011/#012/#015 moved away from.
- **Formatting/locale centralized** — date, currency, and status-label formatting go through shared utilities (today: `src/lib.ts`), not ad hoc `toLocaleDateString()` calls per component, so the Thai-first conventions in [DECISIONS.md](DECISIONS.md) #003 stay consistent everywhere.

## Folder Structure (target — see Sprint 1 in SPRINT_ROADMAP.md)

```
src/
  app/                       # App shell, routing table
  features/
    tracking/pages/          # Public customer tracker (TrackHome, TrackResult, TrackNotFound)
    service-jobs/pages/      # Staff service job management (ServiceJobsList, ServiceJobDetails, NewServiceJob)
    service-jobs/components/ # Service-job-feature-specific components
    customers/                 # Customer master lookup/create UI
    product-instances/          # Product instance lookup/create UI, product/model catalog browsing
    repair-reports/               # Repair report + parts + approval UI (Sprint 7)
    dashboard/pages/
    dashboard/components/
    auth/pages/                     # Login
    auth/hooks/                       # useSession (stub until real auth lands)
  shared/
    components/                        # Row, Timeline, PhotoGallery, ProgressBar, Logo, ui.tsx primitives
    layout/                              # StaffShell
    hooks/                                 # useServiceJobs, useCustomers, useProductInstances, and other data-access hooks
    lib/                                     # format.ts, colors.ts
    data/                                      # mock fixtures (until Sprint 4 backend swap)
  types/                                        # serviceJob.ts, customer.ts, productInstance.ts, brand.ts
```

This is the target from the architectural review — not yet in place. Until Sprint 1 lands, the current flat `src/components/` structure (still "Claim"-named) remains authoritative; don't half-migrate mid-task.

## Naming Conventions

- Components: `PascalCase.tsx`, one primary export per file matching the filename.
- Hooks: `useCamelCase.ts`.
- Functions/variables: `camelCase`.
- Types/interfaces: `PascalCase`, no `I`/`T` prefix (target: `ServiceJob`, `Customer`, `ProductInstance` — matching current `Claim`/`ClaimStatus`/`PageId` pattern, just renamed per [DECISIONS.md](DECISIONS.md) #009).
- Files that export multiple small related utilities (like current `lib.ts`) should be named for their content (`format.ts`, `colors.ts`), not left generic, once split per the target folder structure.

## Commit Style

Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `test:`. Scope the subject to what changed, explain *why* in the body when it's not obvious from the diff alone (matches this project's existing preference for reasoning over restating).

## Development Workflow

- This project moves in reviewed phases (see [SPRINT_ROADMAP.md](SPRINT_ROADMAP.md)) — don't jump ahead to a later sprint's scope without the user approving that phase first, even if it seems efficient to bundle it in.
- Architectural changes get logged in [DECISIONS.md](DECISIONS.md) as they're made, not retroactively — add an entry in the same change that makes the decision.
- When a task touches business rules, schema, or UI conventions, check the relevant doc first — don't infer a rule from prototype code that may itself be a known gap (cross-reference `PROJECT_STATE.md`'s Current Limitations section).
- If a requirement conflicts with a decision already logged in `DECISIONS.md`, surface the conflict to the user rather than silently picking one side.

## Things That Should Never Be Done

- **No backend, auth, or database work without explicit phase approval** — this project has been deliberately sequenced (docs → architecture cleanup → UX/locale → backend) and each phase has been gated on user approval so far; keep it that way.
- **No secrets committed** — no API keys, service role keys, or `.env` contents in source or docs. `.gitignore` already excludes `.env`; keep it that way.
- **No direct database/Supabase calls from UI components** once the backend lands — always through the data-access hook layer.
- **No silently dropping the Thai-first requirement** ([DECISIONS.md](DECISIONS.md) #003) — don't default new UI text/dates/currency to English/USD "to move faster" and leave localization for later; it compounds.
- **No collapsing Customer/Product Instance/Service Job back into flat fields** — see Architecture Rules above.
- **No destructive git operations** (force-push, hard reset, history rewrite) without explicit user instruction.
- **No skipped hooks or bypassed checks** (`--no-verify` or equivalent) without explicit user instruction.
- **No package installs or dependency changes** without the user's go-ahead — this project has explicitly gated even documentation work behind "do not install packages" instructions; treat that caution as the default posture, not just a one-off restriction for Phase 1.
- **No cross-brand data leakage** — any new query or view must respect brand scoping ([DECISIONS.md](DECISIONS.md) #002); this is a correctness requirement, not a nice-to-have.
