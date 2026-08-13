import type { ServiceJob } from '../types';
import { useRef } from 'react';
import { repositories } from '../repositories/repositoryProvider';
import {
  buildNewDurableServiceJob,
  buildServiceJobIntakePayload,
  performServiceJobCreate,
  type NewServiceJobInput,
} from '../services/serviceJobCreation';
import { backendKind } from '../config/backend';
import { assertFirestoreWorkerCreatePath } from '../config/runtimeDiagnostics';
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
    // F5d-54, Objective 3 / F5d-54B: assertFirestoreWorkerCreatePath() is
    // shared, single-source-of-truth readiness evaluation — the
    // [Create Path] log below and the RuntimeModeIndicator badge are
    // observability only. performServiceJobCreate() below is the actual
    // enforced fail-closed boundary: it is the only thing that decides
    // whether createViaFirestore (and everything inside it — idempotency
    // key generation, the repository call, the Worker fetch) ever runs.
    const assertion = assertFirestoreWorkerCreatePath();
    if (import.meta.env.DEV) {
      console.info(
        `[Create Path] ${assertion.path}${assertion.ok ? '' : ` — NOT a verified Worker path (${assertion.reasons.join('; ')})`}`
      );
    }
    return await performServiceJobCreate(backendKind, assertion, {
      createViaMock: () =>
        repositories.serviceJobs.create(buildNewDurableServiceJob({ ...input, brandId })),
      createViaFirestore: async () => {
        attemptKey.current ??= crypto.randomUUID();
        const created = await repositories.serviceJobs.create({
          idempotencyKey: attemptKey.current,
          intake: buildServiceJobIntakePayload(input),
        });
        attemptKey.current = null;
        return created;
      },
    });
  };

  return { createServiceJob };
}
