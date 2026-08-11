# UI Guidelines

> Documents the design system **as it currently exists** in [src/index.css](src/index.css) and [src/components/ui.tsx](src/components/ui.tsx). These are Apple-support-styled placeholder values inherited from the Bolt.new generation — they are the working baseline until the Sprint 2 brand identity pass replaces them with real Bruno Thailand / Join Lux Club visuals. Treat this file as "what's true today," and update it when the brand pass lands.

## Colors

Defined as Tailwind v4 theme tokens in `src/index.css`.

| Scale | Use | Base value |
|---|---|---|
| `brand-*` (50–900) | Primary actions, links, active states | `brand-500 = #0071e3` (Apple blue — placeholder) |
| `success-*` (50–700) | Ready/positive states | `success-500 = #34c759` |
| `warning-*` (50–600) | Awaiting/attention states | `warning-500 = #f59e0b` |
| `danger-*` (50–600) | Errors, urgent priority | `danger-500 = #ef4444` |
| `neutral-*` | Text, borders, backgrounds | Tailwind default neutral scale |
| `canvas` | Page background | `#f5f5f7` |
| `ink` | Primary text color | `#1d1d1f` |

**Status color mapping** (`src/lib.ts` → `statusColor`): each `ClaimStatus` maps to a `{ text, bg, dot, ring }` tuple — brand blue for Received, violet for Diagnosing, amber for Awaiting Parts, blue for In Repair, cyan for Quality Check, success green for Ready for Pickup, neutral gray for Completed. New exception statuses (**Cancelled**, **Rejected** — see `BUSINESS_RULES.md`) need color assignments added here before they're implemented; suggested: `danger` tones for both, distinguished by icon rather than color alone (see Accessibility note below).

> **Pending decision:** brand color palette should be replaced per-brand (Bruno Thailand vs. Join Lux Club) rather than a single global palette, once brand identities are supplied — tracked in `DECISIONS.md` as open.

## Spacing & Radius

- Card corner radius: `--radius-card: 1.5rem` (24px) — used consistently via `GlassCard`.
- Standard interior padding: `p-5`/`p-6` for cards, `px-4 py-3.5` for buttons/inputs.
- Grid gaps: `gap-4` (mobile) stepping up to `gap-6` at `lg:`.

## Typography

- Font stack: `-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif` — **placeholder, does not include a Thai-script font**. Must be replaced with a stack that renders Thai correctly (e.g. a Thai-supporting webfont or system stack including Thai glyphs) before the Thai-first pass ships — flagged as required, not optional, given [DECISIONS.md](DECISIONS.md).
- Letter spacing: `-0.01em` globally (`body` in `index.css`) — an Apple-style tightening that may not suit Thai script; re-evaluate during the brand pass.
- Headings: `text-3xl`/`text-4xl` semibold tracking-tight for page titles; `text-lg` semibold for section headers.
- Body: default weight, `text-neutral-500`/`600` for secondary text.

## Buttons

- **Primary** (`PrimaryButton`): pill-shaped, `bg-brand-500`, white text, `hover:bg-brand-600`, `active:scale-[0.98]`, visible focus ring (`focus-visible:ring-2`).
- **Secondary** (`SecondaryButton`): pill-shaped, translucent white background, brand-colored text, subtle ring.
- Both use full-pill (`rounded-full`) shape consistently — maintain this for any new button variant.

## Cards

- `GlassCard`: white/70% opacity, backdrop blur, 1.5rem radius, soft dual shadow, 1px black/5% ring. This "glass" look is a deliberate, consistent motif — don't introduce alternate card styles without updating this document.

## Inputs

- `inputClass()` helper: white/80% background, 2xl radius, 1px black/10% ring, focus ring in brand color, neutral-400 placeholder text.
- `Field`: label + input + optional hint, consistent vertical rhythm (`mb-2` label, `mt-1.5` hint).
- **Gap identified in Sprint 2 scope:** no error/invalid state is currently styled — needs a defined error variant (border/text color, message placement) before `NewClaim` validation ships.

## Tables

- Desktop service job table (`ClaimsList` in current code — see [PROJECT_STATE.md](PROJECT_STATE.md) Terminology Note): plain `<table>`, uppercase tracked-letter-spacing header row, row hover highlight, divider lines between rows via `divide-black/5`.
- Below `lg:` breakpoint, tables convert to a card list rather than becoming horizontally scrollable — this is the established pattern; follow it for any future tabular data rather than introducing horizontal scroll on mobile.

## Forms

- Sectioned into `GlassCard` blocks with an icon + title + subtitle header (see `NewClaim`'s `Section` helper) — reuse this pattern for any new multi-section form rather than inventing a new grouping style.
- Required fields marked with `*` in the label text — **currently cosmetic only**; Sprint 2 must back this with real `required`/validation behavior.

## Status Badges

- `StatusBadge`: pill with a colored dot + label, `sm`/`md` sizes, color driven by `statusColor()`.
- `PriorityPill`: pill, color driven by `priorityColor()`, no icon/dot — text and background color are the only signal today. **Accessibility gap:** should not rely on color alone; consider adding an icon or pattern differentiator in the Sprint 2 pass (see `PROJECT_STATE.md` limitations).

## Responsive Behavior

- Two breakpoints in active use: `sm:` (640px) and `lg:` (1024px). No `md:` breakpoint is currently used — the layout jumps from mobile to desktop-table/sidebar at `lg:`, which can feel cramped in the 640–1024px range (e.g. Dashboard's 2-column stat grid). Worth reassessing during Sprint 2, not before.
- Staff shell: fixed sidebar at `lg:` and above, slide-in drawer below `lg:` — established pattern for any future staff-only navigation surface.
- Public pages (`TrackHome`, `TrackResult`) are single-column responsive layouts with no sidebar — keep the customer-facing experience free of the staff chrome.

## Print Layout Principles

*(New section — no print layout exists yet; this defines the target for Sprint 8's "Print receipt" implementation.)*

- Print output must **not** carry over the glass/blur/gradient visual language — use plain white background, solid borders, high-contrast black text for print media (`@media print` overrides).
- Must prominently show: tracking number, product, customer name, status, and the Buddhist Era date (per `DECISIONS.md`) alongside or instead of the Gregorian date.
- No interactive chrome (buttons, nav, sidebar) should render in print output.
- Should fit a single page for a standard service job receipt where possible; long note/timeline lists may paginate but should not truncate silently.
