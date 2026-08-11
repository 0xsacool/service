import type { ServiceJob } from '../types';
import { useRef } from 'react';
import { repositories } from '../repositories/repositoryProvider';
import {
  buildNewDurableServiceJob,
  buildServiceJobIntakePayload,
  type NewServiceJobInput,
} from '../services/serviceJobCreation';
import { backendKind } from '../config/backend';
import { resolveNewServiceJobBrandId } from '../services/serviceJobBrandContext';
import { getAuthorizedBrandId } from '../auth/authSession';
import { useAuthSession } from '../auth/authSessionContext';

type CreateServiceJobInput = Omit<NewServiceJobInput, 'brandId'>;

export interface UseCreateServiceJobResult {
  createServiceJob: (input: CreateServiceJobInput) => Promise<ServiceJob>;
}

// The only path a component should use to create a Service Job — keeps
// business logic (buildServiceJob) and persistence (repositories.serviceJobs)
// both behind the hook seam, matching every other data-access hook here.
export function useCreateServiceJob(): UseCreateServiceJobResult {
  const session = useAuthSession();
  const attemptKey = useRef<string | null>(null);

  const createServiceJob = async (input: CreateServiceJobInput): Promise<ServiceJob> => {
    const brandId = getAuthorizedBrandId(session) ?? resolveNewServiceJobBrandId();
    if (!brandId) {
      throw new Error('Staff authorization is required to create a durable Service Job');
    }
    if (backendKind === 'mock') {
      return await repositories.serviceJobs.create(
        buildNewDurableServiceJob({ ...input, brandId })
      );
    }
    attemptKey.current ??= crypto.randomUUID();
    const created = await repositories.serviceJobs.create({
      idempotencyKey: attemptKey.current,
      intake: buildServiceJobIntakePayload(input),
    });
    attemptKey.current = null;
    return created;
  };

  return { createServiceJob };
}
