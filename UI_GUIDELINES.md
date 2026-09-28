# UI Guidelines

> Documents the design system **as it currently exists** in [src/index.css](src/index.css) and the shared primitives under `src/shared/components/`. The palette still carries Apple-support-style placeholder roots from the Bolt.new generation, while later phases added Thai-first and accessibility hardening. Treat this file as current UI truth and keep brand-identity work distinct from already-delivered Thai/script support.

## Colors

Defined as Tailwind v4 theme tokens in `src/index.css`.

| Scale                | Use                                   | Base value                                       |
| -------------------- | ------------------------------------- | ------------------------------------------------ |
| `brand-*` (50–900)   | Primary actions, links, active states | `brand-500 = #0071e3` (Apple blue — placeholder) |
| `success-*` (50–700) | Ready/positive states                 | `success-500 = #34c759`                          |
| `warning-*` (50–700) | Awaiting/attention states             | `warning-500 = #f59e0b`                          |
| `danger-*` (50–700)  | Errors, urgent priority               | `danger-500 = #ef4444`                           |
| `neutral-*`          | Text, borders, backgrounds            | Tailwind default; `neutral-600 = #525252` pinned |
| `canvas`             | Page background                       | `#f5f5f7`                                        |
| `ink`                | Primary text color                    | `#1d1d1f`                                        |

**Status color mapping** (`src/lib.ts` → `statusColor`): each `ClaimStatus` maps to a `{ text, bg, dot, ring }` tuple — brand blue for Received, violet for Diagnosing, amber for Awaiting Parts, blue for In Repair, cyan for Quality Check, success green for Ready for Pickup, neutral gray for Completed. New exception statuses (**Cancelled**, **Rejected** — see `BUSINESS_RULES.md`) need color assignments added here before they're implemented; suggested: `danger` tones for both, distinguished by icon rather than color alone (see Accessibility note below).

> **Pending decision:** brand color palette should be replaced per-brand (Bruno Thailand vs. Join Lux Club) rather than a single global palette, once brand identities are supplied — tracked in `DECISIONS.md` as open.

## Spacing & Radius

- Card corner radius: `--radius-card: 1.5rem` (24px) — used consistently via `GlassCard`.
- Standard interior padding: `p-5`/`p-6` for cards, `px-4 py-3.5` for buttons/inputs.
- Grid gaps: `gap-4` (mobile) stepping up to `gap-6` at `lg:`.

## Typography

- Font stack: current `src/index.css` includes `Noto Sans Thai` and Tahoma fallbacks (plus Latin/Japanese/Chinese fallbacks where relevant), so the earlier "no Thai-script font" blocker is resolved at the fallback-stack level. A branded/bundled typeface is still an open visual-identity decision; cross-platform visual consistency should be verified rather than inferred from fallback declarations alone.
- Letter spacing: `-0.01em` globally (`body` in `index.css`) — an Apple-style tightening that may not suit Thai script; re-evaluate during the brand pass.
- Headings: `text-3xl`/`text-4xl` semibold tracking-tight for page titles; `text-lg` semibold for section headers.
- Body: default weight, `text-neutral-500`/`600` for secondary text.

## Buttons

- **Primary** (`PrimaryButton`): pill-shaped, `bg-brand-500`, white text, `hover:bg-brand-600`, `active:scale-[0.98]`, visible focus ring (`focus-visible:ring-2`).
- **Secondary** (`SecondaryButton`): pill-shaped, translucent white background, brand-colored text, subtle ring, and a `brand-600` custom focus indicator with measured ≥3:1 contrast against white.
- Both use full-pill (`rounded-full`) shape consistently — maintain this for any new button variant.

## Cards

- `GlassCard`: white/70% opacity, backdrop blur, 1.5rem radius, soft dual shadow, 1px black/5% ring. This "glass" look is a deliberate, consistent motif — don't introduce alternate card styles without updating this document.

## Inputs

- `inputClass()` helper: white/80% background, 2xl radius, 1px black/10% ring, focus ring in brand color, neutral-400 placeholder text.
- `Field`: label + input + optional hint, consistent vertical rhythm (`mb-2` label, `mt-1.5` hint).
- N7.7 completed the bounded ProductFieldsForm accessibility slice: invalid controls reference alert text, status controls expose pressed state, and related custom focus indicators use the measured `brand-600` focus token. Broader form/business-rule work still follows `BACKLOG.md`.

## Tables

- Desktop Service Job list uses the current Service Job feature components; do not reintroduce prototype-era `ClaimsList` naming. Preserve the established responsive table/card behavior when modifying list presentation.
- Below `lg:` breakpoint, tables convert to a card list rather than becoming horizontally scrollable — this is the established pattern; follow it for any future tabular data rather than introducing horizontal scroll on mobile.

## Forms

- Sectioned into `GlassCard` blocks with an icon + title + subtitle header (see `NewClaim`'s `Section` helper) — reuse this pattern for any new multi-section form rather than inventing a new grouping style.
- Required fields marked with `*` in the label text — **currently cosmetic only**; Sprint 2 must back this with real `required`/validation behavior.

## Status Badges

- `StatusBadge`: pill with a colored dot + label, `sm`/`md` sizes, color driven by `statusColor()`.
- `PriorityPill`: pill, color driven by `priorityColor()`, no icon/dot — text and background color are the only signal today. **Accessibility gap:** should not rely on color alone; consider adding an icon or pattern differentiator in the Sprint 2 pass (see `PROJECT_STATE.md` limitations).

## N7.7 Accessibility Hardening

- Timeline items identify the current step with `aria-current="step"`; progress exposes the standard progressbar value contract.
- PhotoGallery thumbnails are labelled toggle-like selectors with `aria-pressed`; decorative thumbnail images use empty alt text.
- DownloadMenu is a disclosure, not an ARIA menu: the trigger exposes `aria-expanded`/`aria-controls`, options remain ordinary buttons in a labelled group, opening moves focus to the first option, and Escape restores the trigger.
- The Product Import file chooser keeps its native file input keyboard-focusable via `sr-only`, associates description/error text, and reports validation errors with an alert.
- Scoped secondary text/error/warning tokens were raised to measured contrast targets; N7.7-added focus indicators use `brand-600` and meet the 3:1 non-text contrast target against white.
- `prefers-reduced-motion: reduce` globally collapses animation/transition duration and disables smooth scrolling. Real-browser/assistive-technology behavior remains an acceptance concern beyond jsdom/static review.

## Responsive Behavior

- Two breakpoints in active use: `sm:` (640px) and `lg:` (1024px). No `md:` breakpoint is currently used — the layout jumps from mobile to desktop-table/sidebar at `lg:`, which can feel cramped in the 640–1024px range (e.g. Dashboard's 2-column stat grid). Worth reassessing during Sprint 2, not before.
- Staff shell: fixed sidebar at `lg:` and above, slide-in drawer below `lg:` — established pattern for any future staff-only navigation surface.
- Public pages (`TrackHome`, `TrackResult`) are single-column responsive layouts with no sidebar — keep the customer-facing experience free of the staff chrome.

## Print Layout Principles

_(New section — no print layout exists yet; this defines the target for Sprint 8's "Print receipt" implementation.)_

- Print output must **not** carry over the glass/blur/gradient visual language — use plain white background, solid borders, high-contrast black text for print media (`@media print` overrides).
- Must prominently show: tracking number, product, customer name, status, and the Buddhist Era date (per `DECISIONS.md`) alongside or instead of the Gregorian date.
- No interactive chrome (buttons, nav, sidebar) should render in print output.
- Should fit a single page for a standard service job receipt where possible; long note/timeline lists may paginate but should not truncate silently.
