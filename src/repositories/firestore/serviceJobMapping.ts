import { Timestamp, type DocumentData } from 'firebase/firestore';
import {
  isCanonicalBrandId,
  isChannelId,
  isOrderVerification,
  type BrandId,
  type ChannelId,
  type OrderVerification,
  type Priority,
  type ServiceJob,
  type ServiceJobStatus,
  type TimelineEvent,
} from '../../types';
import { isTrustworthyServiceJobClosedAt } from '../../services/serviceJobClosure';

// Collection name, mirroring PRODUCTS_COLLECTION / CUSTOMERS_COLLECTION's
// role in productMasterMapping.ts / customerMapping.ts (Sprint F4A, reusing
// the F2/F3 pattern).
export const SERVICE_JOBS_COLLECTION = 'serviceJobs';

// Firestore field contract for the 'serviceJobs' collection. Matches
// ServiceJob exactly — id becomes the document ID rather than a field, same
// as every other Firestore repository here. Unlike Product Master/Customers,
// createdAt/updatedAt/closedAt are NOT persistence-layer additions here —
// they're already real fields on ServiceJob (ISO date strings the UI
// formats and displays), so they're passed through as plain strings/null,
// never overwritten with Firestore serverTimestamp(). Optional fields
// (quote, accessories, serviceRequestNumber) become `| null` — Firestore
// rejects `undefined` field values outright, so `?? null` on write /
// `?? undefined` on read is the same pattern productMasterMapping.ts uses
// for `sku`. closedAt is already `| null` on ServiceJob itself (F5c — a
// real two-state field, not business-optional like the three above), so it
// needs no such undefined/null conversion at this boundary.
export interface ServiceJobFirestoreFields {
  brandId: BrandId;
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
  closedAt: string | null;
  technician: string;
  estimatedCompletion: string;
  warranty: boolean;
  photos: string[];
  timeline: TimelineEvent[];
  notes: { author: string; date: string; text: string }[];
  quote: number | null;
  accessories: string[] | null;
  serviceRequestNumber: string | null;
  publicTrackingTokenHash: string | null;
  publicTrackingCodeHash: string | null;
  // F5d-69 — already `T | null` on ServiceJob itself, so unlike quote/
  // accessories/serviceRequestNumber above these need no undefined/null
  // conversion at this boundary. Included in the update field list (below)
  // so a Worker-written value round-trips through an ordinary browser edit
  // instead of being silently dropped or reset.
  contactChannel: ChannelId | null;
  contactChannelIdentity: string | null;
  orderNumber: string | null;
  orderVerification: OrderVerification | null;
  purchaseDate: string | null;
  orderDeliveredDate: string | null;
  externalEvidenceUrl: string | null;
  externalEvidenceNote: string | null;
}

export type ServiceJobFirestoreUpdateFields = Omit<
  ServiceJobFirestoreFields,
  'brandId' | 'publicTrackingTokenHash' | 'publicTrackingCodeHash'
>;

function toCompatibleClosedAt(value: unknown): string | null {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }

  if (isTrustworthyServiceJobClosedAt(value)) {
    return value;
  }

  return null;
}

export function toFirestoreUpdateFields(
  entry: ServiceJob
): ServiceJobFirestoreUpdateFields {
  return {
    customerName: entry.customerName,
    customerPhone: entry.customerPhone,
    customerEmail: entry.customerEmail,
    product: entry.product,
    productCategory: entry.productCategory,
    serialNumber: entry.serialNumber,
    issue: entry.issue,
    description: entry.description,
    status: entry.status,
    priority: entry.priority,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    closedAt: entry.closedAt,
    technician: entry.technician,
    estimatedCompletion: entry.estimatedCompletion,
    warranty: entry.warranty,
    photos: entry.photos,
    timeline: entry.timeline,
    notes: entry.notes,
    quote: entry.quote ?? null,
    accessories: entry.accessories ?? null,
    serviceRequestNumber: entry.serviceRequestNumber ?? null,
    contactChannel: entry.contactChannel,
    contactChannelIdentity: entry.contactChannelIdentity,
    orderNumber: entry.orderNumber,
    orderVerification: entry.orderVerification,
    purchaseDate: entry.purchaseDate,
    orderDeliveredDate: entry.orderDeliveredDate,
    externalEvidenceUrl: entry.externalEvidenceUrl,
    externalEvidenceNote: entry.externalEvidenceNote,
  };
}

export function toFirestoreFields(entry: ServiceJob): ServiceJobFirestoreFields {
  if (!isCanonicalBrandId(entry.brandId)) {
    throw new Error(`Cannot write Service Job "${entry.id}" without a canonical brandId`);
  }

  return {
    brandId: entry.brandId,
    publicTrackingTokenHash: entry.publicTrackingTokenHash,
    publicTrackingCodeHash: entry.publicTrackingCodeHash,
    ...toFirestoreUpdateFields(entry),
  };
}

export function fromFirestoreData(id: string, data: DocumentData): ServiceJob {
  return {
    id,
    brandId: isCanonicalBrandId(data.brandId) ? data.brandId : null,
    customerName: data.customerName,
    customerPhone: data.customerPhone,
    customerEmail: data.customerEmail,
    product: data.product,
    productCategory: data.productCategory,
    serialNumber: data.serialNumber,
    issue: data.issue,
    description: data.description,
    status: data.status,
    priority: data.priority,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    closedAt: toCompatibleClosedAt(data.closedAt),
    technician: data.technician,
    estimatedCompletion: data.estimatedCompletion,
    warranty: data.warranty,
    photos: data.photos ?? [],
    timeline: data.timeline ?? [],
    notes: data.notes ?? [],
    quote: data.quote ?? undefined,
    accessories: data.accessories ?? undefined,
    serviceRequestNumber: data.serviceRequestNumber ?? undefined,
    publicTrackingTokenHash:
      typeof data.publicTrackingTokenHash === 'string'
        ? data.publicTrackingTokenHash
        : null,
    publicTrackingCodeHash:
      typeof data.publicTrackingCodeHash === 'string'
        ? data.publicTrackingCodeHash
        : null,
    // F5d-69 — a legacy document predating these fields reads back as null,
    // never undefined, so application code sees exactly two states. Values
    // are validated on write (Worker on create, Rules on update); an
    // unrecognized persisted channel degrades to 'other' rather than
    // producing an out-of-union value, matching the forward-compatibility
    // rule documented on ChannelId.
    contactChannel: isChannelId(data.contactChannel)
      ? data.contactChannel
      : data.contactChannel == null
        ? null
        : 'other',
    contactChannelIdentity:
      typeof data.contactChannelIdentity === 'string' ? data.contactChannelIdentity : null,
    orderNumber: typeof data.orderNumber === 'string' ? data.orderNumber : null,
    orderVerification: isOrderVerification(data.orderVerification)
      ? data.orderVerification
      : null,
    purchaseDate: typeof data.purchaseDate === 'string' ? data.purchaseDate : null,
    orderDeliveredDate:
      typeof data.orderDeliveredDate === 'string' ? data.orderDeliveredDate : null,
    externalEvidenceUrl:
      typeof data.externalEvidenceUrl === 'string' ? data.externalEvidenceUrl : null,
    externalEvidenceNote:
      typeof data.externalEvidenceNote === 'string' ? data.externalEvidenceNote : null,
  };
}
