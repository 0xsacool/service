import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bangkokNumberingYear } from '../../src/services/bangkokTime.ts';
import type { Env } from '../src/env.ts';
import { createWorkerHandler, type WorkerDependencies } from '../src/index.ts';
import { createFirestoreClient } from '../src/firestoreClient.ts';
import { createServiceReportV2Store } from '../src/serviceReportV2Firestore.ts';
import { idempotencyDocumentId } from '../src/serviceReportV2Contracts.ts';
import { assertCanonicalAttachmentKey, attachmentDeletionClaimDocId, attachmentMetadataDocId } from '../../src/services/attachmentIdentity.ts';

const PROJECT_ID = 'f5d26-rules';
const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST?.trim();

if (!EMULATOR_HOST) {
  throw new Error(
    'FIRESTORE_EMULATOR_HOST is required for this integration test; start the Firestore Emulator explicitly.'
  );
}

const emulatorOrigin = (() => {
  const candidate = new URL(`http://${EMULATOR_HOST}`);
  if (
    candidate.username || candidate.password || candidate.pathname !== '/' ||
    candidate.search || candidate.hash ||
    !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(candidate.hostname)
  ) {
    throw new Error(
      'FIRESTORE_EMULATOR_HOST must be a local host:port. Remote Firestore targets are forbidden.'
    );
  }
  return candidate.origin;
})();

const DOCUMENTS_URL =
  `${emulatorOrigin}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const TIMESTAMP_FIELDS = new Set([
  'createdAt', 'updatedAt', 'finalizedAt', 'completedAt', 'decidedAt',
]);

type FirestoreValue = Record<string, unknown>;

function toFirestoreValue(value: unknown, fieldName?: string): FirestoreValue {
  if (value === null) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value)
    ? { integerValue: String(value) }
    : { doubleValue: value };
  if (typeof value === 'string') return fieldName && TIMESTAMP_FIELDS.has(fieldName)
    ? { timestampValue: value }
    : { stringValue: value };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map((entry) => toFirestoreValue(entry)) } };
  }
  if (typeof value === 'object') {
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .map(([key, entry]) => [key, toFirestoreValue(entry, key)])
        ),
      },
    };
  }
  throw new TypeError(`Unsupported Firestore fixture value: ${typeof value}`);
}

function toFirestoreFields(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, toFirestoreValue(entry, key)])
  );
}

async function emulatorRequest(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('Authorization', 'Bearer owner');
  return fetch(`${DOCUMENTS_URL}/${path}`, {
    ...init,
    headers,
    signal: init?.signal ?? AbortSignal.timeout(5_000),
  });
}

async function putFixture(collection: string, id: string, data: Record<string, unknown>) {
  const response = await emulatorRequest(
    `${collection}/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify({ fields: toFirestoreFields(data) }) }
  );
  assert.equal(
    response.status,
    200,
    `Could not seed synthetic ${collection}/${id} in Firestore Emulator: ${response.status} ${await response.text()}`
  );
}

async function deleteFixture(collection: string, id: string): Promise<void> {
  const response = await emulatorRequest(
    `${collection}/${encodeURIComponent(id)}`,
    { method: 'DELETE' }
  );
  assert.ok(
    response.status === 200 || response.status === 204 || response.status === 404,
    `Could not clean synthetic ${collection}/${id}: HTTP ${response.status}`
  );
}

async function getRawDocument(collection: string, id: string): Promise<Record<string, unknown> | null> {
  const response = await emulatorRequest(`${collection}/${encodeURIComponent(id)}`);
  if (response.status === 404) return null;
  assert.equal(response.status, 200, `Emulator read failed: HTTP ${response.status}`);
  return await response.json() as Record<string, unknown>;
}

async function restoreRawDocument(
  collection: string,
  id: string,
  prior: Record<string, unknown> | null
): Promise<void> {
  if (!prior) {
    await deleteFixture(collection, id);
    return;
  }
  const response = await emulatorRequest(
    `${collection}/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify({ fields: prior.fields ?? {} }) }
  );
  assert.equal(response.status, 200, `Could not restore prior ${collection}/${id}`);
}

function syntheticServiceJob(jobId: string): Record<string, unknown> {
  const at = '2026-09-24T00:00:00.000Z';
  return {
    serviceRequestNumber: `SR-EMU-${jobId.slice(-8)}`,
    brandId: 'bruno-thailand',
    customerName: 'Synthetic Emulator Customer',
    customerPhone: '0000000000',
    customerEmail: '',
    product: 'Synthetic Emulator Product',
    productCategory: 'Other',
    serialNumber: 'EMU-SERIAL',
    issue: 'Synthetic reported issue',
    description: 'Synthetic integration fixture',
    status: 'Received',
    priority: 'Normal',
    createdAt: at,
    updatedAt: at,
    technician: 'Synthetic Technician',
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

const reportContent = {
  technician: 'Synthetic Technician',
  customerReportedProblem: 'Synthetic reported issue',
  inspectionFindings: 'Synthetic fault reproduced',
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

const authHeaders = {
  Authorization: 'Bearer synthetic-emulator-token',
  'Content-Type': 'application/json',
};

test('Service Report V1/V2 and attachment deletion routes use Firestore Emulator transactions', {
  timeout: 30_000,
}, async () => {
  // A document GET returning 404 proves the Firestore REST endpoint is live,
  // while avoiding any writes before the test fixtures are prepared.
  const probe = await emulatorRequest(
    `serviceJobs/emu-probe-${crypto.randomUUID()}`,
    { signal: AbortSignal.timeout(10_000) }
  );
  const probeBody = await probe.text();
  assert.equal(
    probe.status,
    404,
    `Firestore Emulator at ${EMULATOR_HOST} is unreachable or is not serving project ${PROJECT_ID} (HTTP ${probe.status}: ${probeBody}).`
  );

  const jobId = `EMU-SR-${crypto.randomUUID()}`;
  const uid = `synthetic-staff-${crypto.randomUUID()}`;
  const year = bangkokNumberingYear(new Date());
  const sequenceId = `bruno-thailand__repair_report__${year}`;
  let sequenceBefore: Record<string, unknown> | null = null;
  let sequenceCaptured = false;
  const createKey = crypto.randomUUID();
  const saveKey = crypto.randomUUID();
  const finalizeKey = crypto.randomUUID();
  const legacyCreateKey = crypto.randomUUID();
  const legacySaveKey = crypto.randomUUID();
  const deletionKey = crypto.randomUUID();
  const attachmentKey = assertCanonicalAttachmentKey(`service-jobs/${jobId}/report/${crypto.randomUUID()}.jpg`);
  const metadataId = await attachmentMetadataDocId(attachmentKey);
  const claimId = await attachmentDeletionClaimDocId(attachmentKey);
  const deletionOperationId = await idempotencyDocumentId(deletionKey);
  const idempotencyIds = await Promise.all(
    [createKey, saveKey, finalizeKey, legacySaveKey].map((key) => idempotencyDocumentId(key))
  );
  const objectSizes = new Map<string, number>();
  const deletedObjects: string[] = [];
  let reportId: string | null = null;
  let legacyReportId: string | null = null;
  let commitRequests = 0;
  let rollbackRequests = 0;
  let rollbackFailures = 0;

  const env: Env = {
    ATTACHMENTS_BUCKET: {} as R2Bucket,
    ALLOWED_ORIGINS: 'http://localhost:5173',
    FIRESTORE_PROJECT_ID: PROJECT_ID,
    FIRESTORE_EMULATOR_HOST: EMULATOR_HOST,
    SERVICE_REPORT_V2_MODE: 'compatibility',
  };
  const dependencies: WorkerDependencies = {
    tokenVerifier: {
      async verify(token) {
        assert.equal(token, 'synthetic-emulator-token');
        return { uid };
      },
    },
    createFirestoreClient: (requestEnv) => createFirestoreClient(requestEnv),
    createServiceReportV2Store: (requestEnv) => createServiceReportV2Store(requestEnv),
    createEvidenceObjectStore: () => ({
      async head(key) {
        const size = objectSizes.get(key);
        return size === undefined ? null : { key, size };
      },
      async delete(key) {
        deletedObjects.push(key);
        objectSizes.delete(key);
      },
    }),
  };
  const worker = createWorkerHandler(dependencies);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const target = typeof input === 'string' || input instanceof URL
      ? String(input)
      : input.url;
    if (target.startsWith(DOCUMENTS_URL)) {
      const headers = new Headers(init?.headers);
      headers.set('Authorization', 'Bearer owner');
      const requestUrl = new URL(target);
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();

      if (method === 'GET' && requestUrl.searchParams.has('transaction')) {
        // The local emulator's REST GET transaction selector throws BYTE_STRING.
        // Use the supported batchGet transaction body form for this test only.
        const prefix = new URL(DOCUMENTS_URL).pathname;
        const path = requestUrl.pathname.slice(prefix.length)
          .replace(/^\/+/, '')
          .split('/')
          .map((segment) => decodeURIComponent(segment))
          .join('/');
        const transaction = requestUrl.searchParams.get('transaction');
        const response = await originalFetch(`${DOCUMENTS_URL}:batchGet`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            documents: [`projects/${PROJECT_ID}/databases/(default)/documents/${path}`],
            transaction,
          }),
        });
        if (!response.ok) return response;
        const results = await response.json() as Array<{ found?: unknown; missing?: string }>;
        assert.ok(Array.isArray(results), 'Transactional batchGet must return result entries');
        const document = results.find((entry) => entry.found)?.found;
        return document
          ? new Response(JSON.stringify(document), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          : new Response(null, { status: 404 });
      }

      if (target.endsWith(':commit')) commitRequests += 1;
      if (target.endsWith(':rollback')) rollbackRequests += 1;
      const response = await originalFetch(input, { ...init, headers });
      if (target.endsWith(':rollback') && !response.ok) rollbackFailures += 1;
      return response;
    }
    return originalFetch(input, init);
  };

  try {
    sequenceBefore = await getRawDocument('numberSequences', sequenceId);
    sequenceCaptured = true;
    if (sequenceBefore === null) {
      await putFixture('numberSequences', sequenceId, {
        brandId: 'bruno-thailand',
        documentType: 'repair_report',
        year,
        currentValue: 0,
      });
    }
    await putFixture('serviceJobs', jobId, syntheticServiceJob(jobId));
    await putFixture('staffProfiles', uid, {
      brandId: 'bruno-thailand',
      role: 'technician',
      displayName: 'Synthetic Emulator Technician',
      canImportProducts: false,
    });

    const base = `http://worker.test/service-jobs/${jobId}/service-reports`;
    const createResponse = await worker.fetch(new Request(base, {
      method: 'POST',
      headers: { ...authHeaders, 'Idempotency-Key': createKey },
      body: JSON.stringify({ contractVersion: 2, content: reportContent }),
    }), env);
    const createdBody = await createResponse.json() as {
      data?: { report?: { id?: string; contentRevision?: number } };
    };
    assert.equal(createResponse.status, 201, JSON.stringify(createdBody));
    assert.equal(createdBody.data?.report?.contentRevision, 0);
    reportId = createdBody.data?.report?.id ?? null;
    assert.ok(reportId, 'V2 create must return the created report ID');
    assert.equal(commitRequests, 1, 'V2 create should commit one Firestore transaction');

    const reportPath = `${base}/${reportId}`;
    const saveResponse = await worker.fetch(new Request(`${reportPath}/draft-save`, {
      method: 'POST',
      headers: { ...authHeaders, 'Idempotency-Key': saveKey },
      body: JSON.stringify({
        contractVersion: 2,
        expectedContentRevision: 0,
        patch: { technicianRemark: 'Saved against the emulator' },
      }),
    }), env);
    const savedBody = await saveResponse.json() as {
      data?: { report?: { contentRevision?: number; technicianRemark?: string } };
    };
    assert.equal(saveResponse.status, 200, JSON.stringify(savedBody));
    assert.equal(savedBody.data?.report?.contentRevision, 1);
    assert.equal(savedBody.data?.report?.technicianRemark, 'Saved against the emulator');
    assert.equal(commitRequests, 2, 'V2 save should commit one additional transaction');

    const staleResponse = await worker.fetch(new Request(`${reportPath}/draft-save`, {
      method: 'POST',
      headers: { ...authHeaders, 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        contractVersion: 2,
        expectedContentRevision: 0,
        patch: { technicianRemark: 'Must be rejected as stale' },
      }),
    }), env);
    assert.equal(staleResponse.status, 412);
    assert.equal(commitRequests, 2, 'Stale revision denial must not commit a Firestore write');
    assert.equal(rollbackRequests, 1, 'Stale revision denial must roll back its Firestore transaction');
    assert.equal(rollbackFailures, 0, 'Stale revision rollback must succeed in the emulator');

    const finalizeRequest = () => new Request(`${reportPath}/finalize`, {
      method: 'POST',
      headers: { ...authHeaders, 'Idempotency-Key': finalizeKey },
      body: JSON.stringify({ contractVersion: 2, expectedContentRevision: 1 }),
    });
    const firstFinalize = await worker.fetch(finalizeRequest(), env);
    const firstFinalizeText = await firstFinalize.text();
    assert.equal(firstFinalize.status, 200, firstFinalizeText);
    // Discard the successful result locally to model a committed request whose
    // response is lost before reaching the client.
    const firstFinalizeBody = JSON.parse(firstFinalizeText) as {
      replayed?: boolean;
      data?: { report?: { status?: string; approvalState?: string } };
    };
    assert.equal(firstFinalizeBody.data?.report?.status, 'final');
    assert.equal(firstFinalizeBody.data?.report?.approvalState, 'pending');
    assert.equal(firstFinalizeBody.replayed, false);
    assert.equal(commitRequests, 3, 'First finalize should commit exactly once');

    const replayResponse = await worker.fetch(finalizeRequest(), env);
    const replayBody = await replayResponse.json() as {
      replayed?: boolean;
      data?: { report?: { status?: string; approvalState?: string } };
    };
    assert.equal(replayResponse.status, 200, JSON.stringify(replayBody));
    assert.equal(replayBody.replayed, true);
    assert.equal(replayBody.data?.report?.status, 'final');
    assert.equal(replayBody.data?.report?.approvalState, 'pending');
    assert.equal(
      commitRequests,
      3,
      'Exact finalize replay after commit must not issue another Firestore commit'
    );
    assert.equal(rollbackRequests, 2, 'Read-only finalize replay must roll back its Firestore transaction');
    assert.equal(rollbackFailures, 0, 'All early-return rollback requests must succeed');

    // V2 finalization releases a versioned active-draft slot. A legacy V1
    // create in compatibility mode must reuse that slot at the next generation.
    const legacyCreateResponse = await worker.fetch(new Request(base, {
      method: 'POST',
      headers: { ...authHeaders, 'Idempotency-Key': legacyCreateKey },
      body: JSON.stringify({
        input: {
          customerReportedProblem: 'Synthetic V1 reported problem',
          inspectionFindings: 'Synthetic V1 inspection finding',
          serviceActions: ['repair'],
          resultStatus: 'repaired',
        },
      }),
    }), env);
    const legacyBody = await legacyCreateResponse.json() as {
      report?: { id?: string; status?: string; serviceJobId?: string; updatedAt?: string };
    };
    assert.equal(legacyCreateResponse.status, 201, JSON.stringify(legacyBody));
    assert.equal(legacyBody.report?.status, 'draft');
    assert.equal(legacyBody.report?.serviceJobId, jobId);
    legacyReportId = legacyBody.report?.id ?? null;
    assert.ok(legacyReportId, 'V1 create must return its report ID');
    assert.equal(commitRequests, 4, 'V1 create should commit one additional transaction');

    const slotResponse = await emulatorRequest(
      `serviceReportActiveDrafts/${encodeURIComponent(jobId)}`
    );
    assert.equal(slotResponse.status, 200, 'Released V2 slot should be reused');
    const slot = await slotResponse.json() as {
      fields?: {
        generation?: { integerValue?: string };
        state?: { stringValue?: string };
        activeReportId?: { stringValue?: string };
        serviceJobId?: { stringValue?: string };
      };
    };
    assert.equal(slot.fields?.generation?.integerValue, '2');
    assert.equal(slot.fields?.state?.stringValue, 'active');
    assert.equal(slot.fields?.activeReportId?.stringValue, legacyReportId);
    assert.equal(slot.fields?.serviceJobId?.stringValue, jobId);

    const slotsResponse = await emulatorRequest('serviceReportActiveDrafts?pageSize=1000');
    assert.equal(slotsResponse.status, 200);
    const slots = await slotsResponse.json() as {
      documents?: Array<{ fields?: Record<string, { stringValue?: string }> }>;
    };
    const activeSlotsForJob = (slots.documents ?? []).filter((document) =>
      document.fields?.serviceJobId?.stringValue === jobId &&
      document.fields?.state?.stringValue === 'active'
    );
    assert.equal(activeSlotsForJob.length, 1, 'Exactly one active draft slot should exist for the synthetic job');

    const originalV1UpdatedAt = legacyBody.report?.updatedAt;
    assert.ok(originalV1UpdatedAt, 'V1 create must return its updatedAt timestamp');
    const legacyPath = `${base}/${legacyReportId}/legacy-draft-save`;
    const legacySaveRequest = (key: string, expectedUpdatedAt: string) => new Request(legacyPath, {
      method: 'POST',
      headers: { ...authHeaders, 'Idempotency-Key': key },
      body: JSON.stringify({
        contractVersion: 1,
        expectedUpdatedAt,
        patch: { technicianRemark: 'Saved against the emulator' },
      }),
    });
    const commitsBeforeV1Save = commitRequests;
    const rollbacksBeforeV1Save = rollbackRequests;
    const v1SaveResponse = await worker.fetch(
      legacySaveRequest(legacySaveKey, originalV1UpdatedAt), env
    );
    const v1SaveBody = await v1SaveResponse.json() as {
      replayed?: boolean;
      data?: { report?: { technicianRemark?: string; updatedAt?: string } };
    };
    assert.equal(v1SaveResponse.status, 200, JSON.stringify(v1SaveBody));
    assert.equal(v1SaveBody.data?.report?.technicianRemark, 'Saved against the emulator');
    assert.equal(v1SaveBody.replayed, false);
    assert.equal(commitRequests, commitsBeforeV1Save + 1, 'V1 save must commit exactly once');
    assert.equal(rollbackRequests, rollbacksBeforeV1Save, 'Committed V1 save must not roll back');
    assert.notEqual(v1SaveBody.data?.report?.updatedAt, originalV1UpdatedAt);

    const staleV1Response = await worker.fetch(
      legacySaveRequest(crypto.randomUUID(), originalV1UpdatedAt), env
    );
    assert.equal(staleV1Response.status, 412);
    assert.equal(commitRequests, commitsBeforeV1Save + 1, 'Stale V1 save must not commit');
    assert.equal(rollbackRequests, rollbacksBeforeV1Save + 1, 'Stale V1 save must roll back');
    assert.equal(rollbackFailures, 0, 'Stale V1 save rollback must succeed');

    const v1ReplayResponse = await worker.fetch(
      legacySaveRequest(legacySaveKey, originalV1UpdatedAt), env
    );
    const v1ReplayBody = await v1ReplayResponse.json() as {
      replayed?: boolean;
      data?: { report?: { technicianRemark?: string } };
    };
    assert.equal(v1ReplayResponse.status, 200, JSON.stringify(v1ReplayBody));
    assert.equal(v1ReplayBody.replayed, true);
    assert.equal(v1ReplayBody.data?.report?.technicianRemark, 'Saved against the emulator');
    assert.equal(commitRequests, commitsBeforeV1Save + 1, 'V1 replay must not commit again');
    assert.equal(rollbackRequests, rollbacksBeforeV1Save + 2, 'Read-only V1 replay must roll back');
    assert.equal(rollbackFailures, 0, 'V1 replay rollback must succeed');

    await putFixture('staffProfiles', uid, {
      brandId: 'bruno-thailand',
      role: 'admin',
      displayName: 'Synthetic Emulator Admin',
      canImportProducts: false,
    });
    await putFixture('serviceJobAttachments', metadataId, {
      jobId,
      category: 'report',
      name: 'synthetic-evidence.jpg',
      path: attachmentKey,
      contentType: 'image/jpeg',
      size: 1024,
      uploadedAt: '2026-01-01T00:00:00.000Z',
      uploadedBy: uid,
      deleteAfter: '2026-01-02T00:00:00.000Z',
      retentionStatus: 'active',
      retentionExtensions: 0,
      deletedAt: null,
      metadataKeyVersion: 2,
      approvalRetainUntil: null,
    });
    objectSizes.set(attachmentKey, 1024);
    const deletionRequest = (key: string, attachmentId: string) => new Request(
      `http://worker.test/service-jobs/${jobId}/attachments/${attachmentId}/deletion-requests`,
      {
        method: 'POST',
        headers: { ...authHeaders, 'Idempotency-Key': key },
        body: JSON.stringify({ contractVersion: 2, mode: 'manual' }),
      }
    );
    const commitsBeforeDeletion = commitRequests;
    const rollbacksBeforeDeletion = rollbackRequests;
    const firstDeletion = await worker.fetch(deletionRequest(deletionKey, metadataId), env);
    const firstDeletionBody = await firstDeletion.json() as { data?: { status?: string } };
    assert.equal(firstDeletion.status, 200, JSON.stringify(firstDeletionBody));
    assert.equal(firstDeletionBody.data?.status, 'completed');
    assert.equal(commitRequests, commitsBeforeDeletion + 4, 'Manual deletion must commit its four state transitions');
    assert.equal(rollbackRequests, rollbacksBeforeDeletion, 'Committed deletion transitions must not roll back');
    assert.deepEqual(deletedObjects, [attachmentKey], 'Synthetic object must be deleted exactly once');
    assert.equal(objectSizes.has(attachmentKey), false);
    const commitsAfterDeletion = commitRequests;

    const deletionReplay = await worker.fetch(deletionRequest(deletionKey, metadataId), env);
    const deletionReplayBody = await deletionReplay.json() as { data?: { status?: string } };
    assert.equal(deletionReplay.status, 200, JSON.stringify(deletionReplayBody));
    assert.equal(deletionReplayBody.data?.status, 'completed');
    assert.equal(commitRequests, commitsAfterDeletion, 'Completed deletion replay must not commit');
    assert.equal(rollbackRequests, rollbacksBeforeDeletion + 1, 'Completed deletion replay must roll back');
    assert.deepEqual(deletedObjects, [attachmentKey], 'Completed replay must not delete the object twice');

    const missingKey = assertCanonicalAttachmentKey(
      `service-jobs/${jobId}/report/${crypto.randomUUID()}.jpg`
    );
    const missingMetadataId = await attachmentMetadataDocId(missingKey);
    const missingDeletion = await worker.fetch(
      deletionRequest(crypto.randomUUID(), missingMetadataId), env
    );
    assert.equal(missingDeletion.status, 404, 'Missing attachment must keep its original 404');
    assert.equal(commitRequests, commitsAfterDeletion, 'Missing attachment must not commit');
    assert.equal(rollbackRequests, rollbacksBeforeDeletion + 2, 'Missing attachment must roll back');
    assert.equal(rollbackFailures, 0, 'All deletion rollbacks must succeed');
  } finally {
    globalThis.fetch = originalFetch;
    const cleanup: Promise<void>[] = [
      deleteFixture('serviceJobs', jobId),
      deleteFixture('staffProfiles', uid),
      deleteFixture('serviceReportActiveDrafts', jobId),
      ...idempotencyIds.map((id) => deleteFixture('serviceReportIdempotency', id)),
      deleteFixture('serviceReportDraftKeys', legacyCreateKey),
      deleteFixture('serviceJobAttachments', metadataId),
      deleteFixture('attachmentDeletionClaims', claimId),
      deleteFixture('attachmentDeletionOperations', deletionOperationId),
    ];
    if (sequenceCaptured) {
      cleanup.push(restoreRawDocument('numberSequences', sequenceId, sequenceBefore));
    }
    if (reportId) cleanup.push(deleteFixture('serviceReports', reportId));
    if (legacyReportId) cleanup.push(deleteFixture('serviceReports', legacyReportId));
    const results = await Promise.allSettled(cleanup);
    const failures = results.filter((result) => result.status === 'rejected');
    assert.equal(failures.length, 0, `Synthetic emulator fixture cleanup failed: ${failures.length} operation(s)`);
  }
});
