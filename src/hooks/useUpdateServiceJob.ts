import type { ServiceJob } from '../types';
import { repositories } from '../repositories/repositoryProvider';
import {
  buildServiceJobUpdate,
  type ServiceJobEdits,
} from '../services/serviceJobUpdate';
import { backendKind } from '../config/backend';

export interface UseUpdateServiceJobResult {
  updateServiceJob: (id: string, edits: ServiceJobEdits) => Promise<ServiceJob>;
}

// The Save Changes counterpart to useCreateServiceJob — keeps business
// logic (buildServiceJobUpdate) and persistence (repositories.serviceJobs)
// both behind the hook seam, matching every other data-access hook here.
// F5c: fetches the current record first (rather than trusting a possibly-
// stale object a caller already has in hand) so buildServiceJobUpdate's
// closedAt decision is always based on the real last-persisted value —
// this also means ServiceJobDetails.tsx's call site needed no changes at
// all to gain closedAt handling.
export function useUpdateServiceJob(): UseUpdateServiceJobResult {
  const updateServiceJob = async (
    id: string,
    edits: ServiceJobEdits
  ): Promise<ServiceJob> => {
    const current = repositories.serviceJobs.getById(id);
    if (!current) {
      throw new Error(`Cannot update service job "${id}": no such job exists`);
    }
    const patch = buildServiceJobUpdate(edits, current, backendKind);
    return await repositories.serviceJobs.update(id, patch);
  };

  return { updateServiceJob };
}
