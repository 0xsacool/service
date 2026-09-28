import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const RUNTIME = fileURLToPath(new URL('./support/hookRuntime.mjs', import.meta.url));

const vite = await createServer({
  configFile: false,
  appType: 'custom',
  server: {
    middlewareMode: true,
    hmr: false,
    watch: {
      ignored: ['**/node_modules.n76-cache/**', '**/node_modules.n76-junction/**'],
    },
  },
  resolve: { alias: { react: RUNTIME } },
  optimizeDeps: { noDiscovery: true, include: [] },
  cacheDir: join(tmpdir(), 'product-return-form-guard-runtime'),
});

after(() => vite.close());

const { deferred, mountHook } = await vite.ssrLoadModule(RUNTIME);
const { useReturnFormPreviewGuard } = await vite.ssrLoadModule(
  '/src/features/service-jobs/components/useReturnFormPreviewGuard.ts'
);
const { getReturnFormAvailability } = await vite.ssrLoadModule(
  '/src/features/service-jobs/components/productReturnFormUi.ts'
);

function makeJob(overrides = {}) {
  return {
    id: 'BRN-2026-000777',
    brandId: 'bruno-thailand',
    customerName: 'QA',
    customerPhone: '0800000000',
    customerEmail: '',
    product: 'QA Product',
    productCategory: 'QA',
    serialNumber: 'SERIAL-777',
    issue: 'issue',
    description: 'description',
    status: 'Completed',
    priority: 'Normal',
    createdAt: '2026-09-20',
    updatedAt: '2026-09-28',
    technician: 'Tech',
    estimatedCompletion: '2026-09-28',
    warranty: true,
    photos: [],
    timeline: [],
    notes: [],
    accessories: [],
    serviceRequestNumber: 'SR-2026-000777',
    returnFormNumber: 'RT-2026-000321',
    closedAt: '2026-09-28T03:04:05.000Z',
    publicTrackingTokenHash: null,
    publicTrackingCodeHash: null,
    contactChannel: null,
    contactChannelIdentity: null,
    orderNumber: null,
    orderVerification: null,
    purchaseDate: null,
    orderDeliveredDate: null,
    externalEvidenceUrl: null,
    externalEvidenceNote: null,
    ...overrides,
  };
}

function makeHistory(overrides = {}) {
  return {
    historyItemVersion: 1,
    sourceSchemaVersion: 2,
    id: 'report-v2',
    serviceJobId: 'BRN-2026-000777',
    reportNo: 'FR-2026-000099',
    status: 'final',
    createdAt: '2026-09-27T08:00:00.000Z',
    updatedAt: '2026-09-27T09:00:00.000Z',
    finalizedAt: '2026-09-27T09:00:00.000Z',
    technician: 'Tech',
    customerReportedProblem: 'issue',
    inspectionFindings: 'fuse',
    serviceActions: ['replace-part'],
    parts: [],
    technicianRemark: '',
    resultStatus: 'repaired',
    resultDetail: '',
    evidenceAttachmentIds: [],
    claimNo: null,
    factoryReference: null,
    snapshot: null,
    warrantyOutcome: 'covered',
    approvalState: 'approved',
    contentRevision: 2,
    finalContentDigest: 'sha256:v1:test',
    predecessorReportId: null,
    ...overrides,
  };
}

function newerDraft() {
  return makeHistory({
    id: 'report-new-draft',
    reportNo: 'FR-2026-000100',
    status: 'draft',
    createdAt: '2026-09-28T11:00:00.000Z',
    updatedAt: '2026-09-28T11:00:00.000Z',
    finalizedAt: null,
    approvalState: 'pending',
    contentRevision: 1,
    finalContentDigest: null,
  });
}

function approvedResult() {
  return {
    printState: 'v2-approved',
    report: {
      schemaVersion: 2,
      reportId: 'report-v2',
      id: 'report-v2',
      serviceJobId: 'BRN-2026-000777',
      status: 'final',
    },
    event: { eventVersion: 1 },
    evidence: [],
    verifiedAt: '2026-09-27T10:05:00.000Z',
  };
}

function props(overrides = {}) {
  return {
    serviceJob: makeJob(),
    reports: [makeHistory()],
    trustedPrint: async () => approvedResult(),
    isHistoryLoading: false,
    isHistoryStale: false,
    historyError: null,
    ...overrides,
  };
}

test('Return Form eligibility rejects impossible historical completion timestamps', () => {
  for (const invalidClosedAt of [
    '2026-02-30T03:04:05.000Z',
    '2026-13-01T03:04:05.000Z',
    '2026-09-28T24:00:00.000Z',
    '2026-09-28T03:60:00.000Z',
    '2026-09-28T03:04:60.000Z',
    '2026-09-28T03:04:05.000+24:00',
  ]) {
    const availability = getReturnFormAvailability(
      makeJob({ closedAt: invalidClosedAt }),
      [makeHistory()]
    );
    assert.equal(
      availability.ready,
      false,
      `invalid closedAt must fail closed: ${invalidClosedAt}`
    );
  }
});

test('mounted guard invalidates an open Return Form when D24 history changes', async () => {
  const mounted = mountHook(useReturnFormPreviewGuard, props());
  try {
    await mounted.result().verify();
    await mounted.flush();
    assert.equal(mounted.result().printablePreview?.report.id, 'report-v2');

    mounted.rerender(props({ reports: [makeHistory(), newerDraft()] }));
    await mounted.flush();
    assert.equal(mounted.result().printablePreview, null);
  } finally {
    mounted.unmount();
  }
});

test('mounted guard rejects an in-flight trusted response when a newer D24 report arrives', async () => {
  const pendingTrusted = deferred();
  const mounted = mountHook(
    useReturnFormPreviewGuard,
    props({ trustedPrint: () => pendingTrusted.promise })
  );
  try {
    const pendingVerification = mounted.result().verify();
    mounted.rerender(
      props({
        reports: [makeHistory(), newerDraft()],
        trustedPrint: () => pendingTrusted.promise,
      })
    );
    await mounted.flush();

    pendingTrusted.resolve(approvedResult());
    await assert.rejects(pendingVerification, /ประวัติใบรายงานมีการเปลี่ยนแปลง/);
    await mounted.flush();
    assert.equal(mounted.result().printablePreview, null);
  } finally {
    mounted.unmount();
  }
});

test('mounted guard invalidates printing when history becomes stale or fails', async () => {
  const mounted = mountHook(useReturnFormPreviewGuard, props());
  try {
    await mounted.result().verify();
    await mounted.flush();
    assert.ok(mounted.result().printablePreview);

    mounted.rerender(props({ isHistoryStale: true }));
    await mounted.flush();
    assert.equal(mounted.result().printablePreview, null);

    mounted.rerender(props());
    await mounted.flush();
    await mounted.result().verify();
    await mounted.flush();
    assert.ok(mounted.result().printablePreview);

    mounted.rerender(props({ historyError: new Error('history failed') }));
    await mounted.flush();
    assert.equal(mounted.result().printablePreview, null);
  } finally {
    mounted.unmount();
  }
});

console.log('N7.6 Product Return Form guard runtime tests passed');
