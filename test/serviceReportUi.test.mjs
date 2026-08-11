import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', server: { middlewareMode: true } });
after(() => vite.close());

const {
  getActiveDraft,
  getLatestServiceReport,
  getReportDisplayContext,
  getReportHistory,
  toDraftPatch,
} = await vite.ssrLoadModule('/src/features/service-jobs/components/serviceReportUi.ts');

function makeReport(overrides = {}) {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    serviceJobId: 'SR-UI-1',
    reportNo: overrides.reportNo ?? 'FR-2026-000001',
    status: overrides.status ?? 'final',
    createdAt: overrides.createdAt ?? '2026-08-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-08-01T00:00:00.000Z',
    finalizedAt: overrides.status === 'draft' ? null : '2026-08-01T01:00:00.000Z',
    technician: 'Tech',
    customerReportedProblem: 'Original issue',
    inspectionFindings: 'Finding',
    serviceActions: ['repair'],
    parts: [],
    technicianRemark: 'Remark',
    resultStatus: 'repaired',
    resultDetail: 'Done',
    evidenceAttachmentIds: ['attachment-id'],
    claimNo: null,
    factoryReference: null,
    snapshot:
      overrides.status === 'draft'
        ? null
        : {
            trackingReference: 'SR-UI-1',
            customerName: 'Historical Customer',
            customerPhone: '000',
            customerEmail: 'old@example.com',
            brandCode: 'BRN',
            brandName: 'Bruno Thailand',
            productName: 'Historical Product',
            modelOrSku: null,
            serialNumber: 'OLD-SERIAL',
            customerReportedProblem: 'Original issue',
          },
    ...overrides,
  };
}

const serviceJob = {
  id: 'SR-UI-1',
  brandId: 'bruno-thailand',
  customerName: 'Live Customer',
  customerPhone: '111',
  customerEmail: 'live@example.com',
  product: 'Live Product',
  serialNumber: 'NEW-SERIAL',
};

test('latest report and history are deterministic and preserve multiple reports', () => {
  const older = makeReport({ id: 'older', reportNo: 'FR-2026-000001' });
  const latest = makeReport({
    id: 'latest',
    reportNo: 'FR-2026-000002',
    createdAt: '2026-08-02T00:00:00.000Z',
  });
  assert.equal(getLatestServiceReport([latest, older]).id, 'latest');
  assert.deepEqual(
    getReportHistory([latest, older]).map((report) => report.id),
    ['older']
  );
});

test('active draft is surfaced and no second draft is selected by the UI helpers', () => {
  const final = makeReport({ id: 'final' });
  const draft = makeReport({ id: 'draft', status: 'draft', reportNo: 'FR-2026-000002' });
  assert.equal(getActiveDraft([final, draft]).id, 'draft');
});

test('draft editor state contains editable fields only and keeps evidence IDs', () => {
  const draft = makeReport({ status: 'draft' });
  const patch = toDraftPatch(draft);
  assert.deepEqual(patch.evidenceAttachmentIds, ['attachment-id']);
  assert.equal('snapshot' in patch, false);
  assert.equal('reportNo' in patch, false);
  assert.equal('path' in patch, false);
  assert.equal('publicTrackingTokenHash' in patch, false);
});

test('final report view uses the immutable snapshot over changed live Service Job context', () => {
  const final = makeReport();
  const context = getReportDisplayContext(final, serviceJob);
  assert.equal(context.customerName, 'Historical Customer');
  assert.equal(context.productName, 'Historical Product');
  assert.equal(context.serialNumber, 'OLD-SERIAL');
});

test('draft report view uses current Service Job context', () => {
  const draft = makeReport({ status: 'draft' });
  const context = getReportDisplayContext(draft, serviceJob);
  assert.equal(context.customerName, 'Live Customer');
  assert.equal(context.productName, 'Live Product');
  assert.equal(context.serialNumber, 'NEW-SERIAL');
});

test('SR-2 UI source contains required draft, history, evidence, and responsive behaviors', async () => {
  const source = await readFile(
    new URL(
      '../src/features/service-jobs/components/ServiceReportsSection.tsx',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(source, /ดำเนินการแก้ไขต่อ/);
  assert.match(source, /สรุปผล/);
  assert.match(source, /ประวัติใบรายงาน/);
  assert.match(source, /evidenceAttachmentIds/);
  assert.match(source, /ไม่มีไฟล์แนบที่ใช้งานได้/);
  assert.match(source, /grid-cols-1/);
  assert.match(source, /sm:grid-cols/);
  assert.match(source, /setError\(/);
  assert.doesNotMatch(source, /publicTrackingTokenHash/);
  assert.doesNotMatch(source, /\.path\b/);
});

test('finalization confirmation summarizes identity, immutability, and new-report behavior', async () => {
  const source = await readFile(
    new URL(
      '../src/features/service-jobs/components/ServiceReportsSection.tsx',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(source, /เลขที่ใบรายงาน/);
  assert.match(source, /งานบริการ \/ เลขติดตาม/);
  assert.match(source, /อ่านได้อย่างเดียว/);
  assert.match(source, /เก็บ snapshot ประวัติแบบแก้ไขไม่ได้/);
  assert.match(source, /สร้างใบรายงานฉบับใหม่/);
  assert.doesNotMatch(source, /Unfinalize/);
});

test('SR-4.1.1 Preview / Print wiring opens and closes the preview state', async () => {
  const source = await readFile(
    new URL(
      '../src/features/service-jobs/components/ServiceReportsSection.tsx',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(
    source,
    /const \[showPrintPreview, setShowPrintPreview\] = useState\(false\)/
  );
  assert.match(source, /if \(showPrintPreview\)/);
  assert.match(source, /onClick=\{\(\) => setShowPrintPreview\(true\)\}/);
  assert.match(source, /onClose=\{\(\) => setShowPrintPreview\(false\)\}/);
});

test('Service Job details includes the Service Reports section inside the staff experience', async () => {
  const source = await readFile(
    new URL('../src/features/service-jobs/pages/ServiceJobDetails.tsx', import.meta.url),
    'utf8'
  );
  assert.match(source, /<ServiceReportsSection serviceJob=\{claim\}/);
});
