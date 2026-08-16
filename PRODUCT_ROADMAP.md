# Product Roadmap

> The "why" and "where this is going." For sprint-level breakdown of how we get there, see [SPRINT_ROADMAP.md](SPRINT_ROADMAP.md). Terminology: the core entity is the **Service Job** — see [DECISIONS.md](DECISIONS.md) #009.

## Vision

Every service job for Bruno Thailand and Join Lux Club — from drop-off to pickup — tracked in one system, visible in real time to the customer who owns it, manageable in one queue by the staff who work it, transparent in aggregate to the admins who run the operation, and linked to the full repair history of the physical product itself.

## Goals

- **Transparency for customers.** Anyone can check a repair's status with just a tracking number — no account required.
- **Efficiency for service staff.** One queue, clear status states, fast intake, and a single place to update a service job rather than juggling spreadsheets or chat threads.
- **Oversight for admins.** Cross-brand visibility into volume, turnaround time, and bottlenecks (e.g. parts delays).
- **Lifetime product history.** A specific physical unit's repair history should be traceable across every service job it's ever had, not just the most recent one (see the Customer/Product Instance model in [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md)).
- **Brand separation without duplication.** Bruno Thailand and Join Lux Club share one system and one codebase, but their data, branding, and (where relevant) staff access stay scoped to each brand.
- **Built for Thailand.** Thai language, THB currency, Thai date/calendar conventions, and Asia/Bangkok time as the default experience, not an afterthought bolted onto an English product.

## Target Users

| Role | Who they are | What they need |
|---|---|---|
| **Admin** | Operations/management overseeing both brands | Full visibility across brands, user/staff management, brand and system settings, reporting |
| **Service Staff** | Technicians and front-counter staff at a service center | Fast intake, a manageable service job queue, ability to update status/notes/photos, assignment tracking |
| **Customer** | The person who dropped off a product for repair | Simple tracking lookup, clear status and timeline, no login friction, pickup/contact info |

## Implemented

Features that exist and work in the running app today, not just on paper — see [PROJECT_STATE.md](PROJECT_STATE.md) "Completed Milestones" for the sprint-by-sprint history behind each:

- **Customer-facing tracking UI** — no-login lookup UX and safe "not found"
  states exist, but production Public Tracking remains intentionally
  unavailable until its issuance and fail-closed rate-limit scope is approved.
- **Production staff service job queue & intake** — the staff-only app is live
  at `https://luxace-service.web.app` on the Firestore + Worker runtime, with
  filterable/searchable jobs, progressive intake, and Save & Print.
- **Product Master catalog** — full CRUD (create, view, edit — no delete by design, see [DECISIONS.md](DECISIONS.md)) for the product catalog, with search/filter/sort, CSV/Excel export, and a CSV import wizard (preview → validation → completed summary).
- **Product Knowledge** — accessories and common problems attached per product, editable via a dedicated detail page.
- **Repository Provider architecture** — every page reads data through a typed repository interface, not hardcoded arrays, making later backend swaps low-risk (already proven once, below).
- **Production backend and staff authorization** — Product Master, Customers,
  Service Jobs, Search, Registered Products, and related staff flows use the
  Firestore repository path; file bytes use the authenticated Worker/R2 path.
  Firebase Email/Password plus staff-profile/brand checks protect the staff
  surface. Mock remains a development mode, not the production runtime.
- **Production Trust & Thai-first staff slice** — F5d-63 is live with
  deterministic Asia/Bangkok date/time presentation, THB quotes,
  product-neutral Thai warranty language, truthful Dashboard aggregation,
  canonical brand context, and removal of fabricated or inert operational UI.

## Planned

Not yet built. Listed in roughly the order the current sprint trajectory (F-series) suggests, though nothing below is scheduled or approved beyond what's in [SPRINT_ROADMAP.md](SPRINT_ROADMAP.md):

- **Auth and administration expansion** — staff Auth is live; broader Admin
  and Customer roles, user lifecycle, and administration remain future work.
- **Walk-in customer + first-time product registration** — source only, not
  production complete (F5d-65): staff can create a new customer and register
  a new customer product directly from New Service Job when Universal Search
  finds no match, atomically with Service Job creation. Warranty must be
  explicitly confirmed by staff (no default), and a serial number already
  known to service history blocks manual registration rather than inferring
  ownership from a shared phone number. Server-side serial-conflict
  enforcement remains a P2 hardening item. Not in production — pending
  independent re-review and a separately approved deployment; see
  `SPRINT_ROADMAP.md`.
- **Notifications** — automatic customer updates on status change, delivered to a customer's registered contact channel (SMS/LINE/email are the realistic channels for the Thai market; exact channel choice is a future decision, not yet made — the `customer_channel_contacts` entity already anticipates this).
- **Attachment experience expansion** — private Worker/R2 storage is live;
  broader presentation and any customer-visible attachment policy remain.
- **Quote & warranty approval flow** — customer approves/declines a repair quote before work proceeds.
- **Remaining printable documents** — Repair Report and Return Form (Service Request printing is already implemented — see Implemented above).
- **Remaining localization & accessibility work** — F5d-63's bounded
  Thai-first production trust slice and F5d-64's audited P0/P1 keyboard, focus,
  dialog, route, form, and screen-reader hardening are live. F5d-64 production
  verification matched all 21/21 user files and the approved SPA routes after
  one Hosting deployment, with the Worker unchanged and zero production data
  writes. Public Tracking remains unavailable. The explicitly deferred P2/P3
  accessibility work, responsive-content QA, and remaining Thai-copy pass
  remain open (see [DECISIONS.md](DECISIONS.md) #003).
- **Technician workload view** — who's assigned what, to help staff balance the queue.
- **Customer service history** — repeat-customer view showing all of a customer's past service jobs across their product instances.
- **Product service history** — for a specific physical unit, a full repair timeline across every service job it's ever had.
- **Customer feedback** — a lightweight satisfaction check after a service job closes.

## Long-Term Direction

Version 1 is intentionally scoped to a single market: Thai-language UI, THB, Asia/Bangkok time, for two known brands. The architecture should stay **localization-ready** (no hardcoded English strings baked into logic, formatting centralized) so a second language or market could be added later — but full multilingual support, additional brands beyond the two named here, and integrations with external systems (POS, inventory, CRM) are explicitly **not committed** for V1. They're captured here as directional context, not as scoped work — see [DECISIONS.md](DECISIONS.md) for what has actually been decided versus what remains open.
