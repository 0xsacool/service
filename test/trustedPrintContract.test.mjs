import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
});
after(() => vite.close());

const { parseTrustedPrintResult } = await vite.ssrLoadModule(
  '/src/repositories/trustedPrintContract.ts'
);

const keyA =
  'service-jobs/BRN-2026-000002/report/00000000-0000-4000-8000-000000000001-evidence-a.jpg';

function makeFinalV2({
  approvalState = 'approved',
  evidenceAttachmentIds = [keyA],
} = {}) {
  const decided = approvalState === 'approved' || approvalState === 'rejected';
  return {
    schemaVersion: 2,
    reportId: 'r-2',
    id: 'r-2',
    serviceJobId: 'BRN-2026-000002',
    reportNo: 'FR-2026-000002',
    brandId: 'bruno-thailand',
    status: 'final',
    activeDraftGeneration: 1,
    createdAt: '2026-08-21T02:03:04.005Z',
    createdByUid: 'u-2',
    createdByRoleSnapshot: 'technician',
    createdByDisplayNameSnapshot: 'ช่าง ก',
    contentRevision: 7,
    updatedAt: '2026-08-21T03:04:05.006Z',
    predecessorReportId: null,
    technician: 'ช่าง ก',
    customerReportedProblem: 'เปิดไม่ติด',
    inspectionFindings: 'ฟิวส์ขาด',
    serviceActions: ['repair', 'replace-part'],
    parts: [{ description: 'ฟิวส์', partNo: 'F-01', quantity: 1, remark: 'เปลี่ยนใหม่' }],
    technicianRemark: 'ทดสอบแล้ว',
    resultStatus: 'repaired',
    resultDetail: 'ส่งคืนได้',
    evidenceAttachmentIds,
    claimNo: null,
    factoryReference: null,
    warrantyOutcome: 'covered',
    snapshot: {
      trackingReference: 'BRN-2026-000002',
      customerName: 'อารยา',
      customerPhone: '0812345678',
      customerEmail: '',
      brandCode: 'BRN',
      brandName: 'Bruno Thailand',
      productName: 'เครื่องปิ้งขนมปัง',
      modelOrSku: null,
      serialNumber: 'S-2',
      customerReportedProblem: 'เปิดไม่ติด',
    },
    finalizedAt: '2026-08-21T03:04:05.006Z',
    finalizedByUid: 'u-2',
    finalizedByRoleSnapshot: 'technician',
    finalizedByDisplayNameSnapshot: 'ช่าง ก',
    finalizedFromRevision: 7,
    finalContentDigest: `sha256:v1:${'0'.repeat(64)}`,
    approvalState,
    currentApprovalEventId: decided ? 'r-2' : null,
    approvalDecidedAt: decided ? '2026-08-21T04:05:06.007Z' : null,
  };
}

function makeEvent(decision = 'approved') {
  return {
    eventVersion: 1,
    eventId: 'r-2',
    reportId: 'r-2',
    serviceJobId: 'BRN-2026-000002',
    brandId: 'bruno-thailand',
    reportNo: 'FR-2026-000002',
    activeDraftGeneration: 1,
    decision,
    rejectionReason: decision === 'rejected' ? 'ข้อมูลไม่ครบ' : null,
    submissionDigest: `sha256:v1:${'0'.repeat(64)}`,
    finalizedFromRevision: 7,
    finalizedByUid: 'u-2',
    approverUid: 'approver-1',
    approverRoleSnapshot: 'approver',
    approverDisplayNameSnapshot: 'ผู้อนุมัติ',
    decidedAt: '2026-08-21T04:05:06.007Z',
    policyVersion: 1,
    allowSelfApproval: false,
    selfApprovalUsed: false,
    requestFingerprint: `sha256:req-v1:${'a'.repeat(64)}`,
    approvedEvidenceRetainUntil:
      decision === 'approved' ? '2029-08-21T04:05:06.007Z' : null,
  };
}

const expected = {
  reportId: 'r-2',
  serviceJobId: 'BRN-2026-000002',
};

test('trusted-print parser accepts a coherent approved payload', () => {
  const parsed = parseTrustedPrintResult(
    {
      printState: 'v2-approved',
      report: makeFinalV2(),
      event: makeEvent(),
      evidence: [{ canonicalAttachmentKey: keyA, status: 'available' }],
      verifiedAt: '2026-08-21T04:06:00.000Z',
    },
    2,
    expected
  );

  assert.equal(parsed?.printState, 'v2-approved');
  assert.equal(parsed?.event?.approverDisplayNameSnapshot, 'ผู้อนุมัติ');
  assert.deepEqual(parsed?.evidence, [
    { canonicalAttachmentKey: keyA, status: 'available' },
  ]);
});

test('trusted-print parser accepts diagnostic integrity incidents only with missing approved evidence', () => {
  const parsed = parseTrustedPrintResult(
    {
      printState: 'integrity-incident',
      report: makeFinalV2(),
      event: makeEvent(),
      evidence: [{ canonicalAttachmentKey: keyA, status: 'missing' }],
      verifiedAt: '2026-08-21T04:06:00.000Z',
    },
    2,
    expected
  );
  assert.equal(parsed?.printState, 'integrity-incident');

  const falseIncident = parseTrustedPrintResult(
    {
      printState: 'integrity-incident',
      report: makeFinalV2(),
      event: makeEvent(),
      evidence: [{ canonicalAttachmentKey: keyA, status: 'available' }],
      verifiedAt: '2026-08-21T04:06:00.000Z',
    },
    2,
    expected
  );
  assert.equal(falseIncident, null);
});

test('trusted-print parser rejects malformed approval metadata instead of trusting a TypeScript cast', () => {
  const event = makeEvent();
  event.approverUid = null;
  const parsed = parseTrustedPrintResult(
    {
      printState: 'v2-approved',
      report: makeFinalV2(),
      event,
      evidence: [{ canonicalAttachmentKey: keyA, status: 'available' }],
      verifiedAt: '2026-08-21T04:06:00.000Z',
    },
    2,
    expected
  );
  assert.equal(parsed, null);
});

test('trusted-print parser rejects approval state/event mismatches and cross-report payloads', () => {
  const rejectedEvent = makeEvent('rejected');
  const stateMismatch = parseTrustedPrintResult(
    {
      printState: 'v2-approved',
      report: makeFinalV2(),
      event: rejectedEvent,
      evidence: [{ canonicalAttachmentKey: keyA, status: 'available' }],
      verifiedAt: '2026-08-21T04:06:00.000Z',
    },
    2,
    expected
  );
  assert.equal(stateMismatch, null);

  const wrongReport = parseTrustedPrintResult(
    {
      printState: 'v2-approved',
      report: makeFinalV2(),
      event: makeEvent(),
      evidence: [{ canonicalAttachmentKey: keyA, status: 'available' }],
      verifiedAt: '2026-08-21T04:06:00.000Z',
    },
    2,
    { ...expected, reportId: 'different-report' }
  );
  assert.equal(wrongReport, null);
});

test('trusted-print parser rejects malformed evidence and non-canonical verification timestamps', () => {
  const malformedEvidence = parseTrustedPrintResult(
    {
      printState: 'v2-approved',
      report: makeFinalV2(),
      event: makeEvent(),
      evidence: [{ canonicalAttachmentKey: 'not-a-canonical-key', status: 'available' }],
      verifiedAt: '2026-08-21T04:06:00.000Z',
    },
    2,
    expected
  );
  assert.equal(malformedEvidence, null);

  const malformedTimestamp = parseTrustedPrintResult(
    {
      printState: 'v2-approved',
      report: makeFinalV2(),
      event: makeEvent(),
      evidence: [{ canonicalAttachmentKey: keyA, status: 'available' }],
      verifiedAt: 'yesterday',
    },
    2,
    expected
  );
  assert.equal(malformedTimestamp, null);
});

test('trusted-print parser refuses to reinterpret a V2 report as legacy V1', () => {
  const parsed = parseTrustedPrintResult(
    {
      printState: 'legacy-v1',
      report: makeFinalV2(),
      event: null,
      evidence: [],
      verifiedAt: '2026-08-21T04:06:00.000Z',
    },
    1,
    expected
  );
  assert.equal(parsed, null);
});

test('trusted-print parser rejects malformed id and report-number types instead of repairing them', () => {
  const pendingReport = makeFinalV2({
    approvalState: 'pending',
    evidenceAttachmentIds: [],
  });

  const malformedId = parseTrustedPrintResult(
    {
      printState: 'v2-pending',
      report: { ...pendingReport, id: 123 },
      event: null,
      evidence: [],
      verifiedAt: '2026-08-21T04:06:00.000Z',
    },
    2,
    expected
  );
  assert.equal(malformedId, null);

  const malformedReportNumber = parseTrustedPrintResult(
    {
      printState: 'v2-pending',
      report: { ...pendingReport, reportNo: ['FR-2026-000002'] },
      event: null,
      evidence: [],
      verifiedAt: '2026-08-21T04:06:00.000Z',
    },
    2,
    expected
  );
  assert.equal(malformedReportNumber, null);

  const malformedEventReportNumber = parseTrustedPrintResult(
    {
      printState: 'v2-approved',
      report: makeFinalV2(),
      event: { ...makeEvent(), reportNo: ['FR-2026-000002'] },
      evidence: [{ canonicalAttachmentKey: keyA, status: 'available' }],
      verifiedAt: '2026-08-21T04:06:00.000Z',
    },
    2,
    expected
  );
  assert.equal(malformedEventReportNumber, null);
});

test('trusted-print parser binds the approval event finalizer to the finalized report', () => {
  const parsed = parseTrustedPrintResult(
    {
      printState: 'v2-approved',
      report: makeFinalV2(),
      event: { ...makeEvent(), finalizedByUid: 'different-finalizer' },
      evidence: [{ canonicalAttachmentKey: keyA, status: 'available' }],
      verifiedAt: '2026-08-21T04:06:00.000Z',
    },
    2,
    expected
  );
  assert.equal(parsed, null);
});

test('trusted-print parser accepts legacy V1 only under contractVersion 1 with no V2 event/evidence claims', () => {
  const legacy = {
    id: 'legacy-1',
    serviceJobId: 'BRN-2026-000001',
    reportNo: 'FR-2026-000001',
    status: 'final',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T01:00:00.000Z',
    finalizedAt: '2026-08-01T01:00:00.000Z',
    technician: 'Technician',
    customerReportedProblem: 'Problem',
    inspectionFindings: 'Inspection',
    serviceActions: ['repair'],
    parts: [],
    technicianRemark: 'Remark',
    resultStatus: 'repaired',
    resultDetail: 'Complete',
    evidenceAttachmentIds: [],
    claimNo: null,
    factoryReference: null,
    snapshot: {
      trackingReference: 'BRN-2026-000001',
      customerName: 'Customer',
      customerPhone: '0800000000',
      customerEmail: '',
      brandCode: 'BRN',
      brandName: 'Bruno Thailand',
      productName: 'Product',
      modelOrSku: null,
      serialNumber: 'SERIAL',
      customerReportedProblem: 'Problem',
    },
  };

  const parsed = parseTrustedPrintResult(
    {
      printState: 'legacy-v1',
      report: legacy,
      event: null,
      evidence: [],
      verifiedAt: '2026-08-21T04:06:00.000Z',
    },
    1,
    { reportId: 'legacy-1', serviceJobId: 'BRN-2026-000001' }
  );
  assert.equal(parsed?.printState, 'legacy-v1');

  const arrayReportNumber = parseTrustedPrintResult(
    {
      printState: 'legacy-v1',
      report: { ...legacy, reportNo: [legacy.reportNo] },
      event: null,
      evidence: [],
      verifiedAt: '2026-08-21T04:06:00.000Z',
    },
    1,
    { reportId: 'legacy-1', serviceJobId: 'BRN-2026-000001' }
  );
  assert.equal(arrayReportNumber, null);

  const snapshotWithExtraField = parseTrustedPrintResult(
    {
      printState: 'legacy-v1',
      report: {
        ...legacy,
        snapshot: { ...legacy.snapshot, unexpected: 'extra' },
      },
      event: null,
      evidence: [],
      verifiedAt: '2026-08-21T04:06:00.000Z',
    },
    1,
    { reportId: 'legacy-1', serviceJobId: 'BRN-2026-000001' }
  );
  assert.equal(snapshotWithExtraField, null);

  const partWithExtraField = parseTrustedPrintResult(
    {
      printState: 'legacy-v1',
      report: {
        ...legacy,
        parts: [
          {
            description: 'Part',
            partNo: null,
            quantity: 1,
            remark: '',
            unexpected: 'extra',
          },
        ],
      },
      event: null,
      evidence: [],
      verifiedAt: '2026-08-21T04:06:00.000Z',
    },
    1,
    { reportId: 'legacy-1', serviceJobId: 'BRN-2026-000001' }
  );
  assert.equal(partWithExtraField, null);

  const falseV2 = parseTrustedPrintResult(
    {
      printState: 'legacy-v1',
      report: legacy,
      event: null,
      evidence: [],
      verifiedAt: '2026-08-21T04:06:00.000Z',
    },
    2,
    { reportId: 'legacy-1', serviceJobId: 'BRN-2026-000001' }
  );
  assert.equal(falseV2, null);
});
