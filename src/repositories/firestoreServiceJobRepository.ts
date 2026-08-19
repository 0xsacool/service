import {
  collection,
  doc,
  getDocFromServer,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { getFirestoreDb } from '../lib/firebase/firebase';
import type { BrandId, ServiceJob } from '../types';
import type {
  ServiceJobCreateInput,
  ServiceJobIntakeAttempt,
  ServiceJobsRepository,
} from './types';
import type { WorkerTokenProvider } from '../auth/workerTokenProvider';
import { fetchWithWorkerToken } from '../auth/workerTokenProvider';
import {
  fromFirestoreData,
  SERVICE_JOBS_COLLECTION,
  toFirestoreUpdateFields,
} from './firestore/serviceJobMapping';
import { needsTrustedClosedAt } from '../services/serviceJobClosure';
import { bumpDataVersion } from './dataVersion';
import {
  describeFirestoreInitError,
  recordFirestoreInitFailure,
} from './firestoreInitDiagnostics';
import { getFilesWorkerBaseUrl } from '../config/workerUrl';
import { PublicTrackingIssuanceError } from './types';

function isIntakeAttempt(value: ServiceJobCreateInput): value is ServiceJobIntakeAttempt {
  return 'idempotencyKey' in value && 'intake' in value;
}

export async function commitServiceJobMutation<T>(
  commit: () => Promise<T>,
  updateCache: (committed: T) => void
): Promise<T> {
  const committed = await commit();
  updateCache(committed);
  return committed;
}

// Same synchronous-facade-over-async-backend design as
// firestoreProductMasterRepository.ts / firestoreCustomersRepository.ts
// (DECISIONS.md #018) — ServiceJobsRepository's methods are all synchronous,
// so this factory awaits the first server-confirmed Firestore snapshot
// before resolving, then every call reads a live local cache kept current
// by onSnapshot.
//
// Service Job mutations deliberately differ from Product Master’s
// optimistic-write contract. A closure is a retention anchor, so callers do
// not receive a successful result until Firestore has committed and returned
// the authoritative document.
// getById/getByTrackingNumber both match on cache key, same as the Mock
// implementation's comment notes: in the current model, a service job's id
// and its tracking number are the same value.
export async function createFirestoreServiceJobRepository(
  brandId: BrandId,
  tokenProvider: WorkerTokenProvider
): Promise<ServiceJobsRepository> {
  const firestore = getFirestoreDb();
  let jobsById = new Map<string, ServiceJob>();

  // Seed before listening — same ordering rationale as Product Master/
  // Customers (DECISIONS.md #018): if the listener attached first, its
  // first server-confirmed snapshot could land on a genuinely-empty
  // collection moments before the seed's write commits.
  // Captured rather than discarded, same as the Product Master/Customers
  // repositories — no active teardown path exists yet; see DECISIONS.md
  // #018 for why that's fine for a session-scoped singleton.
  let unsubscribe: Unsubscribe | undefined;

  await new Promise<void>((resolveFirstSnapshot) => {
    let settled = false;
    unsubscribe = onSnapshot(
      query(
        collection(firestore, SERVICE_JOBS_COLLECTION),
        where('brandId', '==', brandId)
      ),
      (snapshot) => {
        const next = new Map<string, ServiceJob>();
        snapshot.forEach((docSnap) => {
          next.set(docSnap.id, fromFirestoreData(docSnap.id, docSnap.data()));
        });
        jobsById = next;
        // F5d-49B: signals any external-store subscriber (Universal Search)
        // that fresh data has landed, independent of the first-snapshot
        // resolve below — this fires on every subsequent snapshot too.
        bumpDataVersion();
        // Only resolve on a server-confirmed snapshot, not Firestore's
        // possibly-stale first cached event — confirmed live for Product
        // Master/Customers (DECISIONS.md #018) that resolving early leaves
        // reads permanently wrong for the repository's lifetime.
        if (!settled && !snapshot.metadata.fromCache) {
          settled = true;
          resolveFirstSnapshot();
        }
      },
      (err) => {
        console.error('[firestoreServiceJobRepository] snapshot listener failed:', err);
        recordFirestoreInitFailure(
          describeFirestoreInitError(
            err,
            'serviceJobs',
            settled ? 'listener' : 'initial-listener'
          )
        );
        if (!settled) {
          settled = true;
          resolveFirstSnapshot();
        }
      }
    );
  });
  void unsubscribe; // captured, not called — no teardown path exists yet

  return {
    getAll() {
      return Array.from(jobsById.values());
    },
    getById(id) {
      return jobsById.get(id);
    },
    getByTrackingNumber(trackingNumber) {
      return jobsById.get(trackingNumber);
    },
    async create(job) {
      if (!isIntakeAttempt(job)) {
        throw new Error(
          'Firestore Service Job creation requires a Worker intake attempt'
        );
      }
      return await commitServiceJobMutation(
        async () => {
          const response = await fetchWithWorkerToken(
            tokenProvider,
            `${getFilesWorkerBaseUrl()}/service-jobs`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Idempotency-Key': job.idempotencyKey,
              },
              body: JSON.stringify({ intake: job.intake, customer: job.customer }),
            }
          );
          if (!response.ok)
            throw new Error(`Worker Service Job creation failed (${response.status})`);
          const body: unknown = await response.json();
          if (!body || typeof body !== 'object' || !('job' in body))
            throw new Error('Worker returned malformed Service Job');
          const created = body.job;
          if (
            !created ||
            typeof created !== 'object' ||
            !('id' in created) ||
            typeof created.id !== 'string'
          )
            throw new Error('Worker returned malformed Service Job');
          return created as ServiceJob;
        },
        (created) => jobsById.set(created.id, created)
      );
    },
    async update(id, patch) {
      if (
        Object.prototype.hasOwnProperty.call(patch, 'brandId') ||
        Object.prototype.hasOwnProperty.call(patch, 'publicTrackingTokenHash') ||
        Object.prototype.hasOwnProperty.call(patch, 'publicTrackingCodeHash')
      ) {
        throw new Error(
          'Cannot change Service Job ownership or public tracking capability'
        );
      }

      return await commitServiceJobMutation(
        async () => {
          const reference = doc(firestore, SERVICE_JOBS_COLLECTION, id);

          await runTransaction(firestore, async (transaction) => {
            const currentSnapshot = await transaction.get(reference);
            if (!currentSnapshot.exists()) {
              throw new Error(`Cannot update service job "${id}": no such job exists`);
            }

            const current = fromFirestoreData(currentSnapshot.id, currentSnapshot.data());
            const updated = { ...current, ...patch };
            const { closedAt, ...fields } = toFirestoreUpdateFields(updated);
            void closedAt;
            const rawClosedAt = currentSnapshot.data().closedAt;
            const firstTerminalTransition = needsTrustedClosedAt(
              current.status,
              rawClosedAt,
              updated.status
            );

            transaction.update(reference, {
              ...fields,
              ...(firstTerminalTransition ? { closedAt: serverTimestamp() } : {}),
            });
          });

          const committed = await getDocFromServer(reference);
          if (!committed.exists()) {
            throw new Error(`Firestore did not return updated Service Job "${id}"`);
          }
          return fromFirestoreData(committed.id, committed.data());
        },
        (updated) => jobsById.set(updated.id, updated)
      );
    },

    // F5d-69G — staff-triggered issue/rotate. Worker-mediated: Firestore
    // Rules already deny an ordinary browser update from touching
    // publicTrackingCodeHash (see firestore.rules), so this is the only
    // path that can ever set it. The raw code is returned to the caller
    // exactly once and is never persisted or re-derivable afterward
    // (DECISIONS.md #041's one-way-hash property) — this method does not
    // cache it. The returned `job` is a fresh server read (not the Worker's
    // response, which never echoes the hash back) so the local cache
    // reflects the real persisted publicTrackingCodeHash immediately,
        // without waiting on the onSnapshot listener's next event.
    async issuePublicTrackingCode(id) {
      let response: Response;
      try {
        response = await fetchWithWorkerToken(
          tokenProvider,
          `${getFilesWorkerBaseUrl()}/service-jobs/${encodeURIComponent(id)}/public-tracking-code`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
        );
      } catch {
        // No status at all — the request may or may not have reached the
        // Worker and committed. Deliberately ambiguous; never auto-retried.
        throw new PublicTrackingIssuanceError(
          'Public tracking code issuance could not be confirmed',
          null
        );
      }
      if (!response.ok) {
        const errorBody: unknown = await response.json().catch(() => null);
        const message =
          errorBody &&
          typeof errorBody === 'object' &&
          'error' in errorBody &&
          typeof errorBody.error === 'string'
            ? errorBody.error
            : `Worker public tracking code issuance failed (${response.status})`;
        throw new PublicTrackingIssuanceError(message, response.status);
      }
      const body: unknown = await response.json();
      if (!body || typeof body !== 'object' || !('code' in body) || typeof body.code !== 'string') {
        // A 2xx whose body could not be read/parsed: the commit almost
        // certainly succeeded, so this is ambiguous, not a clean failure.
        throw new PublicTrackingIssuanceError(
          'Worker returned a malformed public tracking code response',
          null
        );
      }
      const reference = doc(firestore, SERVICE_JOBS_COLLECTION, id);
      const committed = await getDocFromServer(reference);
      if (!committed.exists()) {
        throw new Error(`Firestore did not return Service Job "${id}" after issuance`);
      }
      const job = fromFirestoreData(committed.id, committed.data());
      jobsById.set(job.id, job);
      return { code: body.code, job };
    },
  };
}
