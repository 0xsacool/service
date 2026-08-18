export type ServiceJobStatus =
  | 'Received'
  | 'Diagnosing'
  | 'Awaiting Parts'
  | 'In Repair'
  | 'Quality Check'
  | 'Ready for Pickup'
  | 'Completed'
  | 'Cancelled'
  | 'Rejected';

import type { BrandId } from './brand';

export type Priority = 'Low' | 'Normal' | 'High' | 'Urgent';

// F5d-69 / DECISIONS.md #041 — the seven approved V1 contact channels. The
// union is deliberately exactly the visible V1 set (no tiktok_shop/facebook):
// production has never stored a channel value, so there is nothing to stay
// backward-compatible with. Adding a channel later is a union + UI-list edit
// with no migration, because every reader maps an unrecognized persisted
// value to 'other' rather than failing — matching DATABASE_SCHEMA.md's
// "validated at the application layer, not a rigid DB enum" intent.
export const CHANNEL_IDS = [
  'shopee',
  'lazada',
  'line',
  'store',
  'website',
  'phone',
  'other',
] as const;
export type ChannelId = (typeof CHANNEL_IDS)[number];

export function isChannelId(value: unknown): value is ChannelId {
  return typeof value === 'string' && (CHANNEL_IDS as readonly string[]).includes(value);
}

export const ORDER_VERIFICATIONS = ['unverified', 'verified', 'not_found'] as const;
export type OrderVerification = (typeof ORDER_VERIFICATIONS)[number];

export function isOrderVerification(value: unknown): value is OrderVerification {
  return (
    typeof value === 'string' && (ORDER_VERIFICATIONS as readonly string[]).includes(value)
  );
}

export interface TimelineEvent {
  status: ServiceJobStatus;
  title: string;
  description: string;
  date: string; // ISO date
  time: string;
  done: boolean;
  current?: boolean;
}

export interface ServiceJob {
  id: string; // e.g. SRV-2026-0481
  brandId: BrandId | null;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  product: string;
  productCategory: string;
  serialNumber: string;
  issue: string;
  description: string;
  status: ServiceJobStatus;
  priority: Priority;
  createdAt: string;
  updatedAt: string;
  technician: string;
  estimatedCompletion: string;
  warranty: boolean;
  photos: string[];
  timeline: TimelineEvent[];
  notes: { author: string; date: string; text: string }[];
  quote?: number;
  accessories?: string[];
  // SR-{YYYY}-{SEQUENCE} — the Service Request document number (DECISIONS.md
  // #014), distinct from the tracking number. Optional because the 7 seed
  // records predate this field; every job created via Sprint 4's intake
  // flow always sets it.
  serviceRequestNumber?: string;
  // F5c (file-retention prerequisite) — the real ISO 8601 date/time the job
  // entered a terminal status (Completed/Cancelled/Rejected), not to be
  // confused with updatedAt (bumped on every save regardless of status).
  // Deliberately `string | null` rather than optional/undefined like
  // quote/accessories above: those are "may not exist yet" business
  // optionality, this is a genuine two-state field (not yet closed vs.
  // closed) every ServiceJob always has an explicit value for — see
  // services/serviceJobUpdate.ts for how it's set and why it's sticky once
  // non-null.
  closedAt: string | null;
  // A public-tracking capability is always stored as a one-way SHA-256 hash.
  // Normal browser writes never rotate or revoke this field.
  publicTrackingTokenHash: string | null;
  // PUB-TRACK-1 — the manual public credential is stored only as a SHA-256
  // hash. The raw code is issued once by a trusted boundary and is never a
  // normal Service Job update field.
  publicTrackingCodeHash: string | null;
  // F5d-69 / DECISIONS.md #041 — contact/order/external-evidence metadata for
  // THIS service event. These are an authoritative *event snapshot*, not a
  // customer record: they are staff-correctable on this Service Job (typo, or
  // the wrong channel recorded at intake) but are NEVER automatically
  // synchronized from a customer document or from another Service Job, so a
  // customer later changing their marketplace username can never silently
  // rewrite historical jobs. A customer's channel history is a derived read
  // model computed from these snapshots; no canonical customer-level channel
  // store exists in Firestore (#013 is only partially implemented).
  //
  // All eight are `T | null` two-state fields, deliberately not optional —
  // same rationale as closedAt above. A legacy document missing them reads
  // back as null, so application code never sees `undefined`.
  contactChannel: ChannelId | null;
  contactChannelIdentity: string | null;
  orderNumber: string | null;
  orderVerification: OrderVerification | null;
  // Calendar dates in the project's existing YYYY-MM-DD convention
  // (services/bangkokTime.ts's bangkokIsoDate). orderDeliveredDate is
  // deliberately NOT named receivedDate: `createdAt` is already printed as
  // "วันที่รับสินค้า" (the date the service center received the unit), a
  // genuinely different event from the marketplace delivering the order.
  purchaseDate: string | null;
  orderDeliveredDate: string | null;
  // Optional HTTPS link to evidence hosted elsewhere (Drive/Photos/OneDrive).
  // Stored as text only — no backend ever fetches it, and it is never
  // rendered as HTML.
  externalEvidenceUrl: string | null;
  externalEvidenceNote: string | null;
}
