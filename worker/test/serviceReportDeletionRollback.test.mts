import { coordinateManualAttachmentDeletion, type DeletionObjectStore } from '../src/attachmentDeletionCoordinatorV2.ts';
import { ServiceReportV2Error } from '../src/serviceReportV2Contracts.ts';
import { attachmentMetadataDocId } from '../../src/services/attachmentIdentity.ts';
import type { CanonicalAttachmentKey } from '../../src/types/attachment.ts';
import {
  MemoryObjectStore,
  MemoryV2Store,
  SERVICE_JOB_ID,
  evidenceKey,
  putEvidence,
  seedServiceJob,
  seedStaffProfile,
} from './serviceReportV2StoreHarness.mts';

let failures = 0;
function check(name: string, value: boolean) {
  if (value) console.log(`  PASS  ${name}`);
  else {
    failures += 1;
    console.error(`  FAIL  ${name}`);
  }
}

console.log('Running Service Report attachment deletion rollback regression test');

const ADMIN_UID = 'deletion-admin-uid';
const KEY = evidenceKey('1') as CanonicalAttachmentKey;
const METADATA_ID = await attachmentMetadataDocId(KEY);
const NOW = '2027-01-02T00:00:00.000Z';
const IDEMPOTENCY_KEY = '11111111-1111-4111-8111-111111111111';

function seedAdmin(store: MemoryV2Store) {
  seedServiceJob(store);
  seedStaffProfile(store, ADMIN_UID, { role: 'admin', displayName: 'QA Admin' });
}

function deletionInput(
  store: MemoryV2Store,
  objects: DeletionObjectStore,
  idempotencyKey: string,
  attachmentMetadataDocId = METADATA_ID
) {
  return {
    store,
    objects,
    actor: { uid: ADMIN_UID },
    serviceJobId: SERVICE_JOB_ID,
    attachmentMetadataDocId,
    idempotencyKey,
    now: NOW,
  };
}

// A completed idempotent replay returns from inside the read transaction.
// It must close that transaction without another commit or object deletion.
{
  const store = new MemoryV2Store();
  const backingObjects = new MemoryObjectStore();
  seedAdmin(store);
  await putEvidence(store, backingObjects, KEY, { jobId: SERVICE_JOB_ID });
  const deleted: string[] = [];
  const objects: DeletionObjectStore = {
    async head(key) {
      return backingObjects.head(key);
    },
    async delete(key) {
      deleted.push(key);
      backingObjects.remove(key);
    },
  };

  const first = await coordinateManualAttachmentDeletion(
    deletionInput(store, objects, IDEMPOTENCY_KEY)
  );
  const commitsAfterFirst = store.committedWrites.length;
  const deletesAfterFirst = deleted.length;
  const rollbackAttemptsBeforeReplay = store.rollbackAttempts.length;
  const successfulRollbacksBeforeReplay = store.rolledBackTransactionIds.length;

  const replay = await coordinateManualAttachmentDeletion(
    deletionInput(store, objects, IDEMPOTENCY_KEY)
  );

  check(
    'completed manual deletion replay rolls back its read-only transaction without repeating effects',
    first.status === 'completed' &&
      replay.status === 'completed' &&
      store.committedWrites.length === commitsAfterFirst &&
      deleted.length === deletesAfterFirst &&
      store.rollbackAttempts.length === rollbackAttemptsBeforeReplay + 1 &&
      store.rolledBackTransactionIds.length === successfulRollbacksBeforeReplay + 1
  );
}

// A validation failure must still be returned when the best-effort rollback fails.
{
  const store = new MemoryV2Store();
  seedAdmin(store);
  store.rollbackFailure = new Error('synthetic rollback failure');

  let failure: unknown;
  try {
    await coordinateManualAttachmentDeletion(
      deletionInput(store, {
        async head() {
          return null;
        },
        async delete() {},
      }, '22222222-2222-4222-8222-222222222222')
    );
  } catch (error) {
    failure = error;
  }

  check(
    'missing attachment remains a 404 when rollback itself fails',
    failure instanceof ServiceReportV2Error &&
      failure.status === 404 &&
      store.rollbackAttempts.length === 1 &&
      store.committedWrites.length === 0
  );
}

if (failures) process.exitCode = 1;
