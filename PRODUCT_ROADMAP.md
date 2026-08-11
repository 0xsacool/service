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

- **Customer-facing tracking** — public, no-login lookup of a service job by tracking number, with a real shareable URL and a proper "not found" state.
- **Staff service job queue & intake** — filterable/searchable service job list, a full progressive intake flow (universal customer/product search → product identity → problem/accessories → service intake), and a working Save & Print flow producing a real Service Request print layout.
- **Product Master catalog** — full CRUD (create, view, edit — no delete by design, see [DECISIONS.md](DECISIONS.md)) for the product catalog, with search/filter/sort, CSV/Excel export, and a CSV import wizard (preview → validation → completed summary).
- **Product Knowledge** — accessories and common problems attached per product, editable via a dedicated detail page.
- **Repository Provider architecture** — every page reads data through a typed repository interface, not hardcoded arrays, making later backend swaps low-risk (already proven once, below).
- **Firestore-backed Product Master (opt-in)** — when `VITE_BACKEND_KIND=firestore` is set, Product Master reads/writes a real, live Firebase project instead of mock data, validated end-to-end including CSV import and idempotent seeding. Every other feature above still runs on mock/in-memory data — this is real but partial backend coverage, not "the app has a backend" yet.

## Planned

Not yet built. Listed in roughly the order the current sprint trajectory (F-series) suggests, though nothing below is scheduled or approved beyond what's in [SPRINT_ROADMAP.md](SPRINT_ROADMAP.md):

- **Real backend coverage for everything else** — Customers, Service Jobs, Search, and Registered Products are still mock/in-memory; each becomes a Firestore-backed repository the same way Product Master did, one reviewed sprint at a time.
- **Auth & role-based access** — Firebase Auth is connected at the SDK level but nothing calls it; Admin/Staff/Customer are not yet distinguished anywhere in code.
- **Notifications** — automatic customer updates on status change, delivered to a customer's registered contact channel (SMS/LINE/email are the realistic channels for the Thai market; exact channel choice is a future decision, not yet made — the `customer_channel_contacts` entity already anticipates this).
- **Photo & attachment storage** — real uploads instead of sample stock photos, with internal-vs-customer visibility.
- **Quote & warranty approval flow** — customer approves/declines a repair quote before work proceeds.
- **Remaining printable documents** — Repair Report and Return Form (Service Request printing is already implemented — see Implemented above).
- **Thai-first localization & accessibility** — Thai UI copy, THB/DD-MM-YYYY/Asia-Bangkok formatting, B.E. dates, and an ARIA/keyboard pass are all still open (see [DECISIONS.md](DECISIONS.md) #003).
- **Technician workload view** — who's assigned what, to help staff balance the queue.
- **Customer service history** — repeat-customer view showing all of a customer's past service jobs across their product instances.
- **Product service history** — for a specific physical unit, a full repair timeline across every service job it's ever had.
- **Customer feedback** — a lightweight satisfaction check after a service job closes.

## Long-Term Direction

Version 1 is intentionally scoped to a single market: Thai-language UI, THB, Asia/Bangkok time, for two known brands. The architecture should stay **localization-ready** (no hardcoded English strings baked into logic, formatting centralized) so a second language or market could be added later — but full multilingual support, additional brands beyond the two named here, and integrations with external systems (POS, inventory, CRM) are explicitly **not committed** for V1. They're captured here as directional context, not as scoped work — see [DECISIONS.md](DECISIONS.md) for what has actually been decided versus what remains open.
