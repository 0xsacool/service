import { createWorkerHandler, type WorkerDependencies } from '../src/index.ts';
import type { Env } from '../src/env.ts';
import type { FirestoreClient } from '../src/firestoreClient.ts';
import type { ServiceJob } from '../../src/types/serviceJob.ts';
import { serviceReportV2Mode } from '../src/serviceReportV2Routes.ts';
import {
  assertCanonicalAttachmentKey,
  attachmentMetadataDocId,
} from '../../src/services/attachmentIdentity.ts';
import { MemoryV2Store } from './serviceReportV2StoreHarness.mts';

let failures = 0;
function check(name: string, value: boolean): void {
  if (value) console.log(`  PASS  ${name}`);
  else {
    failures += 1;
    console.error(`  FAIL  ${name}`);
  }
}

function serviceJob(id: string): ServiceJob {
  return {
    id,
    serviceRequestNumber: 'SR-2026-000001',
    brandId: 'bruno-thailand',
    customerName: 'QA Customer',
    customerPhone: '0000000000',
    customerEmail: '',
    product: 'QA Product',
    productCategory: 'Other',
    serialNumber: 'SERIAL-1',
    issue: 'Reported issue',
    description: 'Description',
    status: 'Received',
    priority: 'Normal',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    technician: 'QA Technician',
    estimatedCompletion: '—',
    warranty: false,
    photos: [],
    accessories: [],
    timeline: [],
    notes: [],
    closedAt: null,
    publicTrackingTokenHash: null,
    publicTrackingCodeHash: null,
  };
}

function createHandler(mode: Env['SERVICE_REPORT_V2_MODE'], store: MemoryV2Store) {
  const dependencies: WorkerDependencies = {
    tokenVerifier: { async verify() { return { uid: 'staff-uid-1' }; } },
    createFirestoreClient: () => ({} as unknown as FirestoreClient),
    createServiceReportV2Store: () => store,
  };
  const env: Env = {
    ATTACHMENTS_BUCKET: {} as R2Bucket,
    ALLOWED_ORIGINS: 'http://localhost:5173',
    FIRESTORE_PROJECT_ID: 'test-project',
    SERVICE_REPORT_V2_MODE: mode,
  };
  return { handler: createWorkerHandler(dependencies), env };
}

function fixture(reportingRole: 'technician' | 'approver' = 'approver') {
  const store = new MemoryV2Store();
  const jobId = 'BRN-2026-000021';
  store.set('serviceJobs', jobId, { ...serviceJob(jobId) });
  store.set('staffProfiles', 'staff-uid-1', {
    brandId: 'bruno-thailand',
    role: reportingRole,
    displayName: 'QA Staff',
  });
  store.set('brandApprovalPolicies', 'bruno-thailand', {
    schemaVersion: 1,
    brandId: 'bruno-thailand',
    allowSelfApproval: true,
    policyVersion: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedByUid: 'admin-uid',
  });
  return { store, jobId };
}

const auth = {
  Authorization: 'Bearer valid-token',
  'Content-Type': 'application/json',
};
const content = {
  technician: 'QA Staff',
  customerReportedProblem: 'Reported issue',
  inspectionFindings: 'Fault reproduced',
  serviceActions: ['repair'],
  parts: [],
  technicianRemark: '',
  resultStatus: 'repaired',
  resultDetail: '',
  evidenceAttachmentIds: [],
  claimNo: null,
  factoryReference: null,
  warrantyOutcome: 'undetermined',
};

async function runV2Lifecycle(
  mode: 'compatibility' | 'v2-active',
  suffix: string,
  decision: 'approved' | 'rejected'
): Promise<void> {
  const { store, jobId } = fixture();
  const { handler, env } = createHandler(mode, store);
  const base = `http://worker.test/service-jobs/${jobId}/service-reports`;
  const key = (tail: string) => `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb${suffix}${tail}`;
  const create = await handler.fetch(new Request(base, {
    method: 'POST',
    headers: { ...auth, 'Idempotency-Key': key('1') },
    body: JSON.stringify({ contractVersion: 2, content }),
  }), env);
  const createBody = await create.json() as {
    data: { report: { id: string; contentRevision: number } };
  };
  check(`${mode} routes explicit V2 create`, create.status === 201 && createBody.data.report.contentRevision === 0);
  const reportId = createBody.data.report.id;
  const reportPath = `${base}/${reportId}`;
  const saveBody = {
    contractVersion: 2,
    expectedContentRevision: 0,
    patch: { technicianRemark: 'Saved through Worker' },
  };
  const saveRequest = () => new Request(`${reportPath}/draft-save`, {
    method: 'POST',
    headers: { ...auth, 'Idempotency-Key': key('2') },
    body: JSON.stringify(saveBody),
  });
  const save = await handler.fetch(saveRequest(), env);
  const saved = await save.json() as {
    replayed: boolean;
    data: { report: { contentRevision: number; technicianRemark: string } };
  };
  check(`${mode} routes V2 save with compare-and-set revision`,
    save.status === 200 && saved.data.report.contentRevision === 1 &&
    saved.data.report.technicianRemark === 'Saved through Worker');
  const writesAfterSave = store.committedWrites.length;
  const rollbackAttemptsBeforeReplay = store.rollbackAttempts.length;
  const successfulRollbacksBeforeReplay = store.rolledBackTransactionIds.length;
  const replay = await handler.fetch(saveRequest(), env);
  const replayBody = await replay.json() as { replayed: boolean };
  check(`${mode} V2 save replays the same idempotency key and closes its read-only transaction`,
    replay.status === 200 && replayBody.replayed && store.committedWrites.length === writesAfterSave &&
    store.rollbackAttempts.length === rollbackAttemptsBeforeReplay + 1 &&
    store.rolledBackTransactionIds.length === successfulRollbacksBeforeReplay + 1);

  const deniedReplayHasNoReport = async (label: string) => {
    const response = await handler.fetch(saveRequest(), env);
    const body = await response.json() as { data?: { report?: unknown }; report?: unknown };
    check(label, response.status === 403 && body.data?.report === undefined &&
      body.report === undefined && store.committedWrites.length === writesAfterSave);
  };
  store.set('staffProfiles', 'staff-uid-1', {
    brandId: 'bruno-thailand', role: 'customer', displayName: 'QA Staff',
  });
  await deniedReplayHasNoReport(`${mode} denies same-key V2 replay after staff role removal`);
  store.set('staffProfiles', 'staff-uid-1', {
    brandId: 'join-lux-club', role: 'approver', displayName: 'QA Staff',
  });
  await deniedReplayHasNoReport(`${mode} denies same-key V2 replay after brand authorization changes`);
  store.set('staffProfiles', 'staff-uid-1', {
    brandId: 'invalid-brand', role: 'approver', displayName: 'QA Staff',
  });
  await deniedReplayHasNoReport(`${mode} denies same-key V2 replay with a malformed profile`);
  store.set('staffProfiles', 'staff-uid-1', {
    brandId: 'bruno-thailand', role: 'approver', displayName: 'QA Staff',
  });

  const conflict = await handler.fetch(new Request(`${reportPath}/draft-save`, {
    method: 'POST',
    headers: { ...auth, 'Idempotency-Key': key('2') },
    body: JSON.stringify({ ...saveBody, patch: { technicianRemark: 'Different payload' } }),
  }), env);
  check(`${mode} rejects a reused V2 save key with a conflicting body`, conflict.status === 409);

  const rollbackAttemptsBeforeStale = store.rollbackAttempts.length;
  store.rollbackFailure = new Error('synthetic rollback failure');
  const stale = await handler.fetch(new Request(`${reportPath}/draft-save`, {
    method: 'POST',
    headers: { ...auth, 'Idempotency-Key': key('3') },
    body: JSON.stringify({ ...saveBody, patch: { technicianRemark: 'Stale revision' } }),
  }), env);
  store.rollbackFailure = null;
  check(`${mode} rejects stale revision, attempts rollback, and preserves the original denial`,
    stale.status === 412 && store.committedWrites.length === writesAfterSave &&
    store.rollbackAttempts.length === rollbackAttemptsBeforeStale + 1);

  const finalize = await handler.fetch(new Request(`${reportPath}/finalize`, {
    method: 'POST',
    headers: { ...auth, 'Idempotency-Key': key('4') },
    body: JSON.stringify({ contractVersion: 2, expectedContentRevision: 1 }),
  }), env);
  const finalized = await finalize.json() as {
    data: { report: { status: string; approvalState: string; finalContentDigest: string } };
  };
  check(`${mode} V2 finalize remains pending approval, not an approval decision`,
    finalize.status === 200 && finalized.data.report.status === 'final' &&
    finalized.data.report.approvalState === 'pending');

  store.set('staffProfiles', 'staff-uid-1', {
    brandId: 'bruno-thailand', role: 'technician', displayName: 'QA Staff',
  });
  const technicianDecision = await handler.fetch(new Request(`${reportPath}/approval-decision`, {
    method: 'POST',
    headers: { ...auth, 'Idempotency-Key': key('5') },
    body: JSON.stringify({
      contractVersion: 2, decision, rejectionReason: decision === 'rejected' ? 'Needs correction' : null,
      expectedFinalDigest: finalized.data.report.finalContentDigest,
    }),
  }), env);
  check(`${mode} still denies a technician approval decision`, technicianDecision.status === 403);
  store.set('staffProfiles', 'staff-uid-1', {
    brandId: 'bruno-thailand', role: 'approver', displayName: 'QA Staff',
  });

  const staleDigest = await handler.fetch(new Request(`${reportPath}/approval-decision`, {
    method: 'POST',
    headers: { ...auth, 'Idempotency-Key': key('6') },
    body: JSON.stringify({
      contractVersion: 2, decision, rejectionReason: decision === 'rejected' ? 'Needs correction' : null,
      expectedFinalDigest: `sha256:v1:${'0'.repeat(64)}`,
    }),
  }), env);
  check(`${mode} rejects a stale V2 approval digest`, staleDigest.status === 412);

  const decided = await handler.fetch(new Request(`${reportPath}/approval-decision`, {
    method: 'POST',
    headers: { ...auth, 'Idempotency-Key': key('7') },
    body: JSON.stringify({
      contractVersion: 2, decision, rejectionReason: decision === 'rejected' ? 'Needs correction' : null,
      expectedFinalDigest: finalized.data.report.finalContentDigest,
    }),
  }), env);
  check(`${mode} routes V2 ${decision} through the existing decision operation`, decided.status === 201);
}

console.log('Running Service Report mode/write-contract bridge regression test');

// Missing and unknown mode values remain the V1-only fail-closed mode.
{
  const env: Env = {
    ATTACHMENTS_BUCKET: {} as R2Bucket,
    ALLOWED_ORIGINS: 'http://localhost:5173',
    FIRESTORE_PROJECT_ID: 'test-project',
  };
  check('an omitted mode resolves to disabled', serviceReportV2Mode(env) === 'disabled');
  Reflect.set(env, 'SERVICE_REPORT_V2_MODE', 'unknown');
  check('an unknown mode resolves to disabled', serviceReportV2Mode(env) === 'disabled');
}

// Disabled mode rejects V2 mutation contracts, including the new save route.
{
  const store = new MemoryV2Store();
  const { handler, env } = createHandler('disabled', store);
  const base = 'http://worker.test/service-jobs/BRN-2026-000021/service-reports';
  const v2 = { contractVersion: 2, content };
  const create = await handler.fetch(new Request(base, {
    method: 'POST', headers: { ...auth, 'Idempotency-Key': 'cccccccc-cccc-4ccc-8ccc-cccccccccc01' },
    body: JSON.stringify(v2),
  }), env);
  const save = await handler.fetch(new Request(`${base}/00000000-0000-4000-8000-000000000021/draft-save`, {
    method: 'POST', headers: { ...auth, 'Idempotency-Key': 'cccccccc-cccc-4ccc-8ccc-cccccccccc02' },
    body: JSON.stringify({ contractVersion: 2, expectedContentRevision: 0, patch: { technicianRemark: 'x' } }),
  }), env);
  const finalize = await handler.fetch(new Request(`${base}/00000000-0000-4000-8000-000000000021/finalize`, {
    method: 'POST', headers: { ...auth, 'Idempotency-Key': 'cccccccc-cccc-4ccc-8ccc-cccccccccc03' },
    body: JSON.stringify({ contractVersion: 2, expectedContentRevision: 0 }),
  }), env);
  const reportPath = `${base}/00000000-0000-4000-8000-000000000021`;
  const decide = (decision: 'approved' | 'rejected', key: string) => handler.fetch(new Request(
    `${reportPath}/approval-decision`,
    {
      method: 'POST', headers: { ...auth, 'Idempotency-Key': key },
      body: JSON.stringify({
        contractVersion: 2,
        decision,
        rejectionReason: decision === 'rejected' ? 'Needs correction' : null,
        expectedFinalDigest: `sha256:v1:${'a'.repeat(64)}`,
      }),
    }
  ), env);
  const approve = await decide('approved', 'cccccccc-cccc-4ccc-8ccc-cccccccccc04');
  const reject = await decide('rejected', 'cccccccc-cccc-4ccc-8ccc-cccccccccc05');
  check('disabled mode denies V2 create, save, finalize, approve, and reject before any V2 write',
    create.status === 428 && save.status === 428 && finalize.status === 428 &&
    approve.status === 404 && reject.status === 404 && store.committedWrites.length === 0);
}

// v2-active explicitly refuses the legacy create/save/finalize contracts.
{
  const store = new MemoryV2Store();
  const { handler, env } = createHandler('v2-active', store);
  const base = 'http://worker.test/service-jobs/BRN-2026-000021/service-reports';
  const create = await handler.fetch(new Request(base, {
    method: 'POST', headers: { ...auth, 'Idempotency-Key': 'dddddddd-dddd-4ddd-8ddd-dddddddddd01' },
    body: JSON.stringify({ input: {} }),
  }), env);
  const save = await handler.fetch(new Request(`${base}/00000000-0000-4000-8000-000000000021/legacy-draft-save`, {
    method: 'POST', headers: { ...auth, 'Idempotency-Key': 'dddddddd-dddd-4ddd-8ddd-dddddddddd02' },
    body: JSON.stringify({ contractVersion: 1, expectedUpdatedAt: '2026-01-01T00:00:00.000Z', patch: { technicianRemark: 'x' } }),
  }), env);
  const finalize = await handler.fetch(new Request(`${base}/00000000-0000-4000-8000-000000000021/finalize`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{}',
  }), env);
  check('v2-active denies legacy V1 create, draft-save, and {} finalize',
    create.status === 428 && save.status === 428 && finalize.status === 428 && store.committedWrites.length === 0);
}

await runV2Lifecycle('compatibility', '1', 'approved');
await runV2Lifecycle('v2-active', '2', 'rejected');

// A canonical but mismatched stored report brand is not repaired by draft-save.
{
  const store = new MemoryV2Store();
  const jobId = 'BRN-2026-000022';
  store.set('serviceJobs', jobId, { ...serviceJob(jobId) });
  store.set('staffProfiles', 'staff-uid-1', {
    brandId: 'bruno-thailand', role: 'technician', displayName: 'QA Staff',
  });
  const { handler, env } = createHandler('compatibility', store);
  const base = `http://worker.test/service-jobs/${jobId}/service-reports`;
  const createdResponse = await handler.fetch(new Request(base, {
    method: 'POST',
    headers: { ...auth, 'Idempotency-Key': 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01' },
    body: JSON.stringify({ contractVersion: 2, content }),
  }), env);
  const created = await createdResponse.json() as { data: { report: { id: string } } };
  const reportId = created.data.report.id;
  const stored = store.read('serviceReports', reportId)!;
  store.set('serviceReports', reportId, { ...stored, brandId: 'join-lux-club' });
  const commitsBeforeSave = store.committedWrites.length;
  const save = await handler.fetch(new Request(`${base}/${reportId}/draft-save`, {
    method: 'POST',
    headers: { ...auth, 'Idempotency-Key': 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02' },
    body: JSON.stringify({
      contractVersion: 2,
      expectedContentRevision: 0,
      patch: { technicianRemark: 'Must not be written' },
    }),
  }), env);
  const body = await save.json() as { data?: { report?: unknown }; report?: unknown };
  const unchanged = store.read('serviceReports', reportId);
  check('V2 draft-save rejects a schema-valid report brand mismatch without returning data or writing',
    save.status === 422 && body.data?.report === undefined && body.report === undefined &&
    store.committedWrites.length === commitsBeforeSave &&
    unchanged !== undefined && unchanged.brandId === 'join-lux-club' && unchanged.contentRevision === 0 &&
    unchanged.technicianRemark === '');
}

// A matching metadata owner must not override a foreign Service Job in the canonical path.
{
  const foreignJobId = 'BRN-2026-000099';
  const { store, jobId } = fixture('technician');
  const { handler, env } = createHandler('compatibility', store);
  const base = `http://worker.test/service-jobs/${jobId}/service-reports`;
  const createdResponse = await handler.fetch(new Request(base, {
    method: 'POST',
    headers: { ...auth, 'Idempotency-Key': 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03' },
    body: JSON.stringify({ contractVersion: 2, content }),
  }), env);
  const created = await createdResponse.json() as { data: { report: { id: string } } };
  const reportId = created.data.report.id;
  const key = assertCanonicalAttachmentKey(
    `service-jobs/${foreignJobId}/report/metadata-claims-current-job.jpg`
  );
  store.set('serviceJobAttachments', await attachmentMetadataDocId(key), {
    path: key,
    jobId,
    size: 1024,
    deletedAt: null,
  });
  const commitsBeforeSave = store.committedWrites.length;
  const save = await handler.fetch(new Request(`${base}/${reportId}/draft-save`, {
    method: 'POST',
    headers: { ...auth, 'Idempotency-Key': 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee04' },
    body: JSON.stringify({
      contractVersion: 2,
      expectedContentRevision: 0,
      patch: { evidenceAttachmentIds: [key] },
    }),
  }), env);
  const body = await save.json() as { data?: { report?: unknown }; report?: unknown };
  const unchanged = store.read('serviceReports', reportId);
  check('V2 save rejects a foreign-job canonical path even when metadata claims the current owner',
    save.status === 403 && body.data?.report === undefined && body.report === undefined &&
    store.committedWrites.length === commitsBeforeSave &&
    unchanged?.contentRevision === 0 &&
    Array.isArray(unchanged.evidenceAttachmentIds) && unchanged.evidenceAttachmentIds.length === 0);
}

if (failures) process.exitCode = 1;
