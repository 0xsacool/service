import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { installDomTestEnvironment } from './support/domTestEnvironment.mjs';

const dom = installDomTestEnvironment();
const React = await import('react');
const { act, createElement } = React;
const { createRoot } = await import('react-dom/client');

const vite = await createServer({
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
});

const { ServiceReportPrintPreview } = await vite.ssrLoadModule(
  '/src/features/service-jobs/components/ServiceReportPrintPreview.tsx'
);
const {
  getTrustedPrintPresentation,
  loadTrustedPrintForPreview,
  trustedPrintStateLabel,
  trustedPrintErrorMessage,
} = await vite.ssrLoadModule('/src/features/service-jobs/components/trustedPrintUi.ts');
const { WorkerServiceReportError } = await vite.ssrLoadModule(
  '/src/repositories/types.ts'
);

after(async () => {
  await vite.close();
  dom.cleanup();
});

beforeEach(() => {
  dom.resetBody();
});

function makeV2Report() {
  return {
    schemaVersion: 2,
    reportId: 'report-v2',
    id: 'report-v2',
    serviceJobId: 'job-v2',
    reportNo: 'FR-2026-000009',
    brandId: 'bruno-thailand',
    activeDraftGeneration: 2,
    status: 'final',
    createdAt: '2026-09-27T08:00:00.000Z',
    createdByUid: 'creator-uid',
    createdByRoleSnapshot: 'technician',
    createdByDisplayNameSnapshot: 'ช่างทดสอบ',
    contentRevision: 4,
    updatedAt: '2026-09-27T09:00:00.000Z',
    predecessorReportId: null,
    technician: 'ช่างทดสอบ',
    customerReportedProblem: 'เครื่องไม่ทำงาน',
    inspectionFindings: 'ตรวจพบฟิวส์เสีย',
    serviceActions: ['replace-part'],
    parts: [],
    technicianRemark: 'เปลี่ยนฟิวส์',
    resultStatus: 'repaired',
    resultDetail: 'ทดสอบผ่าน',
    evidenceAttachmentIds: [],
    claimNo: null,
    factoryReference: null,
    warrantyOutcome: 'covered',
    snapshot: {
      trackingReference: 'BRN-2026-000009',
      customerName: 'ลูกค้าทดสอบ',
      customerPhone: '0800000000',
      customerEmail: 'customer@example.test',
      brandCode: 'BRN',
      brandName: 'Bruno Thailand',
      productName: 'Test Product',
      modelOrSku: 'BOE999',
      serialNumber: 'SERIAL-999',
      customerReportedProblem: 'เครื่องไม่ทำงาน',
    },
    finalizedAt: '2026-09-27T09:00:00.000Z',
    finalizedByUid: 'finalizer-uid',
    finalizedByRoleSnapshot: 'technician',
    finalizedByDisplayNameSnapshot: 'ช่างทดสอบ',
    finalizedFromRevision: 4,
    finalContentDigest: 'sha256:v1:test-digest',
    approvalState: 'approved',
    currentApprovalEventId: 'approval-event-1',
    approvalDecidedAt: '2026-09-27T10:00:00.000Z',
  };
}

function makeApprovalEvent(decision = 'approved') {
  return {
    eventVersion: 1,
    eventId: 'approval-event-1',
    reportId: 'report-v2',
    serviceJobId: 'job-v2',
    brandId: 'bruno-thailand',
    reportNo: 'FR-2026-000009',
    activeDraftGeneration: 2,
    decision,
    rejectionReason: decision === 'rejected' ? 'ข้อมูลไม่ครบ' : null,
    submissionDigest: 'sha256:v1:test-digest',
    finalizedFromRevision: 4,
    finalizedByUid: 'finalizer-uid',
    approverUid: 'approver-uid',
    approverRoleSnapshot: 'approver',
    approverDisplayNameSnapshot: 'ผู้อนุมัติทดสอบ',
    decidedAt: '2026-09-27T10:00:00.000Z',
    policyVersion: 1,
    allowSelfApproval: false,
    selfApprovalUsed: false,
    requestFingerprint: 'sha256:req-v1:test',
    approvedEvidenceRetainUntil: '2027-09-27T10:00:00.000Z',
  };
}

const serviceJob = {
  id: 'job-v2',
  brandId: 'bruno-thailand',
  customerName: 'live customer',
  customerPhone: '0811111111',
  customerEmail: 'live@example.test',
  product: 'Live Product',
  serialNumber: 'LIVE-SERIAL',
};

function trustedResult(printState, overrides = {}) {
  return {
    printState,
    report: makeV2Report(),
    event:
      printState === 'v2-approved' ||
      printState === 'v2-rejected' ||
      printState === 'integrity-incident'
        ? makeApprovalEvent(printState === 'v2-rejected' ? 'rejected' : 'approved')
        : null,
    evidence:
      printState === 'integrity-incident'
        ? [{ canonicalAttachmentKey: 'att_missing', status: 'missing' }]
        : [],
    verifiedAt: '2026-09-27T10:05:00.000Z',
    ...overrides,
  };
}

async function mountPreview(result) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(ServiceReportPrintPreview, {
        trustedPrint: result,
        serviceJob,
        attachments: [],
        onClose() {},
      })
    );
    await Promise.resolve();
  });
  return {
    container,
    async unmount() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

test('trusted-print presentation keeps all six states semantically distinct', () => {
  const expectations = {
    'legacy-v1': ['รายงานรูปแบบเดิม', true],
    'v2-draft': ['ฉบับร่างที่ตรวจสอบจากเซิร์ฟเวอร์แล้ว', true],
    'v2-pending': ['รอการอนุมัติ', true],
    'v2-approved': ['อนุมัติแล้วและตรวจสอบความถูกต้องแล้ว', true],
    'v2-rejected': ['ไม่อนุมัติ', true],
    'integrity-incident': ['พบปัญหาความครบถ้วนของหลักฐาน', false],
  };

  for (const [state, [label, canPrint]] of Object.entries(expectations)) {
    const result = trustedResult(state);
    assert.equal(trustedPrintStateLabel(result), label);
    assert.equal(getTrustedPrintPresentation(result).canPrint, canPrint);
  }
});

test('approved trusted preview renders verified decision and permits the explicit print action', async () => {
  let printCalls = 0;
  const originalPrint = dom.window.print;
  dom.window.print = () => {
    printCalls += 1;
  };

  const mounted = await mountPreview(trustedResult('v2-approved'));
  try {
    assert.match(document.body.textContent, /อนุมัติแล้วและตรวจสอบความถูกต้องแล้ว/);
    assert.match(document.body.textContent, /อยู่ในประกัน/);
    assert.match(document.body.textContent, /ผู้อนุมัติทดสอบ/);

    const printButton = Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('พิมพ์ / บันทึก PDF')
    );
    assert.ok(printButton);
    assert.equal(printButton.disabled, false);

    await act(async () => {
      printButton.click();
    });
    assert.equal(printCalls, 1);
  } finally {
    await mounted.unmount();
    dom.window.print = originalPrint;
  }
});

test('integrity incident renders diagnostic status and blocks window.print', async () => {
  let printCalls = 0;
  const originalPrint = dom.window.print;
  dom.window.print = () => {
    printCalls += 1;
  };

  const mounted = await mountPreview(trustedResult('integrity-incident'));
  try {
    assert.match(document.body.textContent, /พบปัญหาความครบถ้วนของหลักฐาน/);
    assert.match(document.body.textContent, /ไม่พร้อมใช้งาน 1 รายการ/);

    const blockedButton = Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('ปิดการพิมพ์ชั่วคราว')
    );
    assert.ok(blockedButton);
    assert.equal(blockedButton.disabled, true);

    await act(async () => {
      blockedButton.click();
    });
    assert.equal(printCalls, 0);
  } finally {
    await mounted.unmount();
    dom.window.print = originalPrint;
  }
});

test('trusted-print UI source exposes no raw approval uid or digest in the printable document', async () => {
  const preview = await readFile(
    new URL(
      '../src/features/service-jobs/components/ServiceReportPrintPreview.tsx',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(preview, /approverDisplayNameSnapshot/);
  assert.match(preview, /warrantyOutcomeLabel/);
  assert.match(preview, /trustedPrint\.verifiedAt/);
  assert.doesNotMatch(preview, /approverUid/);
  assert.doesNotMatch(preview, /finalContentDigest/);
  assert.doesNotMatch(preview, /submissionDigest/);
});

test('read-only report UI delegates preview verification through the trusted-print flow helper', async () => {
  const source = await readFile(
    new URL(
      '../src/features/service-jobs/components/ServiceReportsSection.tsx',
      import.meta.url
    ),
    'utf8'
  );

  assert.match(source, /await loadTrustedPrintForPreview\(report\.id, onTrustedPrint\)/);
  assert.match(source, /trustedPrint=\{trustedPrintResult\}/);
});

test('trusted-print flow returns normal verification without diagnostic fallback', async () => {
  const calls = [];
  const approved = trustedResult('v2-approved');
  const result = await loadTrustedPrintForPreview('report-v2', async (reportId, mode) => {
    calls.push([reportId, mode]);
    return approved;
  });

  assert.equal(result, approved);
  assert.deepEqual(calls, [['report-v2', 'normal']]);
});

test('trusted-print flow enters diagnostic mode only for the evidence-integrity incident', async () => {
  const calls = [];
  const diagnostic = trustedResult('integrity-incident');
  const result = await loadTrustedPrintForPreview('report-v2', async (reportId, mode) => {
    calls.push([reportId, mode]);
    if (mode === 'normal') {
      throw new WorkerServiceReportError(
        'Approved evidence is unavailable',
        409,
        'evidence_integrity_incident',
        'operator'
      );
    }
    return diagnostic;
  });

  assert.equal(result, diagnostic);
  assert.deepEqual(calls, [
    ['report-v2', 'normal'],
    ['report-v2', 'diagnostic'],
  ]);
});

test('trusted-print flow never falls back to diagnostic mode for another error class', async () => {
  const calls = [];
  const failure = new WorkerServiceReportError(
    'The report digest does not verify',
    409,
    'integrity_mismatch',
    'operator'
  );

  await assert.rejects(
    () =>
      loadTrustedPrintForPreview('report-v2', async (reportId, mode) => {
        calls.push([reportId, mode]);
        throw failure;
      }),
    (error) => error === failure
  );
  assert.deepEqual(calls, [['report-v2', 'normal']]);
});

test('trusted-print flow rejects a diagnostic response that is not an integrity incident', async () => {
  const calls = [];
  await assert.rejects(
    () =>
      loadTrustedPrintForPreview('report-v2', async (reportId, mode) => {
        calls.push([reportId, mode]);
        if (mode === 'normal') {
          throw new WorkerServiceReportError(
            'Approved evidence is unavailable',
            409,
            'evidence_integrity_incident',
            'operator'
          );
        }
        return trustedResult('v2-approved');
      }),
    /Trusted-print diagnostic state mismatch/
  );
  assert.deepEqual(calls, [
    ['report-v2', 'normal'],
    ['report-v2', 'diagnostic'],
  ]);
});

test('trusted-print error mapping never exposes provider/internal error text', () => {
  const sentinel = 'SECRET_PROVIDER_DETAIL_DO_NOT_RENDER';
  const forbidden = new WorkerServiceReportError(sentinel, 403, 'forbidden', 'never');
  assert.equal(
    trustedPrintErrorMessage(forbidden),
    'บัญชีนี้ไม่มีสิทธิ์ตรวจสอบข้อมูลสำหรับการพิมพ์'
  );
  assert.doesNotMatch(trustedPrintErrorMessage(forbidden), new RegExp(sentinel));

  const integrity = new WorkerServiceReportError(
    sentinel,
    409,
    'integrity_mismatch',
    'operator'
  );
  assert.match(trustedPrintErrorMessage(integrity), /ไม่ผ่านการตรวจสอบความถูกต้อง/);
  assert.doesNotMatch(trustedPrintErrorMessage(integrity), new RegExp(sentinel));

  assert.equal(
    trustedPrintErrorMessage(new Error(sentinel)),
    'ไม่สามารถตรวจสอบข้อมูลก่อนพิมพ์ได้ กรุณาลองใหม่อีกครั้ง'
  );
});
