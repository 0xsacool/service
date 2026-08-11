import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', server: { middlewareMode: true } });
after(() => vite.close());

const { getReportDisplayContext } = await vite.ssrLoadModule(
  '/src/features/service-jobs/components/serviceReportUi.ts'
);
const { isValidServiceReportPart } = await vite.ssrLoadModule(
  '/src/services/serviceReport.ts'
);

function makeFinalReport() {
  return {
    id: 'report-1',
    serviceJobId: 'job-1',
    reportNo: 'FR-2026-000001',
    status: 'final',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T01:00:00.000Z',
    finalizedAt: '2026-08-01T01:00:00.000Z',
    technician: 'Technician',
    customerReportedProblem: 'Live problem',
    inspectionFindings: 'Inspection',
    serviceActions: ['repair'],
    parts: [],
    technicianRemark: 'Remark',
    resultStatus: 'repaired',
    resultDetail: 'Complete',
    evidenceAttachmentIds: ['attachment-1'],
    claimNo: null,
    factoryReference: null,
    snapshot: {
      trackingReference: 'job-1',
      customerName: 'Historical customer',
      customerPhone: '000',
      customerEmail: 'old@example.com',
      brandCode: 'BRN',
      brandName: 'Bruno Thailand',
      productName: 'Historical product',
      modelOrSku: 'MODEL-1',
      serialNumber: 'OLD-SERIAL',
      customerReportedProblem: 'Historical problem',
    },
  };
}

const liveServiceJob = {
  id: 'job-1',
  brandId: 'bruno-thailand',
  customerName: 'Changed live customer',
  customerPhone: '111',
  customerEmail: 'new@example.com',
  product: 'Changed live product',
  serialNumber: 'NEW-SERIAL',
};

test('final print context remains snapshot-backed after live Service Job changes', () => {
  const context = getReportDisplayContext(makeFinalReport(), liveServiceJob);
  assert.equal(context.customerName, 'Historical customer');
  assert.equal(context.productName, 'Historical product');
  assert.equal(context.serialNumber, 'OLD-SERIAL');
  assert.equal(context.customerReportedProblem, 'Historical problem');
});

test('SR-3 print view source contains the required A4 document sections and print action', async () => {
  const source = await readFile(
    new URL(
      '../src/features/service-jobs/components/ServiceReportPrintPreview.tsx',
      import.meta.url
    ),
    'utf8'
  );
  for (const label of [
    'SERVICE TECH',
    'ใบรายงานการตรวจสอบและซ่อม',
    'ลูกค้า',
    'สินค้า',
    'อาการที่ลูกค้าแจ้ง',
    'ผลการตรวจสอบทางเทคนิค',
    'การดำเนินการบริการ',
    'อะไหล่ / ส่วนประกอบ',
    'หมายเหตุจากช่าง',
    'ผลลัพธ์',
    'หลักฐาน',
    'โรงงาน / ผู้อนุมัติ',
  ]) {
    assert.match(source, new RegExp(label.replace(/[ /]/g, '[ /]')));
  }
  assert.match(source, /window\.print\(\)/);
  assert.match(source, /ฉบับร่าง/);
  assert.match(source, /evidenceAttachmentIds/);
});

test('optional claim and factory fields are conditionally rendered', async () => {
  const source = await readFile(
    new URL(
      '../src/features/service-jobs/components/ServiceReportPrintPreview.tsx',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(source, /report\.claimNo \|\| report\.factoryReference/);
  assert.match(source, /report\.claimNo \?/);
  assert.match(source, /report\.factoryReference \?/);
});

test('print view does not expose technical security or storage fields', async () => {
  const source = await readFile(
    new URL(
      '../src/features/service-jobs/components/ServiceReportPrintPreview.tsx',
      import.meta.url
    ),
    'utf8'
  );
  assert.doesNotMatch(source, /publicTrackingTokenHash/);
  assert.doesNotMatch(source, /brandId/);
  assert.doesNotMatch(source, /\.path\b/);
  assert.doesNotMatch(source, /updateDraft|createDraft|finalize\(/);
});

test('evidence resolution uses the authorized attachment repository and handles unavailable files', async () => {
  const source = await readFile(
    new URL('../src/hooks/useServiceReportEvidence.ts', import.meta.url),
    'utf8'
  );
  assert.match(source, /repositories\.attachments\.getDownloadUrl\(id\)/);
  assert.match(source, /status: 'unavailable'/);
  assert.match(source, /URL\.revokeObjectURL/);
  assert.match(source, /startsWith\('image\/'\)/);
});

test('print CSS defines A4 portrait, chrome hiding, and multi-page-safe breaks', async () => {
  const source = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');
  assert.match(source, /size: A4 portrait/);
  assert.match(source, /margin: 10mm/);
  assert.match(source, /Noto Sans Thai/);
  assert.match(source, /overflow-wrap: anywhere/);
  assert.match(source, /service-report-preview-toolbar/);
  assert.match(source, /break-inside: avoid/);
  assert.match(source, /page-break-inside: avoid/);
});

test('SR-4.1 print isolation removes shell layout and forced trailing pages', async () => {
  const source = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');
  assert.match(source, /service-report-print-mode/);
  assert.match(source, /staff-shell__sidebar/);
  assert.match(source, /service-job-details-page > \*/);
  assert.match(source, /service-report-section-host/);
  assert.match(source, /position: static !important/);
  assert.doesNotMatch(source, /body \* \{\s*visibility: hidden/);
  assert.doesNotMatch(source, /break-before:|page-break-before:/);
});

test('SR-4.1 compact states keep draft, no-evidence, and signatures small', async () => {
  const css = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');
  const component = await readFile(
    new URL(
      '../src/features/service-jobs/components/ServiceReportPrintPreview.tsx',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(css, /service-report-print__draft-banner[\s\S]*font-size: 0\.62rem/);
  assert.match(css, /service-report-print__signature-line[\s\S]*height: 1\.45rem/);
  assert.match(css, /service-report-print__signatures[\s\S]*margin-top: 0\.95rem/);
  assert.match(component, /evidenceAttachmentIds\.length === 0/);
  assert.match(component, /ยังไม่ได้เลือกหลักฐาน/);
  assert.match(component, /ชื่อ \/ ลายเซ็น \/ วันที่/);
});

test('SR-4.1 renders one print document and keeps screen sizing separate from print sizing', async () => {
  const source = await readFile(
    new URL(
      '../src/features/service-jobs/components/ServiceReportPrintPreview.tsx',
      import.meta.url
    ),
    'utf8'
  );
  const css = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');
  assert.equal((source.match(/className="print-area/g) ?? []).length, 1);
  assert.match(source, /service-report-print-mode/);
  assert.match(css, /\.service-report-print-mode \.print-area/);
  assert.match(css, /max-width: none !important/);
});

test('SR-4.1.1 preview lifecycle renders one article and keeps print action explicit', async () => {
  const preview = await readFile(
    new URL(
      '../src/features/service-jobs/components/ServiceReportPrintPreview.tsx',
      import.meta.url
    ),
    'utf8'
  );
  assert.equal((preview.match(/<article className="print-area/g) ?? []).length, 1);
  assert.match(preview, /onClick=\{\(\) => window\.print\(\)\}/);
  assert.match(preview, /document\.body\.classList\.add\('service-report-print-mode'\)/);
  assert.match(
    preview,
    /return \(\) => document\.body\.classList\.remove\('service-report-print-mode'\)/
  );
  assert.doesNotMatch(preview, /disabled=\{true\}/);
});

test('SR-4.1 final print footer keeps identity without a page counter', async () => {
  const preview = await readFile(
    new URL(
      '../src/features/service-jobs/components/ServiceReportPrintPreview.tsx',
      import.meta.url
    ),
    'utf8'
  );
  const css = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');
  assert.match(preview, /<span>\{report\.reportNo\}<\/span>/);
  assert.match(preview, /<span>\{context\.trackingReference\}<\/span>/);
  assert.match(preview, /สร้างเอกสารเมื่อ \{formatDate\(generatedAt\)\}/);
  assert.doesNotMatch(preview, /page-number|Page /);
  assert.doesNotMatch(css, /service-report-print__page-number|counter\(page\)/);
});

test('Thai and mixed long-content fixtures remain representable by the print data path', () => {
  const thai =
    'เครื่องมีอาการเปิดไม่ติดหลังใช้งานต่อเนื่องและมีเสียงผิดปกติ — mixed English diagnosis';
  const report = makeFinalReport();
  report.snapshot.customerReportedProblem = thai.repeat(4);
  report.inspectionFindings = `${thai} ${'inspection '.repeat(30)}`;
  report.technicianRemark = `${thai} ${'remark '.repeat(30)}`;
  report.claimNo = 'CLAIM-TH-2026-VERY-LONG-REFERENCE-000001';
  report.factoryReference = 'FACTORY-REFERENCE-WITH-A-LONG-MIXED-TEXT-VALUE';
  report.parts = Array.from({ length: 12 }, (_, index) => ({
    description: `${thai} part ${index + 1}`,
    partNo: `PART-${String(index + 1).padStart(3, '0')}`,
    quantity: index + 1,
    remark: `Long repair note ${index + 1}`,
  }));

  const context = getReportDisplayContext(report, {
    id: 'job-1',
    brandId: 'bruno-thailand',
    customerName: 'Live customer',
    customerPhone: '000',
    customerEmail: 'live@example.com',
    product: 'เครื่องชงกาแฟรุ่นยาวมาก Mixed Product Name',
    serialNumber: 'SERIAL',
  });
  assert.match(context.customerReportedProblem, /เครื่องมีอาการ/);
  assert.equal(report.parts.every(isValidServiceReportPart), true);
  assert.equal(report.parts.length, 12);
});

test('evidence print fixtures cover zero, several, and unavailable items without public URLs', async () => {
  const source = await readFile(
    new URL(
      '../src/features/service-jobs/components/ServiceReportPrintPreview.tsx',
      import.meta.url
    ),
    'utf8'
  );
  const hook = await readFile(
    new URL('../src/hooks/useServiceReportEvidence.ts', import.meta.url),
    'utf8'
  );
  assert.match(source, /evidenceAttachmentIds\.length === 0/);
  assert.match(source, /evidence\.map/);
  assert.match(source, /หลักฐานไม่พร้อมใช้งาน/);
  assert.ok(hook.includes("startsWith('image/'"));
  assert.doesNotMatch(source, /https?:\/\//);
});

test('print identity is present in the header and footer without QR or barcode hacks', async () => {
  const source = await readFile(
    new URL(
      '../src/features/service-jobs/components/ServiceReportPrintPreview.tsx',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(source, /report\.reportNo/);
  assert.match(source, /context\.trackingReference/);
  assert.match(source, /service-report-print__footer/);
  assert.doesNotMatch(source, /QRCode|barcode|qr-code/i);
});

test('final print source has no edit control and preview remains read-only', async () => {
  const source = await readFile(
    new URL(
      '../src/features/service-jobs/components/ServiceReportPrintPreview.tsx',
      import.meta.url
    ),
    'utf8'
  );
  assert.doesNotMatch(source, /Edit draft|Save draft|Finalize report/);
});
