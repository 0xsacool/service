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
}
