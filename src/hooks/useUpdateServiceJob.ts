import type { ServiceJob } from '../types';
import type { BackendKind } from '../config/backend';
import type { ServiceJobsRepository } from '../repositories/types';
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
export async function persistServiceJobEdits(input: {
  id: string;
  edits: ServiceJobEdits;
  current: ServiceJob;
  backendKind: BackendKind | null;
  repository: ServiceJobsRepository;
}): Promise<ServiceJob> {
  if (input.edits.status !== 'Completed') {
    const patch = buildServiceJobUpdate(input.edits, input.current, input.backendKind);
    return await input.repository.update(input.id, patch);
  }

  const preCompletionEdits: ServiceJobEdits = { ...input.edits };
  delete preCompletionEdits.status;
  if (Object.keys(preCompletionEdits).length > 0) {
    const patch = buildServiceJobUpdate(
      preCompletionEdits,
      input.current,
      input.backendKind
    );
    await input.repository.update(input.id, patch);
  }

  return await input.repository.complete(input.id);
}

export function useUpdateServiceJob(): UseUpdateServiceJobResult {
  const updateServiceJob = async (
    id: string,
    edits: ServiceJobEdits
  ): Promise<ServiceJob> => {
    const current = repositories.serviceJobs.getById(id);
    if (!current) {
      throw new Error(`Cannot update service job "${id}": no such job exists`);
    }
    return await persistServiceJobEdits({
      id,
      edits,
      current,
      backendKind,
      repository: repositories.serviceJobs,
    });
  };

  return { updateServiceJob };
}
