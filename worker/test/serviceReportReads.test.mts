import assert from 'node:assert/strict';
import { createWorkerHandler, type WorkerDependencies } from '../src/index.ts';
import type { Env } from '../src/env.ts';
import type { FirestoreClient } from '../src/firestoreClient.ts';
import type {
  ApprovalQueueQuery,
  ReadStoredDocument,
  ServiceReportReadStore,
} from '../src/serviceReportReadRoutes.ts';
import { MemoryV2Store, seedFinalReport } from './serviceReportV2StoreHarness.mts';

const JOB_ID = 'BRN-2026-000001';
const UID = 'approver-uid-0001';

class ReadMemoryStore implements ServiceReportReadStore {
  readonly documents = new Map<string, ReadStoredDocument>();
  readonly historyQueries: { serviceJobId: string; limit: number }[] = [];
  readonly approvalQueries: ApprovalQueueQuery[] = [];
  readonly batchRequests: readonly { collection: string; id: string }[][] = [];

  set(collection: string, id: string, data: Record<string, unknown>): void {
    this.documents.set(`${collection}/${id}`, { collection, id, data });
  }

  async get(collection: string, id: string): Promise<ReadStoredDocument | null> {
    return this.documents.get(`${collection}/${id}`) ?? null;
  }

  // Test-double seam only. Production batchGet is untouched; this lets a test
  // deterministically return a divergent batch (missing, duplicated, or
  // unrequested document) that a healthy Firestore would never produce, so the
  // route's integrity guard can be exercised. Default is null: results are
  // returned reversed, keeping the unordered-result coverage intact.
  batchGetDivergence: ((found: ReadStoredDocument[]) => ReadStoredDocument[]) | null = null;

  async batchGet(addresses: readonly { collection: string; id: string }[]) {
    this.batchRequests.push(addresses);
    const found: ReadStoredDocument[] = [];
    for (const address of [...addresses].reverse()) {
      const document = await this.get(address.collection, address.id);
      if (document) found.push(document);
    }
    return this.batchGetDivergence ? this.batchGetDivergence(found) : found;
  }

  // Test-double seams only, same contract as batchGetDivergence above:
  // production query behavior is untouched, and these let a test return rows a
  // healthy Firestore query would have filtered out. That is what proves the
  // route re-verifies identity and brand itself rather than trusting the query.
  historyDivergence: ((rows: ReadStoredDocument[]) => ReadStoredDocument[]) | null = null;
  approvalQueueDivergence: ((rows: ReadStoredDocument[]) => ReadStoredDocument[]) | null = null;

  async queryHistory(serviceJobId: string, limit: number) {
    this.historyQueries.push({ serviceJobId, limit });
    const rows = [...this.documents.values()]
      .filter((document) =>
        document.collection === 'serviceReports' &&
        document.data.serviceJobId === serviceJobId
      )
      .sort((left, right) => left.id.localeCompare(right.id))
      .slice(0, limit);
    return this.historyDivergence ? this.historyDivergence(rows) : rows;
  }

  async queryApprovalQueue(query: ApprovalQueueQuery) {
    this.approvalQueries.push(query);
    let reports = [...this.documents.values()].filter((document) => {
      if (document.collection !== 'serviceReports') return false;
      const data = document.data;
      if (
        data.brandId !== query.brandId || data.schemaVersion !== 2 ||
        data.approvalState !== 'pending'
      ) return false;
      if (query.mode === 'report-number' && data.reportNo !== query.search) return false;
      const snapshot = data.snapshot as Record<string, unknown> | undefined;
      return query.mode !== 'tracking-reference' || snapshot?.trackingReference === query.search;
    });
    reports.sort((left, right) => {
      const finalized = String(right.data.finalizedAt).localeCompare(String(left.data.finalizedAt));
      return finalized || right.id.localeCompare(left.id);
    });
    if (query.cursor) {
      reports = reports.filter((report) =>
        String(report.data.finalizedAt) < query.cursor!.finalizedAt ||
        (report.data.finalizedAt === query.cursor!.finalizedAt &&
          report.id < query.cursor!.reportId)
      );
    }
    const page = reports.slice(0, query.pageSize + 1);
    return this.approvalQueueDivergence ? this.approvalQueueDivergence(page) : page;
  }
}

function env(): Env {
  return {
    ATTACHMENTS_BUCKET: {} as R2Bucket,
    ALLOWED_ORIGINS: 'http://localhost:5173',
    FIRESTORE_PROJECT_ID: 'test-project',
    SERVICE_REPORT_V2_MODE: 'disabled',
  };
}

function handler(store: ReadMemoryStore) {
  const dependencies: WorkerDependencies = {
    tokenVerifier: {
      async verify(token) {
        if (token !== 'valid-token') throw new Error('invalid');
        return { uid: UID };
      },
    },
    createFirestoreClient: () => ({} as FirestoreClient),
    createServiceReportReadStore: () => store,
  };
  return createWorkerHandler(dependencies);
}

function request(path: string, token = 'valid-token'): Request {
  return new Request(`http://worker.test${path}`, {
    method: 'GET',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

function masked(value: Record<string, unknown>): Record<string, unknown> {
  const { requestId: _requestId, ...rest } = value;
  return rest;
}

async function seedPending(
  store: ReadMemoryStore,
  reportId: string,
  finalizedAt: string
): Promise<Record<string, unknown>> {
  const memory = new MemoryV2Store();
  const report = await seedFinalReport(memory, {
    reportId,
    approvalState: 'pending',
    evidenceAttachmentIds: [],
    now: finalizedAt,
  });
  store.set('serviceReports', reportId, report);
  return report;
}

function seedAccess(
  store: ReadMemoryStore,
  role: 'technician' | 'approver' | 'admin' = 'approver',
  brandId: 'bruno-thailand' | 'join-lux-club' = 'bruno-thailand'
): void {
  store.set('staffProfiles', UID, {
    brandId,
    role,
    displayName: 'QA Staff',
    canImportProducts: false,
  });
  store.set('serviceJobs', JOB_ID, {
    brandId: 'bruno-thailand',
    customerName: 'QA Customer',
    status: 'Received',
  });
}

console.log('Running Phase 3R.4B Service Report read contracts');

{
  const store = new ReadMemoryStore();
  const worker = handler(store);
  const missing = await worker.fetch(request('/service-reports/approval-queue', ''), env());
  const invalid = await worker.fetch(request('/service-reports/approval-queue', 'invalid-token'), env());
  assert.equal(missing.status, 401);
  assert.equal(invalid.status, 401);
  assert.equal((await body(missing)).ok, false);
  assert.equal(store.documents.size, 0);
}

{
  const store = new ReadMemoryStore();
  seedAccess(store, 'technician');
  const worker = handler(store);
  const response = await worker.fetch(
    request('/service-reports/approval-queue/report-number/not-valid?unknown=1'),
    env()
  );
  assert.equal(response.status, 400);
  assert.equal(store.approvalQueries.length, 0);
}

{
  const store = new ReadMemoryStore();
  seedAccess(store, 'technician');
  const worker = handler(store);
  const denied = await worker.fetch(request('/service-reports/approval-queue'), env());
  assert.equal(denied.status, 403);
  assert.equal(((await body(denied)).error as Record<string, unknown>).code,
    'approval_console_access_denied');
  store.set('staffProfiles', UID, {
    brandId: 'bruno-thailand',
    role: 'approver',
    displayName: 'QA Approver',
    canImportProducts: false,
  });
  const allowed = await worker.fetch(request('/service-reports/approval-queue'), env());
  assert.equal(allowed.status, 200);
}

{
  const store = new ReadMemoryStore();
  seedAccess(store, 'technician');
  const v2 = await seedPending(store, 'report-v2', '2026-02-01T00:00:00.000Z');
  store.set('serviceReports', 'report-v1', {
    serviceJobId: JOB_ID,
    reportNo: 'FR-2026-000002',
    status: 'final',
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-03T00:00:00.000Z',
    finalizedAt: '2026-01-03T00:00:00.000Z',
    technician: 'Legacy Technician',
    customerReportedProblem: 'Problem',
    inspectionFindings: 'Findings',
    serviceActions: ['repair'],
    parts: [],
    technicianRemark: '',
    resultStatus: 'repaired',
    resultDetail: '',
    evidenceAttachmentIds: [],
    claimNo: null,
    factoryReference: null,
    snapshot: (v2.snapshot as Record<string, unknown>),
  });
  const worker = handler(store);
  const response = await worker.fetch(
    request(`/service-jobs/${JOB_ID}/service-reports`),
    env()
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const data = (await body(response)).data as { reports: Record<string, unknown>[] };
  assert.deepEqual(data.reports.map((report) => report.sourceSchemaVersion), [2, 1]);
  assert.equal(store.historyQueries[0]?.limit, 51);
  assert.equal('createdByUid' in data.reports[0]!, false);
}

{
  const store = new ReadMemoryStore();
  seedAccess(store, 'technician');
  for (let index = 0; index < 51; index += 1) {
    store.set('serviceReports', `report-${String(index).padStart(2, '0')}`, {
      serviceJobId: JOB_ID,
      reportNo: 'FR-2026-000001',
      status: 'draft',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      finalizedAt: null,
      technician: 'QA Technician',
      customerReportedProblem: 'Problem',
      inspectionFindings: '',
      serviceActions: [],
      parts: [],
      technicianRemark: '',
      resultStatus: null,
      resultDetail: '',
      evidenceAttachmentIds: [],
      claimNo: null,
      factoryReference: null,
      snapshot: null,
    });
  }
  const response = await handler(store).fetch(
    request(`/service-jobs/${JOB_ID}/service-reports`),
    env()
  );
  assert.equal(response.status, 409);
  assert.equal(((await body(response)).error as Record<string, unknown>).code,
    'history_limit_exceeded');
}

{
  const missingStore = new ReadMemoryStore();
  missingStore.set('staffProfiles', UID, {
    brandId: 'bruno-thailand', role: 'technician', displayName: null,
  });
  const foreignStore = new ReadMemoryStore();
  seedAccess(foreignStore, 'technician', 'join-lux-club');
  const missing = await handler(missingStore).fetch(
    request(`/service-jobs/${JOB_ID}/service-reports`), env()
  );
  const foreign = await handler(foreignStore).fetch(
    request(`/service-jobs/${JOB_ID}/service-reports`), env()
  );
  assert.equal(missing.status, 403);
  assert.deepEqual(masked(await body(missing)), masked(await body(foreign)));
}

{
  const store = new ReadMemoryStore();
  seedAccess(store);
  await seedPending(store, 'report-a', '2026-02-02T00:00:00.000Z');
  await seedPending(store, 'report-b', '2026-02-01T00:00:00.000Z');
  const worker = handler(store);
  const first = await worker.fetch(
    request('/service-reports/approval-queue?pageSize=1'), env()
  );
  assert.equal(first.status, 200);
  const firstData = (await body(first)).data as {
    items: Record<string, unknown>[];
    nextCursor: string;
  };
  assert.equal(firstData.items.length, 1);
  assert.equal(firstData.items[0]?.reportId, 'report-a');
  assert.ok(firstData.nextCursor);
  assert.equal(store.batchRequests[0]?.length, 1);
  const second = await worker.fetch(
    request(`/service-reports/approval-queue?pageSize=1&cursor=${firstData.nextCursor}`),
    env()
  );
  assert.equal(second.status, 200);
  const secondData = (await body(second)).data as { items: Record<string, unknown>[] };
  assert.equal(secondData.items[0]?.reportId, 'report-b');
  assert.equal(store.approvalQueries[0]?.pageSize, 1);
}

{
  const store = new ReadMemoryStore();
  seedAccess(store, 'admin');
  await seedPending(store, 'report-search', '2026-02-01T00:00:00.000Z');
  const worker = handler(store);
  const byNumber = await worker.fetch(
    request('/service-reports/approval-queue/report-number/%20fr-2026-000001%20'),
    env()
  );
  assert.equal(byNumber.status, 200);
  assert.equal(store.approvalQueries.at(-1)?.search, 'FR-2026-000001');
  const byTracking = await worker.fetch(
    request(`/service-reports/approval-queue/tracking-reference/${JOB_ID}`),
    env()
  );
  assert.equal(byTracking.status, 200);
  assert.equal(store.approvalQueries.at(-1)?.search, JOB_ID);
}

{
  const store = new ReadMemoryStore();
  seedAccess(store);
  const report = await seedPending(store, 'report-review', '2026-02-01T00:00:00.000Z');
  const worker = handler(store);
  const response = await worker.fetch(
    request(`/service-jobs/${JOB_ID}/service-reports/report-review/approval-review`),
    env()
  );
  assert.equal(response.status, 200);
  const review = (await body(response)).data as Record<string, unknown>;
  assert.equal(review.finalContentDigest, report.finalContentDigest);
  assert.equal('createdByUid' in review, false);
  assert.equal('brandId' in review, false);
  const terminal = { ...report, approvalState: 'approved', currentApprovalEventId: 'report-review',
    approvalDecidedAt: '2026-02-01T00:00:00.000Z' };
  store.set('serviceReports', 'report-review', terminal);
  const unavailable = await worker.fetch(
    request(`/service-jobs/${JOB_ID}/service-reports/report-review/approval-review`),
    env()
  );
  assert.equal(unavailable.status, 409);
}

{
  const store = new ReadMemoryStore();
  seedAccess(store);
  const report = await seedPending(store, 'report-corrupt', '2026-02-01T00:00:00.000Z');
  store.set('serviceReports', 'report-corrupt', {
    ...report,
    finalContentDigest: `sha256:v1:${'f'.repeat(64)}`,
  });
  const response = await handler(store).fetch(
    request('/service-reports/approval-queue'),
    env()
  );
  assert.equal(response.status, 409);
  assert.equal(((await body(response)).error as Record<string, unknown>).code,
    'approval_queue_integrity_incident');
}

{
  const store = new ReadMemoryStore();
  seedAccess(store);
  const worker = handler(store);
  for (const path of [
    '/service-reports/approval-queue?pageSize=0',
    '/service-reports/approval-queue?pageSize=51',
    '/service-reports/approval-queue?pageSize=1&pageSize=2',
    '/service-reports/approval-queue?unknown=1',
    '/service-reports/approval-queue?cursor=not*base64url',
    `/service-jobs/${JOB_ID}/service-reports?cursor=forbidden`,
  ]) {
    const response = await worker.fetch(request(path), env());
    assert.equal(response.status, 400, path);
  }
  assert.equal(store.approvalQueries.length, 0);
  assert.equal(store.historyQueries.length, 0);
  const maximum = await worker.fetch(
    request('/service-reports/approval-queue?pageSize=50'),
    env()
  );
  assert.equal(maximum.status, 200);
  assert.equal(store.approvalQueries.at(-1)?.pageSize, 50);
}

{
  const store = new ReadMemoryStore();
  seedAccess(store);
  const response = await handler(store).fetch(
    request(
      '/service-reports/approval-queue/report-number/not-valid?unknown=1',
      'invalid-token'
    ),
    env()
  );
  assert.equal(response.status, 401);
  assert.equal(store.approvalQueries.length, 0);
}

{
  const store = new ReadMemoryStore();
  store.set('staffProfiles', UID, { brandId: 'BRN', role: 'approver' });
  const response = await handler(store).fetch(
    request('/service-reports/approval-queue'),
    env()
  );
  assert.equal(response.status, 403);
  assert.equal(((await body(response)).error as Record<string, unknown>).code,
    'staff_access_denied');
}

{
  const store = new ReadMemoryStore();
  seedAccess(store);
  await seedPending(store, 'report-lookahead-valid', '2026-02-02T00:00:00.000Z');
  const corrupt = await seedPending(
    store,
    'report-lookahead-corrupt',
    '2026-02-01T00:00:00.000Z'
  );
  store.set('serviceReports', 'report-lookahead-corrupt', {
    ...corrupt,
    finalContentDigest: `sha256:v1:${'e'.repeat(64)}`,
  });
  const response = await handler(store).fetch(
    request('/service-reports/approval-queue?pageSize=1'),
    env()
  );
  assert.equal(response.status, 409);
  const result = await body(response);
  assert.equal('data' in result, false);
}

{
  const store = new ReadMemoryStore();
  seedAccess(store);
  await seedPending(store, 'report-missing-job', '2026-02-01T00:00:00.000Z');
  store.documents.delete(`serviceJobs/${JOB_ID}`);
  const response = await handler(store).fetch(
    request('/service-reports/approval-queue'),
    env()
  );
  assert.equal(response.status, 409);
}

{
  const store = new ReadMemoryStore();
  seedAccess(store);
  await seedPending(store, 'report-cursor-a', '2026-02-02T00:00:00.000Z');
  await seedPending(store, 'report-cursor-b', '2026-02-01T00:00:00.000Z');
  const worker = handler(store);
  const first = await worker.fetch(
    request('/service-reports/approval-queue?pageSize=1'),
    env()
  );
  const cursor = ((await body(first)).data as { nextCursor: string }).nextCursor;
  const mismatch = await worker.fetch(
    request(
      `/service-reports/approval-queue/report-number/FR-2026-000001?cursor=${cursor}`
    ),
    env()
  );
  assert.equal(mismatch.status, 400);
}

{
  class FailingStore extends ReadMemoryStore {
    override async queryApprovalQueue(_query: ApprovalQueueQuery): Promise<ReadStoredDocument[]> {
      throw new Error('synthetic dependency outage');
    }
  }
  const store = new FailingStore();
  seedAccess(store);
  const response = await handler(store).fetch(
    request('/service-reports/approval-queue'),
    env()
  );
  assert.equal(response.status, 503);
  assert.equal(((await body(response)).error as Record<string, unknown>).code,
    'dependency_unavailable');
}

{
  const missingStore = new ReadMemoryStore();
  seedAccess(missingStore);
  const foreignStore = new ReadMemoryStore();
  seedAccess(foreignStore);
  const foreign = await seedPending(
    foreignStore,
    'report-foreign-review',
    '2026-02-01T00:00:00.000Z'
  );
  foreignStore.set('serviceReports', 'report-foreign-review', {
    ...foreign,
    serviceJobId: 'JLC-2026-000001',
  });
  const missing = await handler(missingStore).fetch(
    request(`/service-jobs/${JOB_ID}/service-reports/report-missing/approval-review`),
    env()
  );
  const denied = await handler(foreignStore).fetch(
    request(`/service-jobs/${JOB_ID}/service-reports/report-foreign-review/approval-review`),
    env()
  );
  assert.equal(missing.status, 403);
  assert.deepEqual(masked(await body(missing)), masked(await body(denied)));
}

{
  const store = new ReadMemoryStore();
  seedAccess(store);
  await seedPending(store, 'report-private', '2026-02-01T00:00:00.000Z');
  const response = await handler(store).fetch(
    request('/service-reports/approval-queue'),
    env()
  );
  const item = ((await body(response)).data as {
    items: Record<string, unknown>[];
  }).items[0]!;
  for (const excluded of [
    'brandId', 'customerPhone', 'customerEmail', 'createdByUid',
    'finalizedByUid', 'currentApprovalEventId', 'approvalDecidedAt',
  ]) {
    assert.equal(excluded in item, false, excluded);
  }
}



// ---------------------------------------------------------------------------
// Phase 6R-A.1 — D24 coverage completion (Phase 4R.5 Finding 5)
// ---------------------------------------------------------------------------

const HISTORY_PATH = `/service-jobs/${JOB_ID}/service-reports`;

async function seedHistoryReport(
  store: ReadMemoryStore,
  reportId: string,
  overrides: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const memory = new MemoryV2Store();
  const report = await seedFinalReport(memory, {
    reportId,
    approvalState: 'pending',
    evidenceAttachmentIds: [],
  });
  const merged = { ...report, serviceJobId: JOB_ID, ...overrides };
  store.set('serviceReports', reportId, merged);
  return merged;
}

// Every Repair role, plus a roleless-but-valid core staff profile, may read
// ordinary history: D24 is not gated on the Approval Console role.
for (const role of ['technician', 'approver', 'admin'] as const) {
  const store = new ReadMemoryStore();
  seedAccess(store, role);
  await seedHistoryReport(store, 'report-role');
  const response = await handler(store).fetch(request(HISTORY_PATH), env());
  assert.equal(response.status, 200, `D24 ${role} history read`);
}

{
  const store = new ReadMemoryStore();
  seedAccess(store);
  store.set('staffProfiles', UID, { brandId: 'bruno-thailand' });
  await seedHistoryReport(store, 'report-roleless');
  const response = await handler(store).fetch(request(HISTORY_PATH), env());
  assert.equal(response.status, 200, 'D24 roleless valid core staff may read history');
}

// canImportProducts is Product Import authority only; it must not affect D24.
for (const capability of [true, false, 'true', 1, null]) {
  const store = new ReadMemoryStore();
  seedAccess(store);
  store.set('staffProfiles', UID, {
    brandId: 'bruno-thailand',
    role: 'technician',
    displayName: 'QA Staff',
    canImportProducts: capability,
  });
  await seedHistoryReport(store, 'report-capability');
  const response = await handler(store).fetch(request(HISTORY_PATH), env());
  assert.equal(
    response.status,
    200,
    `D24 history is independent of canImportProducts=${String(capability)}`
  );
}

{
  const store = new ReadMemoryStore();
  seedAccess(store);
  await seedHistoryReport(store, 'report-extra-query');
  const response = await handler(store).fetch(
    request(`${HISTORY_PATH}?unexpected=1`),
    env()
  );
  assert.equal(response.status, 400, 'D24 rejects unexpected query parameters');
  assert.equal(store.historyQueries.length, 0);
}

{
  const store = new ReadMemoryStore();
  seedAccess(store);
  await seedHistoryReport(store, 'report-empty-check');
  store.documents.delete('serviceReports/report-empty-check');
  const response = await handler(store).fetch(request(HISTORY_PATH), env());
  assert.equal(response.status, 200);
  const data = (await body(response)).data as { reports: unknown[] };
  assert.deepEqual(data.reports, [], 'D24 empty history returns an empty list');
}

{
  const store = new ReadMemoryStore();
  seedAccess(store);
  for (let index = 0; index < 50; index += 1) {
    await seedHistoryReport(store, `report-${String(index).padStart(3, '0')}`);
  }
  const response = await handler(store).fetch(request(HISTORY_PATH), env());
  assert.equal(response.status, 200, 'D24 exactly 50 rows is under the limit');
  assert.equal(((await body(response)).data as { reports: unknown[] }).reports.length, 50);
}

{
  const store = new ReadMemoryStore();
  seedAccess(store);
  for (let index = 0; index < 51; index += 1) {
    await seedHistoryReport(store, `report-${String(index).padStart(3, '0')}`);
  }
  const response = await handler(store).fetch(request(HISTORY_PATH), env());
  assert.equal(response.status, 409, 'D24 51 rows exceeds the limit');
  assert.equal(
    ((await body(response)).error as Record<string, unknown>).code,
    'history_limit_exceeded'
  );
}

// Finding 3 regression: the sentinel is decided on COUNT, before parsing, so a
// malformed row inside an over-limit page cannot turn this into an integrity
// incident.
{
  const store = new ReadMemoryStore();
  seedAccess(store);
  for (let index = 0; index < 50; index += 1) {
    await seedHistoryReport(store, `report-${String(index).padStart(3, '0')}`);
  }
  store.set('serviceReports', 'report-050', {
    serviceJobId: JOB_ID,
    schemaVersion: 2,
    status: 'not-a-status',
    reportNo: 'nonsense',
  });
  const response = await handler(store).fetch(request(HISTORY_PATH), env());
  assert.equal(response.status, 409, '51 rows incl. malformed still exceeds the limit');
  assert.equal(
    ((await body(response)).error as Record<string, unknown>).code,
    'history_limit_exceeded',
    'a malformed row inside an over-limit page must NOT surface as history_integrity_incident'
  );
}

{
  const store = new ReadMemoryStore();
  seedAccess(store);
  await seedHistoryReport(store, 'report-brand-mismatch', { brandId: 'join-lux-club' });
  const response = await handler(store).fetch(request(HISTORY_PATH), env());
  assert.equal(response.status, 409, 'D24 projected-brand mismatch is an integrity incident');
  assert.equal(
    ((await body(response)).error as Record<string, unknown>).code,
    'history_integrity_incident'
  );
}

{
  const store = new ReadMemoryStore();
  seedAccess(store);
  store.queryHistory = async () => {
    throw new Error('dependency down');
  };
  const response = await handler(store).fetch(request(HISTORY_PATH), env());
  assert.ok(response.status >= 500, 'D24 dependency failure is not a 2xx');
}

// Deterministic ordinal ordering, independent of host locale.
{
  const store = new ReadMemoryStore();
  seedAccess(store);
  await seedHistoryReport(store, 'report-b', {
    createdAt: '2026-01-01T00:00:00.000Z',
    reportNo: 'FR-2026-000010',
  });
  await seedHistoryReport(store, 'report-a', {
    createdAt: '2026-01-01T00:00:00.000Z',
    reportNo: 'FR-2026-000002',
  });
  const response = await handler(store).fetch(request(HISTORY_PATH), env());
  const reports = ((await body(response)).data as { reports: { reportNo: string }[] }).reports;
  assert.deepEqual(
    reports.map((report) => report.reportNo),
    ['FR-2026-000002', 'FR-2026-000010'],
    'ties on createdAt order by reportNo in ordinal order'
  );
}

{
  const store = new ReadMemoryStore();
  seedAccess(store);
  await seedHistoryReport(store, 'report-no-store');
  const response = await handler(store).fetch(request(HISTORY_PATH), env());
  assert.equal(response.headers.get('Cache-Control'), 'no-store', 'D24 is never cached');
  const item = ((await body(response)).data as {
    reports: Record<string, unknown>[];
  }).reports[0]!;
  for (const excluded of ['customerPhone', 'customerEmail', 'createdByUid', 'finalizedByUid']) {
    assert.equal(excluded in item, false, `D24 DTO must not expose ${excluded}`);
  }
}

console.log('Phase 3R.4B Service Report read contracts passed');

// ---------------------------------------------------------------------------
// Phase 6R-A.1 — D25 coverage completion (Phase 4R.5 Finding 5)
// ---------------------------------------------------------------------------

const QUEUE_PATH = '/service-reports/approval-queue';

function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function reviewPath(reportId: string, jobId = JOB_ID): string {
  return `/service-jobs/${jobId}/service-reports/${reportId}/approval-review`;
}

// Role matrix: approver and admin reach the console, technician and a roleless
// core profile do not.
for (const [role, expected] of [
  ['approver', 200],
  ['admin', 200],
  ['technician', 403],
] as const) {
  const store = new ReadMemoryStore();
  seedAccess(store, role);
  const response = await handler(store).fetch(request(QUEUE_PATH), env());
  assert.equal(response.status, expected, `D25 ${role} queue access`);
}

{
  const store = new ReadMemoryStore();
  seedAccess(store);
  store.set('staffProfiles', UID, { brandId: 'bruno-thailand' });
  const response = await handler(store).fetch(request(QUEUE_PATH), env());
  assert.equal(response.status, 403, 'D25 roleless core staff is denied the console');
}

// The Approval Console role is orthogonal to Product Import capability.
for (const capability of [true, false, 'true', 1, null]) {
  const store = new ReadMemoryStore();
  seedAccess(store);
  store.set('staffProfiles', UID, {
    brandId: 'bruno-thailand',
    role: 'approver',
    displayName: 'QA Approver',
    canImportProducts: capability,
  });
  const response = await handler(store).fetch(request(QUEUE_PATH), env());
  assert.equal(
    response.status,
    200,
    `D25 console access is independent of canImportProducts=${String(capability)}`
  );
}

// Page-size boundaries: 1 and 50 are accepted; 0, 51, and non-numeric are not.
for (const [pageSize, expected] of [
  ['1', 200],
  ['50', 200],
  ['0', 400],
  ['51', 400],
  ['10.5', 400],
  ['abc', 400],
  ['-1', 400],
  ['', 400],
] as const) {
  const store = new ReadMemoryStore();
  seedAccess(store);
  const response = await handler(store).fetch(
    request(`${QUEUE_PATH}?pageSize=${pageSize}`),
    env()
  );
  assert.equal(response.status, expected, `D25 pageSize=${pageSize}`);
}

{
  const store = new ReadMemoryStore();
  seedAccess(store);
  const response = await handler(store).fetch(request(`${QUEUE_PATH}?nope=1`), env());
  assert.equal(response.status, 400, 'D25 rejects an unexpected query parameter');
  assert.equal(store.approvalQueries.length, 0);
}

// Tied finalizedAt must break by reportId descending, deterministically.
{
  const store = new ReadMemoryStore();
  seedAccess(store);
  await seedPending(store, 'report-tie-a', '2026-02-01T00:00:00.000Z');
  await seedPending(store, 'report-tie-b', '2026-02-01T00:00:00.000Z');
  const response = await handler(store).fetch(request(QUEUE_PATH), env());
  assert.equal(response.status, 200);
  const items = ((await body(response)).data as { items: { reportId: string }[] }).items;
  assert.deepEqual(
    items.map((item) => item.reportId),
    ['report-tie-b', 'report-tie-a'],
    'tied finalizedAt breaks by reportId descending'
  );
}

// Cursor grammar: only the exact canonical encoding for this mode/search is
// accepted. Anything re-encoded, re-ordered, or mode-mismatched is refused.
{
  const store = new ReadMemoryStore();
  seedAccess(store);
  const canonical = {
    v: 1,
    mode: 'queue',
    search: null,
    finalizedAt: '2026-02-01T00:00:00.000Z',
    reportId: 'report-cursor',
  };
  const accepted = await handler(store).fetch(
    request(`${QUEUE_PATH}?cursor=${encodeCursor(canonical)}`),
    env()
  );
  assert.equal(accepted.status, 200, 'D25 accepts a canonical cursor');

  const rejected = [
    { ...canonical, v: 2 },
    { ...canonical, mode: 'report-number' },
    { ...canonical, search: 'FR-2026-000001' },
    { ...canonical, finalizedAt: 'not-a-timestamp' },
    { ...canonical, reportId: 'not/valid' },
    { ...canonical, extra: true },
    { mode: 'queue', search: null, finalizedAt: canonical.finalizedAt, reportId: 'report-cursor' },
    // Same fields, non-canonical key order — must not round-trip.
    {
      reportId: 'report-cursor',
      finalizedAt: '2026-02-01T00:00:00.000Z',
      search: null,
      mode: 'queue',
      v: 1,
    },
  ];
  for (const candidate of rejected) {
    const response = await handler(store).fetch(
      request(`${QUEUE_PATH}?cursor=${encodeCursor(candidate)}`),
      env()
    );
    assert.equal(
      response.status,
      400,
      `D25 rejects non-canonical cursor ${JSON.stringify(candidate)}`
    );
  }

  for (const malformed of ['not-base64!!', 'e30', 'bnVsbA', '']) {
    const response = await handler(store).fetch(
      request(`${QUEUE_PATH}?cursor=${malformed}`),
      env()
    );
    assert.equal(response.status, 400, `D25 rejects malformed cursor "${malformed}"`);
  }
}

// A cursor minted for one mode must not be replayable against another mode.
{
  const store = new ReadMemoryStore();
  seedAccess(store);
  const queueCursor = encodeCursor({
    v: 1,
    mode: 'queue',
    search: null,
    finalizedAt: '2026-02-01T00:00:00.000Z',
    reportId: 'report-cursor',
  });
  const response = await handler(store).fetch(
    request(`${QUEUE_PATH}/report-number/FR-2026-000001?cursor=${queueCursor}`),
    env()
  );
  assert.equal(response.status, 400, 'D25 refuses a cursor minted for a different mode');
}

// Report-number normalization boundaries.
for (const [reportNo, expected] of [
  ['FR-2026-000001', 200],
  ['fr-2026-000001', 200],
  ['FR-2026-00001', 400],
  ['FR-2026-0000001', 400],
  ['FR-202X-000001', 400],
  ['not-a-number', 400],
] as const) {
  const store = new ReadMemoryStore();
  seedAccess(store);
  const response = await handler(store).fetch(
    request(`${QUEUE_PATH}/report-number/${encodeURIComponent(reportNo)}`),
    env()
  );
  assert.equal(response.status, expected, `D25 report-number "${reportNo}"`);
}

// Tracking-reference boundaries: case is significant, byte length is bounded.
{
  const store = new ReadMemoryStore();
  seedAccess(store);
  const ok = await handler(store).fetch(
    request(`${QUEUE_PATH}/tracking-reference/BRN-2026-000001`),
    env()
  );
  assert.equal(ok.status, 200, 'D25 accepts a valid tracking reference');
  for (const candidate of ['a'.repeat(200), 'has space', 'ห้อง']) {
    const response = await handler(store).fetch(
      request(`${QUEUE_PATH}/tracking-reference/${encodeURIComponent(candidate)}`),
      env()
    );
    assert.equal(response.status, 400, `D25 rejects tracking reference "${candidate}"`);
  }
}

// Search mismatch returns an empty page, never another report.
{
  const store = new ReadMemoryStore();
  seedAccess(store);
  await seedPending(store, 'report-mismatch', '2026-02-01T00:00:00.000Z');
  const response = await handler(store).fetch(
    request(`${QUEUE_PATH}/report-number/FR-2026-999999`),
    env()
  );
  assert.equal(response.status, 200);
  assert.deepEqual(
    ((await body(response)).data as { items: unknown[] }).items,
    [],
    'D25 search mismatch is an empty page'
  );
}

// Review/detail binding: the review is bound to its authoritative Service Job,
// and a foreign job cannot be used to reach it.
{
  const store = new ReadMemoryStore();
  seedAccess(store);
  await seedPending(store, 'report-bound', '2026-02-01T00:00:00.000Z');
  const bound = await handler(store).fetch(request(reviewPath('report-bound')), env());
  assert.equal(bound.status, 200, 'D25 review resolves under its own Service Job');
  const review = (await body(bound)).data as Record<string, unknown>;
  assert.equal(review.reportId, 'report-bound');
  assert.equal(review.serviceJobId, JOB_ID);
  assert.equal(typeof review.finalContentDigest, 'string');

  const foreign = await handler(store).fetch(
    request(reviewPath('report-bound', 'BRN-2026-000999')),
    env()
  );
  assert.ok(foreign.status >= 400, 'D25 review is not reachable via a foreign Service Job');
}

{
  const store = new ReadMemoryStore();
  seedAccess(store);
  await seedPending(store, 'report-no-store-d25', '2026-02-01T00:00:00.000Z');
  const response = await handler(store).fetch(
    request(reviewPath('report-no-store-d25')),
    env()
  );
  assert.equal(response.headers.get('Cache-Control'), 'no-store', 'D25 review is never cached');
  const review = (await body(response)).data as Record<string, unknown>;
  for (const excluded of ['customerPhone', 'customerEmail', 'createdByUid', 'finalizedByUid']) {
    assert.equal(excluded in review, false, `D25 review DTO must not expose ${excluded}`);
  }
}

// Batch resolution robustness: the harness deliberately returns batch results
// reversed, so correctness cannot depend on result ordering.
{
  const store = new ReadMemoryStore();
  seedAccess(store);
  await seedPending(store, 'report-batch-a', '2026-02-03T00:00:00.000Z');
  await seedPending(store, 'report-batch-b', '2026-02-02T00:00:00.000Z');
  await seedPending(store, 'report-batch-c', '2026-02-01T00:00:00.000Z');
  const response = await handler(store).fetch(request(QUEUE_PATH), env());
  assert.equal(response.status, 200);
  const items = ((await body(response)).data as { items: { reportId: string }[] }).items;
  assert.deepEqual(
    items.map((item) => item.reportId),
    ['report-batch-a', 'report-batch-b', 'report-batch-c'],
    'D25 tolerates unordered batch results and preserves query order'
  );
  assert.equal(
    new Set(items.map((item) => item.reportId)).size,
    items.length,
    'D25 never emits a duplicate report identity'
  );
}

console.log('Phase 6R-A.1 D25 read contracts passed');

// ---------------------------------------------------------------------------
// Phase 6R-A.1 corrective continuation — D25 batch-resolution integrity.
//
// The queue route resolves every referenced Service Job through one batchGet
// and then requires the response to correspond EXACTLY to what it asked for:
// same count, every id requested, no id twice. A divergent batch is an
// integrity incident that aborts the WHOLE request — never a partial page and
// never a silently dropped row. (The review route resolves single documents,
// so it has no batch seam; its equivalent binding is covered separately.)
// ---------------------------------------------------------------------------

async function queueWithTwoJobs(): Promise<{
  store: ReadMemoryStore;
  jobA: string;
  jobB: string;
}> {
  const store = new ReadMemoryStore();
  seedAccess(store);
  const jobB = 'BRN-2026-000002';
  store.set('serviceJobs', jobB, {
    brandId: 'bruno-thailand',
    customerName: 'QA Customer B',
    status: 'Received',
  });
  await seedPending(store, 'report-batch-job-a', '2026-02-02T00:00:00.000Z');
  // Job B's report is seeded with its own identity up front. Patching
  // serviceJobId afterwards would invalidate the report's own final digest and
  // make the fixture an integrity incident before any divergence is injected.
  const memory = new MemoryV2Store();
  const second = await seedFinalReport(memory, {
    reportId: 'report-batch-job-b',
    approvalState: 'pending',
    evidenceAttachmentIds: [],
    now: '2026-02-01T00:00:00.000Z',
    serviceJobId: jobB,
    reportNo: 'FR-2026-000002',
  });
  store.set('serviceReports', 'report-batch-job-b', second);
  return { store, jobA: JOB_ID, jobB };
}

async function expectQueueIntegrityIncident(
  store: ReadMemoryStore,
  label: string
): Promise<void> {
  const response = await handler(store).fetch(request(QUEUE_PATH), env());
  assert.equal(response.status, 409, label);
  const payload = await body(response);
  assert.equal(
    (payload.error as Record<string, unknown>).code,
    'approval_queue_integrity_incident',
    label
  );
  // The whole request aborts: no partial page is emitted alongside the error.
  assert.equal(payload.ok, false, label);
  assert.equal('data' in payload, false, `${label} must not return partial data`);
}

// Sanity: the same fixture succeeds when the batch response is faithful, so a
// later failure is attributable to the injected divergence and nothing else.
{
  const { store } = await queueWithTwoJobs();
  const response = await handler(store).fetch(request(QUEUE_PATH), env());
  assert.equal(response.status, 200, 'D25 faithful two-job batch resolves normally');
  const items = ((await body(response)).data as { items: { reportId: string }[] }).items;
  assert.deepEqual(
    items.map((item) => item.reportId),
    ['report-batch-job-a', 'report-batch-job-b'],
    'D25 baseline two-job queue order'
  );
}

// 1. MISSING batch result — one expected Service Job is absent from the batch.
{
  const { store, jobB } = await queueWithTwoJobs();
  store.batchGetDivergence = (found) =>
    found.filter((document) => document.id !== jobB);
  await expectQueueIntegrityIncident(
    store,
    'D25 a missing Service Job batch result aborts the queue request'
  );
}

// 2. DUPLICATE result — the same Service Job comes back twice. Count still
//    matches, so this can only be caught by per-id duplicate detection.
{
  const { store, jobA, jobB } = await queueWithTwoJobs();
  store.batchGetDivergence = (found) => {
    const first = found.find((document) => document.id === jobA);
    assert.ok(first, 'fixture must contain job A');
    return found
      .filter((document) => document.id !== jobB)
      .concat([{ ...first, data: { ...first.data } }]);
  };
  await expectQueueIntegrityIncident(
    store,
    'D25 a duplicated Service Job batch result aborts the queue request'
  );
}

// 3. UNEXPECTED result — a Service Job that was never requested is returned.
//    Count still matches, so only membership checking can catch it.
{
  const { store, jobB } = await queueWithTwoJobs();
  store.batchGetDivergence = (found) =>
    found
      .filter((document) => document.id !== jobB)
      .concat([
        {
          collection: 'serviceJobs',
          id: 'BRN-2026-000999',
          data: {
            brandId: 'bruno-thailand',
            customerName: 'Never requested',
            status: 'Received',
          },
        },
      ]);
  await expectQueueIntegrityIncident(
    store,
    'D25 an unrequested Service Job batch result aborts the queue request'
  );
}

// 2b. DUPLICATE on top of a COMPLETE batch. Every requested job is present, so
//     the downstream per-report brand check resolves cleanly and cannot notice
//     anything wrong — only the batch-correspondence guard can reject this.
{
  const { store, jobA } = await queueWithTwoJobs();
  store.batchGetDivergence = (found) => {
    const first = found.find((document) => document.id === jobA);
    assert.ok(first, 'fixture must contain job A');
    return found.concat([{ ...first, data: { ...first.data } }]);
  };
  await expectQueueIntegrityIncident(
    store,
    'D25 a duplicate on top of a complete batch aborts the queue request'
  );
}

// 3b. An extra result ON TOP of a complete batch (count too high) must abort
//     too, and is likewise invisible to every downstream check.
{
  const { store } = await queueWithTwoJobs();
  store.batchGetDivergence = (found) =>
    found.concat([
      {
        collection: 'serviceJobs',
        id: 'BRN-2026-000998',
        data: {
          brandId: 'bruno-thailand',
          customerName: 'Surplus',
          status: 'Received',
        },
      },
    ]);
  await expectQueueIntegrityIncident(
    store,
    'D25 a surplus Service Job batch result aborts the queue request'
  );
}

// Regression guard: with the seam unused, faithful-but-unordered batches still
// resolve, so the divergence hook cannot mask ordinary behavior.
{
  const { store } = await queueWithTwoJobs();
  store.batchGetDivergence = (found) => [...found].reverse();
  const response = await handler(store).fetch(request(QUEUE_PATH), env());
  assert.equal(response.status, 200, 'D25 a reordered faithful batch still resolves');
  const items = ((await body(response)).data as { items: { reportId: string }[] }).items;
  assert.deepEqual(
    items.map((item) => item.reportId),
    ['report-batch-job-a', 'report-batch-job-b'],
    'D25 result order is derived from the query, not the batch response order'
  );
}

console.log('Phase 6R-A.1 D25 batch integrity contracts passed');

// ---------------------------------------------------------------------------
// Phase 6R-A.2 — D24/D25 security-contract completion (Phase 4R.5R Finding 3)
//
// Everything below is behavioral: real Requests against the real dispatcher,
// with instrumented doubles rather than source assertions. The no-side-effect
// proofs are instrumentation, not regex — an R2 or write-client touch throws,
// unmediated network I/O throws, and every store method and collection the
// route reaches is recorded and asserted against an allow-list.
// ---------------------------------------------------------------------------

function requestWith(path: string, headers: Record<string, string>): Request {
  return new Request(`http://worker.test${path}`, {
    method: 'GET',
    headers: { Authorization: 'Bearer valid-token', ...headers },
  });
}

// undici refuses to construct a GET carrying a body, so the actual-body branch
// of requireEmptyBody is reached through a Request whose only altered member is
// its method. Everything else — headers, url, body, arrayBuffer — is the real
// Request's.
function bodiedGet(path: string): Request {
  const target = new Request(`http://worker.test${path}`, {
    method: 'POST',
    body: '{"injected":true}',
    headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' },
  });
  return new Proxy(target, {
    // The real Request is the receiver: forwarding the proxy as receiver
    // would break the private fields undici's accessors read.
    get(source, property) {
      if (property === 'method') return 'GET';
      const value = Reflect.get(source, property);
      return typeof value === 'function' ? value.bind(source) : value;
    },
  }) as Request;
}

function legacyReport(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    serviceJobId: JOB_ID,
    reportNo: 'FR-2026-000001',
    status: 'draft',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    finalizedAt: null,
    technician: 'QA Technician',
    customerReportedProblem: 'Problem',
    inspectionFindings: '',
    serviceActions: [],
    parts: [],
    technicianRemark: '',
    resultStatus: null,
    resultDetail: '',
    evidenceAttachmentIds: [],
    claimNo: null,
    factoryReference: null,
    snapshot: null,
    ...overrides,
  };
}

async function pendingReport(
  reportId: string,
  options: {
    approvalState?: 'pending' | 'approved' | 'rejected';
    serviceJobId?: string;
    brandId?: string;
    now?: string;
  } = {}
): Promise<Record<string, unknown>> {
  return await seedFinalReport(new MemoryV2Store(), {
    reportId,
    approvalState: options.approvalState ?? 'pending',
    evidenceAttachmentIds: [],
    now: options.now ?? '2026-02-01T00:00:00.000Z',
    ...(options.serviceJobId ? { serviceJobId: options.serviceJobId } : {}),
    ...(options.brandId ? { brandId: options.brandId } : {}),
  });
}

function asDocument(reportId: string, data: Record<string, unknown>): ReadStoredDocument {
  return { collection: 'serviceReports', id: reportId, data };
}

async function errorCode(response: Response): Promise<string> {
  return String(((await body(response)).error as Record<string, unknown>).code);
}

async function expectRead(
  response: Response,
  status: number,
  code: string,
  label: string
): Promise<void> {
  assert.equal(response.status, status, `${label} status`);
  assert.equal(await errorCode(response), code, `${label} code`);
  assert.equal(
    response.headers.get('Cache-Control'),
    'no-store',
    `${label} must stay no-store even when it fails`
  );
}

// Records every store method and every collection the route reaches, so the
// absence of a write path is asserted against an allow-list rather than assumed.
function recordingStore(store: ReadMemoryStore) {
  const methods: string[] = [];
  const collections: string[] = [];
  const wrapped = new Proxy(store, {
    get(source, property) {
      const value = Reflect.get(source, property);
      if (typeof value !== 'function') return value;
      const name = String(property);
      return (...args: unknown[]) => {
        methods.push(name);
        if (name === 'get') collections.push(String(args[0]));
        if (name === 'batchGet') {
          for (const address of args[0] as { collection: string }[]) {
            collections.push(address.collection);
          }
        }
        if (name === 'queryHistory' || name === 'queryApprovalQueue') {
          collections.push('serviceReports');
        }
        return (value as (...rest: unknown[]) => unknown).apply(source, args);
      };
    },
  });
  return { wrapped: wrapped as unknown as ReadMemoryStore, methods, collections };
}

// Any R2 access, any write-side Firestore client construction or call, and any
// direct network I/O all fail loudly instead of passing silently.
function guardedEnv(touched: string[]): Env {
  return {
    ...env(),
    ATTACHMENTS_BUCKET: new Proxy({}, {
      get(_source, property) {
        touched.push(`r2:${String(property)}`);
        throw new Error('a read route must never touch R2');
      },
    }) as R2Bucket,
  };
}

function guardedHandler(store: ReadMemoryStore, touched: string[]) {
  const dependencies: WorkerDependencies = {
    tokenVerifier: {
      async verify(token) {
        if (token !== 'valid-token') throw new Error('invalid');
        return { uid: UID };
      },
    },
    createFirestoreClient: () => {
      touched.push('firestore:construct');
      return new Proxy({}, {
        get(_source, property) {
          touched.push(`firestore:${String(property)}`);
          throw new Error('a read route must never use the write-side client');
        },
      }) as FirestoreClient;
    },
    createServiceReportReadStore: () => store,
  };
  return createWorkerHandler(dependencies);
}

async function withoutNetwork<T>(run: () => Promise<T>): Promise<T> {
  const global = globalThis as { fetch: typeof fetch };
  const original = global.fetch;
  let calls = 0;
  global.fetch = (() => {
    calls += 1;
    throw new Error('a read route must not perform unmediated network I/O');
  }) as typeof fetch;
  try {
    const result = await run();
    assert.equal(calls, 0, 'a read route performs no direct fetch');
    return result;
  } finally {
    global.fetch = original;
  }
}

// Proves the route reached only read methods on only read collections, touched
// no R2 and no write-side client, and issued no network call of its own. That
// covers transactions, commits, idempotency writes, approval events, successor
// operations, retention/deletion mutations, Product Import, and Public Tracking
// credential operations in one instrumented pass.
async function expectNoSideEffects(
  store: ReadMemoryStore,
  path: string,
  allowedMethods: readonly string[],
  label: string
): Promise<Response> {
  const touched: string[] = [];
  const recorder = recordingStore(store);
  const response = await withoutNetwork(() =>
    guardedHandler(recorder.wrapped, touched).fetch(request(path), guardedEnv(touched))
  );
  assert.equal(response.status, 200, `${label} succeeds`);
  assert.deepEqual(touched, [], `${label} touches no R2 and no write-side client`);
  assert.deepEqual(
    [...new Set(recorder.methods)].sort(),
    [...allowedMethods].sort(),
    `${label} uses read methods only`
  );
  assert.deepEqual(
    [...new Set(recorder.collections)].sort(),
    ['serviceJobs', 'serviceReports', 'staffProfiles'],
    `${label} reads no collection outside the authorized read set`
  );
  return response;
}

// --- D24: method and body dispatch ------------------------------------------

{
  const store = new ReadMemoryStore();
  seedAccess(store, 'technician');
  const worker = handler(store);
  for (const [label, declared] of [
    ['a declared non-empty body', '12'],
    ['a malformed Content-Length', 'not-a-number'],
  ] as const) {
    const response = await worker.fetch(
      requestWith(HISTORY_PATH, { 'Content-Length': declared }),
      env()
    );
    await expectRead(response, 400, 'invalid_request', `D24 GET with ${label}`);
  }
  assert.equal(store.historyQueries.length, 0, 'D24 a bodied GET never reaches the query');
}

{
  const store = new ReadMemoryStore();
  seedAccess(store, 'technician');
  const response = await handler(store).fetch(bodiedGet(HISTORY_PATH), env());
  await expectRead(response, 400, 'invalid_request', 'D24 authenticated GET with a real body');
  assert.equal(store.historyQueries.length, 0);
}

// GET and POST on the SAME Service Job path reach different handlers: only GET
// reaches the read store, and POST is never served by the read path.
{
  const store = new ReadMemoryStore();
  seedAccess(store, 'technician');
  store.set('serviceReports', 'report-dispatch', legacyReport());
  const worker = handler(store);

  const read = await worker.fetch(request(HISTORY_PATH), env());
  assert.equal(read.status, 200, 'D24 GET dispatches to the history read');
  assert.equal(store.historyQueries.length, 1);

  const write = await worker.fetch(
    new Request(`http://worker.test${HISTORY_PATH}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' },
      body: '{}',
    }),
    env()
  );
  assert.notEqual(write.status, 200, 'D24 POST is not served by the read path');
  assert.equal(
    store.historyQueries.length,
    1,
    'D24 POST on the same path never reaches the read store'
  );
}

// --- D24: malformed and partial documents BELOW the 51-row sentinel ----------

{
  const store = new ReadMemoryStore();
  seedAccess(store, 'technician');
  store.set('serviceReports', 'report-ok', legacyReport());
  const control = await handler(store).fetch(request(HISTORY_PATH), env());
  assert.equal(control.status, 200, 'D24 the baseline V1 fixture is accepted');
}

for (const [label, document] of [
  ['malformed V1', legacyReport({ serviceActions: 'repair' })],
  ['partial V1', (() => {
    const row = legacyReport();
    delete row.factoryReference;
    return row;
  })()],
  ['V1 with an unexpected extra field', legacyReport({ unexpected: true })],
  ['an unsupported schemaVersion', legacyReport({ schemaVersion: 3 })],
] as const) {
  const store = new ReadMemoryStore();
  seedAccess(store, 'technician');
  store.set('serviceReports', 'report-ok', legacyReport());
  store.set('serviceReports', 'report-bad', document as Record<string, unknown>);
  const response = await handler(store).fetch(request(HISTORY_PATH), env());
  await expectRead(
    response,
    409,
    'history_integrity_incident',
    `D24 ${label} below the sentinel`
  );
  assert.equal(
    store.historyQueries.length,
    1,
    `D24 ${label} is refused after exactly one bounded query`
  );
}

{
  const malformed = await pendingReport('report-v2-bad');
  malformed.contentRevision = 'one';
  const partial = await pendingReport('report-v2-partial');
  delete partial.finalizedFromRevision;
  for (const [label, document] of [
    ['malformed V2', malformed],
    ['partial V2', partial],
  ] as const) {
    const store = new ReadMemoryStore();
    seedAccess(store, 'technician');
    store.set('serviceReports', 'report-v2', document);
    const response = await handler(store).fetch(request(HISTORY_PATH), env());
    await expectRead(
      response,
      409,
      'history_integrity_incident',
      `D24 ${label} below the sentinel`
    );
  }
}

// The route re-verifies identity and brand itself: a row the query should never
// have returned is refused rather than trusted.
{
  const store = new ReadMemoryStore();
  seedAccess(store, 'technician');
  const foreign = await pendingReport('report-foreign-job', {
    serviceJobId: 'BRN-2026-000777',
  });
  store.historyDivergence = () => [asDocument('report-foreign-job', foreign)];
  const response = await handler(store).fetch(request(HISTORY_PATH), env());
  await expectRead(
    response,
    409,
    'history_integrity_incident',
    'D24 a report bound to another Service Job'
  );
}

{
  const store = new ReadMemoryStore();
  seedAccess(store, 'technician');
  const foreignBrand = await pendingReport('report-foreign-brand', {
    brandId: 'join-lux-club',
  });
  store.set('serviceReports', 'report-foreign-brand', foreignBrand);
  const response = await handler(store).fetch(request(HISTORY_PATH), env());
  await expectRead(
    response,
    409,
    'history_integrity_incident',
    'D24 a projected V2 report whose brand disagrees with the Service Job'
  );
}

// --- D24: dependency failure, no-store, privacy, and no side effects ---------

{
  const store = new ReadMemoryStore();
  seedAccess(store, 'technician');
  store.get = async () => {
    throw new Error('firestore unavailable');
  };
  const response = await handler(store).fetch(request(HISTORY_PATH), env());
  await expectRead(response, 503, 'dependency_unavailable', 'D24 dependency failure');
}

{
  const store = new ReadMemoryStore();
  const worker = handler(store);
  await expectRead(
    await worker.fetch(request(HISTORY_PATH, ''), env()),
    401,
    'authentication_required',
    'D24 unauthenticated'
  );
  seedAccess(store, 'technician');
  store.set('staffProfiles', UID, { brandId: 'join-lux-club', role: 'technician' });
  await expectRead(
    await worker.fetch(request(HISTORY_PATH), env()),
    403,
    'service_job_access_denied',
    'D24 cross-brand Service Job'
  );
}

{
  const store = new ReadMemoryStore();
  seedAccess(store, 'technician');
  store.set('serviceReports', 'report-privacy', await pendingReport('report-privacy'));
  const response = await handler(store).fetch(request(HISTORY_PATH), env());
  assert.equal(response.status, 200);
  const serialized = JSON.stringify((await body(response)).data);
  for (const forbidden of [
    'createdByUid', 'finalizedByUid', 'brandId', 'schemaVersion',
    'currentApprovalEventId', 'approvalDecidedAt', 'activeDraftGeneration',
  ]) {
    assert.equal(
      serialized.includes(forbidden),
      false,
      `D24 the history DTO must not expose ${forbidden}`
    );
  }
}

{
  const store = new ReadMemoryStore();
  seedAccess(store, 'technician');
  store.set('serviceReports', 'report-clean', legacyReport());
  const response = await expectNoSideEffects(
    store,
    HISTORY_PATH,
    ['get', 'queryHistory'],
    'D24 history read'
  );
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
}

console.log('Phase 6R-A.2 D24 security contracts passed');

// --- D25: method and body dispatch ------------------------------------------

{
  const store = new ReadMemoryStore();
  seedAccess(store);
  await seedPending(store, 'report-body', '2026-02-01T00:00:00.000Z');
  const worker = handler(store);
  for (const path of [QUEUE_PATH, reviewPath('report-body')]) {
    await expectRead(
      await worker.fetch(bodiedGet(path), env()),
      400,
      'invalid_request',
      `D25 authenticated GET with a real body on ${path}`
    );
    await expectRead(
      await worker.fetch(requestWith(path, { 'Content-Length': '9' }), env()),
      400,
      'invalid_request',
      `D25 declared body on ${path}`
    );
  }
  assert.equal(store.approvalQueries.length, 0, 'D25 a bodied GET never reaches the query');
}

// --- D25: authoritative Service Job integrity -------------------------------

for (const [label, divergence] of [
  ['an unparseable brand', { brandId: 'not-a-brand', customerName: 'QA', status: 'Received' }],
  ['a missing brand', { customerName: 'QA', status: 'Received' }],
  ['a self-disagreeing id', {
    id: 'BRN-2026-000999', brandId: 'bruno-thailand', customerName: 'QA', status: 'Received',
  }],
] as const) {
  const store = new ReadMemoryStore();
  seedAccess(store);
  await seedPending(store, 'report-job-integrity', '2026-02-01T00:00:00.000Z');
  store.batchGetDivergence = () => [
    { collection: 'serviceJobs', id: JOB_ID, data: divergence as Record<string, unknown> },
  ];
  await expectRead(
    await handler(store).fetch(request(QUEUE_PATH), env()),
    409,
    'approval_queue_integrity_incident',
    `D25 a malformed authoritative Service Job batch result with ${label}`
  );
}

{
  const store = new ReadMemoryStore();
  seedAccess(store);
  await seedPending(store, 'report-wrong-collection', '2026-02-01T00:00:00.000Z');
  store.batchGetDivergence = () => [
    {
      collection: 'serviceReports',
      id: JOB_ID,
      data: { brandId: 'bruno-thailand', customerName: 'QA', status: 'Received' },
    },
  ];
  await expectRead(
    await handler(store).fetch(request(QUEUE_PATH), env()),
    409,
    'approval_queue_integrity_incident',
    'D25 an authoritative Service Job returned from the wrong collection'
  );
}

// A report whose own brand disagrees with the authoritative Service Job is
// refused even when that Service Job matches the reviewer's brand — the route
// does not trust the query's brand filter.
{
  const store = new ReadMemoryStore();
  seedAccess(store);
  const foreignBrand = await pendingReport('report-brand-split', {
    brandId: 'join-lux-club',
  });
  store.approvalQueueDivergence = () => [asDocument('report-brand-split', foreignBrand)];
  await expectRead(
    await handler(store).fetch(request(QUEUE_PATH), env()),
    409,
    'approval_queue_integrity_incident',
    'D25 a projected report brand that disagrees with the authoritative Service Job'
  );
}

// --- D25: lifecycle and identity matrix -------------------------------------

for (const [label, state] of [
  ['approved', 'approved'],
  ['rejected', 'rejected'],
] as const) {
  const store = new ReadMemoryStore();
  seedAccess(store);
  store.set(
    'serviceReports',
    'report-terminal',
    await pendingReport('report-terminal', { approvalState: state })
  );
  await expectRead(
    await handler(store).fetch(request(reviewPath('report-terminal')), env()),
    409,
    'approval_review_unavailable',
    `D25 a review already ${label}`
  );
}

{
  const store = new ReadMemoryStore();
  seedAccess(store);
  const corrupted = await pendingReport('report-lifecycle');
  corrupted.approvalState = 'PENDING';
  store.set('serviceReports', 'report-lifecycle', corrupted);
  await expectRead(
    await handler(store).fetch(request(reviewPath('report-lifecycle')), env()),
    403,
    'approval_console_access_denied',
    'D25 a non-canonical lifecycle state'
  );
}

{
  const store = new ReadMemoryStore();
  seedAccess(store);
  const mismatched = await pendingReport('report-identity');
  store.set('serviceReports', 'report-stored-under-other-id', mismatched);
  await expectRead(
    await handler(store).fetch(request(reviewPath('report-stored-under-other-id')), env()),
    403,
    'approval_console_access_denied',
    'D25 a reportId that disagrees with its document id'
  );
}

{
  const store = new ReadMemoryStore();
  seedAccess(store);
  store.set(
    'serviceReports',
    'report-other-job',
    await pendingReport('report-other-job', { serviceJobId: 'BRN-2026-000777' })
  );
  await expectRead(
    await handler(store).fetch(request(reviewPath('report-other-job')), env()),
    403,
    'approval_console_access_denied',
    'D25 a report bound to a different Service Job'
  );
}

// Digest mismatch in isolation: identity, brand, and lifecycle are all valid,
// and only the recorded digest disagrees with the recomputed one.
{
  const store = new ReadMemoryStore();
  seedAccess(store);
  const report = await pendingReport('report-digest');
  store.set('serviceReports', 'report-digest', report);
  const control = await handler(store).fetch(request(reviewPath('report-digest')), env());
  assert.equal(control.status, 200, 'D25 the same fixture resolves before corruption');

  store.set('serviceReports', 'report-digest', {
    ...report,
    finalContentDigest: `sha256:v1:${'1'.repeat(64)}`,
  });
  await expectRead(
    await handler(store).fetch(request(reviewPath('report-digest')), env()),
    409,
    'approval_review_unavailable',
    'D25 a review whose recorded digest disagrees with the recomputed digest'
  );
}

// The queue verifies every candidate itself: a row the query should never have
// returned is refused rather than projected into the page.
for (const [label, build] of [
  [
    'a report that is no longer pending',
    async () => asDocument(
      'report-queue-terminal',
      await pendingReport('report-queue-terminal', { approvalState: 'approved' })
    ),
  ],
  [
    'a reportId that disagrees with its document id',
    async () => asDocument('report-queue-other-id', await pendingReport('report-queue-identity')),
  ],
  [
    'a report bound to a Service Job outside this page',
    async () => asDocument(
      'report-queue-foreign-job',
      await pendingReport('report-queue-foreign-job', { serviceJobId: 'BRN-2026-000777' })
    ),
  ],
] as const) {
  const store = new ReadMemoryStore();
  seedAccess(store);
  const document = await build();
  store.approvalQueueDivergence = () => [document];
  await expectRead(
    await handler(store).fetch(request(QUEUE_PATH), env()),
    409,
    'approval_queue_integrity_incident',
    `D25 the queue refuses ${label}`
  );
}

// --- D25: no-store, privacy, and no side effects ----------------------------

{
  const store = new ReadMemoryStore();
  seedAccess(store);
  store.set('serviceReports', 'report-privacy-25', await pendingReport('report-privacy-25'));
  const worker = handler(store);
  for (const path of [QUEUE_PATH, reviewPath('report-privacy-25')]) {
    const response = await worker.fetch(request(path), env());
    assert.equal(response.status, 200, `D25 ${path} resolves`);
    assert.equal(response.headers.get('Cache-Control'), 'no-store', `D25 ${path} is no-store`);
    const serialized = JSON.stringify((await body(response)).data);
    for (const forbidden of [
      'createdByUid', 'finalizedByUid', 'brandId', 'schemaVersion',
      'currentApprovalEventId', 'approvalDecidedAt', 'activeDraftGeneration',
    ]) {
      assert.equal(
        serialized.includes(forbidden),
        false,
        `D25 ${path} must not expose ${forbidden}`
      );
    }
  }
}

{
  const store = new ReadMemoryStore();
  seedAccess(store);
  store.set('serviceReports', 'report-clean-25', await pendingReport('report-clean-25'));
  await expectNoSideEffects(
    store,
    QUEUE_PATH,
    ['get', 'queryApprovalQueue', 'batchGet'],
    'D25 approval queue read'
  );
  await expectNoSideEffects(
    store,
    reviewPath('report-clean-25'),
    ['get'],
    'D25 approval review read'
  );
}

console.log('Phase 6R-A.2 D25 security contracts passed');
