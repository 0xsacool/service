import type {
  ChannelId,
  OrderVerification,
  ServiceJob,
  ServiceJobStatus,
} from '../types';
import type { ServiceJobUpdate } from '../repositories/types';
import type { BackendKind } from '../config/backend';
import { toIsoDate } from '../utils/formatDate';
import { resolveServiceEventMetadataInvariants } from './serviceEventMetadataInvariants';

export interface ServiceJobEdits {
  status: ServiceJobStatus;
  technician?: string;
  notes: ServiceJob['notes'];
  // F5d-69 — optional: undefined means "Service Job Details did not render
  // an edit for this field at all" (never happens today — the metadata
  // section always supplies all eight together — but keeps this interface
  // honest about what a future partial caller could send). Present-but-
  // undefined and present-with-null are deliberately different from the
  // caller's perspective; buildServiceJobUpdate below only includes a key
  // in the resulting patch when the metadata block itself was supplied.
  contactChannel?: ChannelId | null;
  contactChannelIdentity?: string | null;
  orderNumber?: string | null;
  orderVerification?: OrderVerification | null;
  purchaseDate?: string | null;
  orderDeliveredDate?: string | null;
  externalEvidenceUrl?: string | null;
  externalEvidenceNote?: string | null;
}

// Assembles the Partial<ServiceJob> patch for a Save Changes commit — the
// one place "what changed" maps to a repository patch, so
// ServiceJobDetails.tsx doesn't have to know that saving also means
// bumping updatedAt or deciding closedAt (mirrors buildServiceJob's role
// for the create path in serviceJobCreation.ts). Only the fields the
// existing UI actually lets a staff member edit — status and notes, plus
// technician only in Mock mode — are included as direct edits; timeline is
// deliberately left out of the patch so it passes through the repository's
// merge untouched.
// `current` is required so the caller cannot overwrite the durable closure
// anchor. The Firestore repository assigns it from the server clock only on
// the first non-terminal-to-terminal transition.
export function buildServiceJobUpdate(
  edits: ServiceJobEdits,
  current: ServiceJob,
  backendKind: BackendKind | null
): ServiceJobUpdate {
  // F5d-69 — the metadata section on Service Job Details always supplies
  // all eight fields together (defaulting each to `current`'s own value
  // for whatever the staff member didn't touch), so `contactChannel` being
  // present is the one signal needed to know the whole block was supplied.
  // Resolved through the same shared invariant function the intake payload
  // uses, so a client-side bug can never send a state Rules would refuse
  // anyway — Rules remain the actual enforcement boundary.
  const metadata =
    edits.contactChannel !== undefined
      ? resolveServiceEventMetadataInvariants({
          contactChannel: edits.contactChannel,
          contactChannelIdentity: edits.contactChannelIdentity ?? null,
          orderNumber: edits.orderNumber ?? null,
          orderVerification: edits.orderVerification ?? null,
        })
      : {};
  return {
    status: edits.status,
    notes: edits.notes,
    ...(backendKind === 'mock' && edits.technician !== undefined
      ? { technician: edits.technician }
      : {}),
    ...metadata,
    ...(edits.purchaseDate !== undefined ? { purchaseDate: edits.purchaseDate } : {}),
    ...(edits.orderDeliveredDate !== undefined
      ? { orderDeliveredDate: edits.orderDeliveredDate }
      : {}),
    ...(edits.externalEvidenceUrl !== undefined
      ? { externalEvidenceUrl: edits.externalEvidenceUrl }
      : {}),
    ...(edits.externalEvidenceNote !== undefined
      ? { externalEvidenceNote: edits.externalEvidenceNote }
      : {}),
    updatedAt: toIsoDate(new Date()),
    closedAt: current.closedAt,
  };
}
