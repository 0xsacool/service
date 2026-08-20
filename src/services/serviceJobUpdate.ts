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

// F5d-70 Phase 5B — every field here is optional: undefined means "pristine,
// not part of this save" (approved conflict policy — LOCAL LAST WRITE WINS,
// DIRTY FIELDS ONLY). The caller (ServiceJobDetails.tsx) computes dirtiness
// against the newest persisted claim and only ever supplies a key for a
// field/group the user actually changed. Present-with-null is a real edit
// (clearing an optional field); absent means "don't touch this".
export interface ServiceJobEdits {
  status?: ServiceJobStatus;
  technician?: string;
  notes?: ServiceJob['notes'];
  // contactChannel/contactChannelIdentity are one atomic group: either both
  // are supplied (the contact group is dirty) or neither is. Same for
  // orderNumber/orderVerification.
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
// anchor, and so a pristine (not-dirty) metadata group can still be resolved
// against its own real invariant inputs below — never against `null`
// defaults that would misrepresent an untouched group.
// F5d-70 Phase 5B — every field is now genuinely optional (dirty-only): the
// repository's own {...current, ...patch} merge (firestoreServiceJobRepository.ts
// update() / serviceJobsRepository.ts update()) already means an absent key
// leaves the freshest persisted value untouched, so building a sparse patch
// here is sufficient — no repository change was needed for this policy.
export function buildServiceJobUpdate(
  edits: ServiceJobEdits,
  current: ServiceJob,
  backendKind: BackendKind | null
): ServiceJobUpdate {
  // Each atomic group's dirty signal is still "the group's first field is
  // present" — but unlike before, a PRISTINE group is resolved from
  // `current`'s own real values (never a null default), so the invariant
  // function's output for the untouched group is a true no-op and is then
  // excluded from the returned patch entirely — it only ever appears in the
  // output when its own group was actually dirty.
  const contactGroupDirty = edits.contactChannel !== undefined;
  const orderGroupDirty = edits.orderNumber !== undefined;
  const resolvedMetadata = resolveServiceEventMetadataInvariants({
    contactChannel:
      edits.contactChannel !== undefined ? edits.contactChannel : current.contactChannel,
    contactChannelIdentity:
      edits.contactChannel !== undefined
        ? (edits.contactChannelIdentity ?? null)
        : current.contactChannelIdentity,
    orderNumber: edits.orderNumber !== undefined ? edits.orderNumber : current.orderNumber,
    orderVerification:
      edits.orderNumber !== undefined
        ? (edits.orderVerification ?? null)
        : current.orderVerification,
  });
  return {
    ...(edits.status !== undefined ? { status: edits.status } : {}),
    ...(edits.notes !== undefined ? { notes: edits.notes } : {}),
    ...(backendKind === 'mock' && edits.technician !== undefined
      ? { technician: edits.technician }
      : {}),
    ...(contactGroupDirty
      ? {
          contactChannel: resolvedMetadata.contactChannel,
          contactChannelIdentity: resolvedMetadata.contactChannelIdentity,
        }
      : {}),
    ...(orderGroupDirty
      ? {
          orderNumber: resolvedMetadata.orderNumber,
          orderVerification: resolvedMetadata.orderVerification,
        }
      : {}),
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
