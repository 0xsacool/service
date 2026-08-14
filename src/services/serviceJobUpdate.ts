import type { ServiceJob, ServiceJobStatus } from '../types';
import type { ServiceJobUpdate } from '../repositories/types';
import type { BackendKind } from '../config/backend';
import { toIsoDate } from '../utils/formatDate';

export interface ServiceJobEdits {
  status: ServiceJobStatus;
  technician?: string;
  notes: ServiceJob['notes'];
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
  return {
    status: edits.status,
    notes: edits.notes,
    ...(backendKind === 'mock' && edits.technician !== undefined
      ? { technician: edits.technician }
      : {}),
    updatedAt: toIsoDate(new Date()),
    closedAt: current.closedAt,
  };
}
