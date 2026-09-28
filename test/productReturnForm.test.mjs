import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { installDomTestEnvironment } from './support/domTestEnvironment.mjs';

const dom = installDomTestEnvironment();
const React = await import('react');
const { act, createElement } = React;
const { createRoot } = await import('react-dom/client');

const vite = await createServer({
  appType: 'custom',
  server: {
    middlewareMode: true,
    hmr: false,
    watch: {
      ignored: ['**/node_modules.n76-cache/**', '**/node_modules.n76-junction/**'],
    },
  },
  cacheDir: join(tmpdir(), 'product-return-form-runtime'),
});

const { getReturnFormAvailability, loadReturnFormTrustedPrint } =
  await vite.ssrLoadModule(
    '/src/features/service-jobs/components/productReturnFormUi.ts'
  );
const { ProductReturnFormPrintPreview } = await vite.ssrLoadModule(
  '/src/features/service-jobs/components/ProductReturnFormPrintPreview.tsx'
);
const { persistServiceJobEdits } = await vite.ssrLoadModule(
  '/src/hooks/useUpdateServiceJob.ts'
);
const { fromFirestoreData, toFirestoreUpdateFields } = await vite.ssrLoadModule(
  '/src/repositories/firestore/serviceJobMapping.ts'
);

after(async () => {
  await vite.close();
  dom.cleanup();
});

beforeEach(() => {
  dom.resetBody();
});

function makeJob(overrides = {}) {
  return {
    id: 'BRN-2026-000777',
    brandId: 'bruno-thailand',
    customerName: 'ลูกค้าทดสอบ',
    customerPhone: '0800000000',
    customerEmail: 'customer@example.test',
    product: 'BRUNO Test Product',
    productCategory: 'Kitchen',
    serialNumber: 'SERIAL-777',
    issue: 'ไม่ทำงาน',
    description: 'ไม่ทำงาน',
    status: 'Completed',
    priority: 'Normal',
    createdAt: '2026-09-20',
    updatedAt: '2026-09-28',
    technician: 'ช่างทดสอบ',
    estimatedCompletion: '2026-09-28',
    warranty: true,
    photos: [],
    timeline: [],
    notes: [],
    quote: 98765,
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
    technician: 'ช่างทดสอบ',
    customerReportedProblem: 'ไม่ทำงาน',
    inspectionFindings: 'ฟิวส์เสีย',
    serviceActions: ['replace-part'],
    parts: [{ description: 'ฟิวส์', partNo: 'F1', quantity: 1, remark: 'เปลี่ยนใหม่' }],
    technicianRemark: 'ทดสอบผ่าน',
    resultStatus: 'repaired',
    resultDetail: 'ทำงานปกติ',
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

function makeV2Final(overrides = {}) {
  const history = makeHistory();
  return {
    schemaVersion: 2,
    reportId: history.id,
    id: history.id,
    serviceJobId: history.serviceJobId,
    reportNo: history.reportNo,
    brandId: 'bruno-thailand',
    activeDraftGeneration: 1,
    status: 'final',
    createdAt: history.createdAt,
    createdByUid: 'creator',
    createdByRoleSnapshot: 'technician',
    createdByDisplayNameSnapshot: 'ช่างทดสอบ',
    contentRevision: 2,
    updatedAt: history.updatedAt,
    predecessorReportId: null,
    technician: history.technician,
    customerReportedProblem: history.customerReportedProblem,
    inspectionFindings: history.inspectionFindings,
    serviceActions: history.serviceActions,
    parts: history.parts,
    technicianRemark: history.technicianRemark,
    resultStatus: history.resultStatus,
    resultDetail: history.resultDetail,
    evidenceAttachmentIds: [],
    claimNo: null,
    factoryReference: null,
    warrantyOutcome: 'covered',
    snapshot: {
      trackingReference: history.serviceJobId,
      customerName: 'ลูกค้าทดสอบ',
      customerPhone: '0800000000',
      customerEmail: 'customer@example.test',
      brandCode: 'BRN',
      brandName: 'BRUNO Thailand',
      productName: 'BRUNO Test Product',
      modelOrSku: 'TEST',
      serialNumber: 'SERIAL-777',
      customerReportedProblem: 'ไม่ทำงาน',
    },
    finalizedAt: history.finalizedAt,
    finalizedByUid: 'finalizer',
    finalizedByRoleSnapshot: 'technician',
    finalizedByDisplayNameSnapshot: 'ช่างทดสอบ',
    finalizedFromRevision: 2,
    finalContentDigest: 'sha256:v1:test',
    approvalState: 'approved',
    currentApprovalEventId: 'report-v2',
    approvalDecidedAt: '2026-09-27T10:00:00.000Z',
    ...overrides,
  };
}

function makeEvent(overrides = {}) {
  return {
    eventVersion: 1,
    eventId: 'report-v2',
    reportId: 'report-v2',
    serviceJobId: 'BRN-2026-000777',
    brandId: 'bruno-thailand',
    reportNo: 'FR-2026-000099',
    activeDraftGeneration: 1,
    decision: 'approved',
    rejectionReason: null,
    submissionDigest: 'sha256:v1:test',
    finalizedFromRevision: 2,
    finalizedByUid: 'finalizer',
    approverUid: 'approver-sensitive-id',
    approverRoleSnapshot: 'approver',
    approverDisplayNameSnapshot: 'ผู้อนุมัติทดสอบ',
    decidedAt: '2026-09-27T10:00:00.000Z',
    policyVersion: 1,
    allowSelfApproval: false,
    selfApprovalUsed: false,
    requestFingerprint: 'sha256:req-v1:sensitive',
    approvedEvidenceRetainUntil: null,
    ...overrides,
  };
}

function approvedResult(overrides = {}) {
  return {
    printState: 'v2-approved',
    report: makeV2Final(),
    event: makeEvent(),
    evidence: [],
    verifiedAt: '2026-09-27T10:05:00.000Z',
    ...overrides,
  };
}

test('Return Form requires trusted Completed metadata and picks the latest D24 report', () => {
  const older = makeHistory({
    id: 'older',
    reportNo: 'FR-2026-000001',
    createdAt: '2026-09-20T00:00:00.000Z',
  });
  const latest = makeHistory();
  const ready = getReturnFormAvailability(makeJob(), [latest, older]);
  assert.equal(ready.ready, true);
  assert.equal(ready.latestReport.id, 'report-v2');

  assert.equal(
    getReturnFormAvailability(
      makeJob({ status: 'Ready for Pickup', closedAt: null, returnFormNumber: null }),
      [latest]
    ).ready,
    false
  );
  assert.equal(
    getReturnFormAvailability(makeJob({ returnFormNumber: null }), [latest]).ready,
    false
  );

  for (const invalidClosedAt of [
    '2026-02-30T03:04:05.000Z',
    '2026-13-01T03:04:05.000Z',
    '2026-09-28T24:00:00.000Z',
    '2026-09-28T03:60:00.000Z',
    '2026-09-28T03:04:60.000Z',
    '2026-09-28T03:04:05.000+24:00',
  ]) {
    assert.equal(
      getReturnFormAvailability(makeJob({ closedAt: invalidClosedAt }), [latest]).ready,
      false,
      `invalid closedAt must fail closed: ${invalidClosedAt}`
    );
  }
});

test('Return Form trusted loader uses normal mode only and rejects every non-approved state', async () => {
  const calls = [];
  const ok = await loadReturnFormTrustedPrint(
    makeJob(),
    [makeHistory()],
    async (id, mode) => {
      calls.push([id, mode]);
      return approvedResult();
    }
  );
  assert.equal(ok.printState, 'v2-approved');
  assert.deepEqual(calls, [['report-v2', 'normal']]);

  for (const state of [
    'legacy-v1',
    'v2-draft',
    'v2-pending',
    'v2-rejected',
    'integrity-incident',
  ]) {
    const localCalls = [];
    await assert.rejects(
      () =>
        loadReturnFormTrustedPrint(makeJob(), [makeHistory()], async (id, mode) => {
          localCalls.push([id, mode]);
          return approvedResult({
            printState: state,
            event:
              state === 'v2-rejected' || state === 'integrity-incident'
                ? makeEvent()
                : null,
          });
        }),
      /ยังไม่ผ่านการอนุมัติ/
    );
    assert.deepEqual(localCalls, [['report-v2', 'normal']]);
  }
});

test('Return Form rejects a trusted payload for a different report or service job', async () => {
  await assert.rejects(
    () =>
      loadReturnFormTrustedPrint(makeJob(), [makeHistory()], async () =>
        approvedResult({ report: makeV2Final({ reportId: 'other', id: 'other' }) })
      ),
    /ยังไม่ผ่านการอนุมัติ/
  );
  await assert.rejects(
    () =>
      loadReturnFormTrustedPrint(makeJob(), [makeHistory()], async () =>
        approvedResult({ report: makeV2Final({ serviceJobId: 'BRN-OTHER' }) })
      ),
    /ยังไม่ผ่านการอนุมัติ/
  );
});

test('Completed save persists dirty fields before complete and never sends Completed through update', async () => {
  const calls = [];
  const current = makeJob({
    status: 'Ready for Pickup',
    returnFormNumber: null,
    closedAt: null,
  });
  const repository = {
    async update(id, patch) {
      calls.push(['update', id, patch]);
      assert.notEqual(patch.status, 'Completed');
      return { ...current, ...patch };
    },
    async complete(id) {
      calls.push(['complete', id]);
      return makeJob();
    },
  };

  const result = await persistServiceJobEdits({
    id: current.id,
    edits: {
      status: 'Completed',
      notes: [{ author: 'Staff', date: '2026-09-28', text: 'ส่งมอบ' }],
    },
    current,
    backendKind: 'firestore',
    repository,
  });

  assert.equal(result.status, 'Completed');
  assert.equal(calls[0][0], 'update');
  assert.equal(calls[1][0], 'complete');
});

test('a failed trusted completion leaves the preceding update non-Completed', async () => {
  const statuses = [];
  const current = makeJob({
    status: 'Ready for Pickup',
    returnFormNumber: null,
    closedAt: null,
  });
  const repository = {
    async update(_id, patch) {
      statuses.push(patch.status);
      return { ...current, ...patch };
    },
    async complete() {
      throw new Error('completion failed');
    },
  };

  await assert.rejects(
    () =>
      persistServiceJobEdits({
        id: current.id,
        edits: { status: 'Completed', notes: [] },
        current,
        backendKind: 'firestore',
        repository,
      }),
    /completion failed/
  );
  assert.deepEqual(statuses, [undefined]);
});

test('Firestore mapping treats Return Form identity as server-owned and legacy reads as null', () => {
  const job = makeJob();
  const update = toFirestoreUpdateFields(job);
  assert.equal(Object.hasOwn(update, 'returnFormNumber'), false);

  const mapped = fromFirestoreData('legacy-job', {
    ...job,
    returnFormNumber: undefined,
  });
  assert.equal(mapped.returnFormNumber, null);
});

test('approved Product Return Form preview prints business-safe data without money or sensitive verification fields', async () => {
  let printCalls = 0;
  const originalPrint = dom.window.print;
  dom.window.print = () => {
    printCalls += 1;
  };
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        createElement(ProductReturnFormPrintPreview, {
          serviceJob: makeJob(),
          trustedPrint: approvedResult(),
          publicTrackingCode: null,
          onClose() {},
        })
      );
      await Promise.resolve();
    });

    const text = document.body.textContent ?? '';
    assert.match(text, /RT-2026-000321/);
    assert.match(text, /ฟิวส์เสีย/);
    assert.match(text, /อยู่ในประกัน/);
    assert.match(text, /ผู้อนุมัติทดสอบ/);
    assert.match(text, /ลายเซ็นลูกค้า/);
    assert.match(text, /ลายเซ็นเจ้าหน้าที่ผู้ส่งมอบ/);
    assert.doesNotMatch(text, /98765|approver-sensitive-id|sha256:req-v1:sensitive/);

    const printButton = Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('พิมพ์ / บันทึก PDF')
    );
    assert.ok(printButton);
    await act(async () => printButton.click());
    assert.equal(printCalls, 1);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    dom.window.print = originalPrint;
  }
});
