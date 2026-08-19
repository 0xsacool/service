import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const readSource = async (path) =>
  await readFile(new URL(`../${path}`, import.meta.url), 'utf8');

// F5d-68 — the Service Request print flow (New Service Job "Save & Print")
// never activated any print-mode isolation, unlike its two sibling print
// documents (ServiceReportPrintPreview / DeliveryNotePrintPreview), so the
// staff shell, page heading, and on-screen success card/actions all printed
// alongside the actual document. This file follows the exact source/CSS
// structural assertion convention already established for those siblings
// (test/serviceReportPrint.test.mjs, test/opsUx1.test.mjs) — physical
// pagination itself cannot be verified in this Node/no-jsdom environment,
// so these are the strongest deterministic proxy available.

const previewSourcePromise = readSource(
  'src/features/service-jobs/components/ServiceRequestPrintPreview.tsx'
);
const pageSourcePromise = readSource('src/features/service-jobs/pages/NewServiceJob.tsx');
const cssSourcePromise = readSource('src/index.css');

// --- print-mode activation / cleanup ---------------------------------------

test('ServiceRequestPrintPreview activates service-request-print-mode on mount', async () => {
  const source = await previewSourcePromise;
  assert.match(source, /document\.body\.classList\.add\('service-request-print-mode'\)/);
});

test('ServiceRequestPrintPreview removes service-request-print-mode on cleanup', async () => {
  const source = await previewSourcePromise;
  assert.match(
    source,
    /return \(\) => document\.body\.classList\.remove\('service-request-print-mode'\)/
  );
});

test('the print-mode effect has an empty dependency array (runs once per mount, not per prop change)', async () => {
  const source = await previewSourcePromise;
  const effectBlock = source.match(
    /useEffect\(\(\) => \{\s*document\.body\.classList\.add\('service-request-print-mode'\);[\s\S]*?\}, \[\]\);/
  );
  assert.notEqual(effectBlock, null, 'expected a useEffect with an empty dependency array');
});

// --- F5d-68 Phase 3A: deterministic automatic-print timing -----------------
//
// The first automatic print must not depend on React's child-before-parent
// passive-effect commit order being load-bearing — NewServiceJob's own
// savedJob effect now adds service-request-print-mode itself, synchronously,
// immediately before calling window.print(). This is proved by SOURCE ORDER
// within one function body (both statements execute top-to-bottom,
// synchronously, in the same effect) — not by observing actual React
// runtime effect scheduling across two different components, which this
// Node/no-jsdom environment cannot execute.

test('REGRESSION: NewServiceJob\'s automatic-print effect adds service-request-print-mode itself, before calling window.print()', async () => {
  const source = await pageSourcePromise;
  const effectMatch = source.match(
    /useEffect\(\(\) => \{\s*if \(savedJob\) \{([\s\S]*?)\}\s*\}, \[savedJob\]\);/
  );
  assert.notEqual(effectMatch, null, 'expected the savedJob automatic-print effect');
  const body = effectMatch[1];
  const addIndex = body.indexOf("document.body.classList.add('service-request-print-mode')");
  const printIndex = body.indexOf('window.print()');
  assert.equal(addIndex >= 0, true, 'expected the effect to add service-request-print-mode');
  assert.equal(printIndex >= 0, true, 'expected the effect to call window.print()');
  assert.equal(
    addIndex < printIndex,
    true,
    'service-request-print-mode must be added before window.print() is called, in source (execution) order'
  );
});

test('the parent-side class add does not replace ServiceRequestPrintPreview\'s own lifecycle effect', async () => {
  const pageSource = await pageSourcePromise;
  const previewSource = await previewSourcePromise;
  // The parent's add is a defensive duplicate (idempotent) — the preview
  // component must still own add-on-mount/remove-on-cleanup for as long as
  // it exists, so navigating away or finishing "Print Again" state still
  // cleans up correctly.
  assert.match(previewSource, /document\.body\.classList\.add\('service-request-print-mode'\)/);
  assert.match(
    previewSource,
    /return \(\) => document\.body\.classList\.remove\('service-request-print-mode'\)/
  );
  // The parent effect never removes the class itself — cleanup remains
  // solely the preview's responsibility.
  const parentEffectMatch = pageSource.match(
    /useEffect\(\(\) => \{\s*if \(savedJob\) \{[\s\S]*?\}\s*\}, \[savedJob\]\);/
  );
  assert.notEqual(parentEffectMatch, null);
  assert.doesNotMatch(parentEffectMatch[0], /classList\.remove/);
});

// --- staff shell / page-level isolation (CSS) -------------------------------

test('service-request-print-mode hides the staff shell sidebar and topbar', async () => {
  const css = await cssSourcePromise;
  assert.match(css, /\.service-request-print-mode \.staff-shell__sidebar,/);
  assert.match(css, /\.service-request-print-mode \.staff-shell__topbar,/);
});

test('service-request-print-mode resets staff-shell min-height so no blank space is forced', async () => {
  const css = await cssSourcePromise;
  assert.match(
    css,
    /\.service-request-print-mode \.staff-shell \{\s*background: #fff !important;\s*min-height: 0 !important;\s*\}/
  );
});

test('service-request-print-mode hides every New Service Job page sibling except the print host', async () => {
  const css = await cssSourcePromise;
  assert.match(css, /\.service-request-print-mode \.new-service-job-page > \* \{\s*display: none !important;\s*\}/);
  assert.match(
    css,
    /\.service-request-print-mode \.new-service-job-page > \.service-request-print-host \{\s*display: block !important;/
  );
});

test('NewServiceJob.tsx wires the page-level host classes the CSS above targets', async () => {
  const source = await pageSourcePromise;
  assert.match(source, /className="new-service-job-page"/);
  assert.match(source, /className="service-request-print-host focus:outline-none"/);
});

test('.print-area remains visible/printable under service-request-print-mode', async () => {
  const css = await cssSourcePromise;
  assert.match(
    css,
    /\.service-request-print-mode \.print-area,\s*\.service-request-print-mode \.print-area \* \{\s*visibility: visible;\s*\}/
  );
});

// --- screen success/action controls excluded from print ---------------------

test('the on-screen success card and action buttons are wrapped in the always-hidden print toolbar', async () => {
  const source = await previewSourcePromise;
  // Exactly one print-area root, and it is a sibling of the toolbar wrapper,
  // not nested inside it — otherwise hiding the toolbar would also hide the
  // document.
  assert.equal((source.match(/className="print-area /g) ?? []).length, 1);
  assert.match(source, /className="service-request-preview-toolbar space-y-6"/);
  const css = await cssSourcePromise;
  assert.match(css, /\.service-request-preview-toolbar \{\s*display: none !important;\s*\}/);
});

test('the toolbar wrapper contains the success card and both action buttons, not the print document', async () => {
  const source = await previewSourcePromise;
  const toolbarStart = source.indexOf('service-request-preview-toolbar');
  const printAreaStart = source.indexOf('className="print-area ');
  assert.equal(toolbarStart >= 0 && printAreaStart > toolbarStart, true);
  const toolbarSection = source.slice(toolbarStart, printAreaStart);
  assert.match(toolbarSection, /GlassCard/);
  assert.match(toolbarSection, /onClick=\{onPrintAgain\}/);
  assert.match(toolbarSection, /onClick=\{onNewServiceJob\}/);
});

// --- A4 geometry -------------------------------------------------------------

test('A4 portrait @page geometry with 10mm margins is present for the Service Request', async () => {
  const css = await cssSourcePromise;
  // The block comment anchors this to the Service Request section
  // specifically, not just a coincidental match against a sibling's @page.
  const section = css.slice(css.indexOf('F5d-68 — Service Request'));
  assert.match(section, /@page \{\s*size: A4 portrait;\s*margin: 10mm;\s*\}/);
});

test('the print root has no screen card margin/padding/shadow/radius under print', async () => {
  const source = await previewSourcePromise;
  assert.match(source, /print:m-0 print:rounded-none print:p-0 print:shadow-none print:ring-0/);
});

// --- print-only compaction ----------------------------------------------------

test('print-only compact spacing exists on major section gaps without changing screen spacing', async () => {
  const source = await previewSourcePromise;
  // Screen classes (mt-6/mt-10) remain present — print:mt-* only takes over
  // under print media, so normal screen appearance is unaffected.
  assert.match(source, /mt-6 print:mt-4/);
  assert.match(source, /mt-10 print:mt-6/);
});

// --- evidence photos ------------------------------------------------------------

test('evidence photos use a compact 64px print-only thumbnail size, screen size unchanged', async () => {
  const source = await previewSourcePromise;
  assert.match(source, /h-20 w-20 print:h-16 print:w-16 rounded border border-neutral-300 object-cover/);
});

test('evidence photos preserve aspect ratio (object-cover, equal height/width) and are not stretched', async () => {
  const source = await previewSourcePromise;
  assert.match(source, /object-cover/);
  assert.doesNotMatch(source, /object-fill/);
});

test('evidence photos still render every photo in job.photos (3-photo workflow unaffected)', async () => {
  const source = await previewSourcePromise;
  assert.match(source, /\{job\.photos\.map\(\(src, index\) => \(/);
  assert.doesNotMatch(source, /job\.photos\.slice\(/);
  assert.doesNotMatch(source, /job\.photos\.filter\(/);
});

test('the evidence photo block has print break-inside protection', async () => {
  const source = await previewSourcePromise;
  const photoSectionMatch = source.match(
    /\{job\.photos\.length > 0 && \(\s*<section className="([^"]*)"/
  );
  assert.notEqual(photoSectionMatch, null);
  assert.match(photoSectionMatch[1], /print:break-inside-avoid/);
});

// --- lower-section pagination safety ---------------------------------------

test('the dates/technician block has print break-inside protection', async () => {
  const source = await previewSourcePromise;
  assert.match(
    source,
    /<section className="mt-6 print:mt-4 print:break-inside-avoid grid grid-cols-2 gap-x-6 gap-y-2">/
  );
});

test('the signature block has print break-inside protection', async () => {
  const source = await previewSourcePromise;
  assert.match(
    source,
    /<section className="mt-10 print:mt-6 print:break-inside-avoid grid grid-cols-2 gap-8">/
  );
});

test('the footer has print break-inside protection', async () => {
  const source = await previewSourcePromise;
  assert.match(source, /<footer className="mt-10 print:mt-6 print:break-inside-avoid /);
});

test('break-inside-avoid is not applied to the whole document root (avoids worse pagination)', async () => {
  const source = await previewSourcePromise;
  const printAreaTag = source.slice(
    source.indexOf('className="print-area '),
    source.indexOf('>', source.indexOf('className="print-area '))
  );
  assert.doesNotMatch(printAreaTag, /break-inside-avoid/);
});

// --- document content preserved ----------------------------------------------

test('every required Service Request field/section remains present in source', async () => {
  const source = await previewSourcePromise;
  // F5d-69G Phase 5A — the tracking QR is now a real <QRCode> element
  // rather than placeholder text; checked separately from the plain-text
  // label list below, which the real component has no equivalent of.
  assert.match(source, /<QRCode\s/);
  for (const required of [
    'APP_NAME',
    'เลขติดตาม',
    'เลขที่ใบรับบริการ',
    'ลูกค้า',
    'สินค้า',
    'การรับประกัน',
    'รายละเอียดอาการ',
    'อุปกรณ์ที่นำมาด้วย',
    'รูปถ่ายที่บันทึกไว้',
    'วันที่รับสินค้า',
    'Expected Return',
    'ช่างผู้รับผิดชอบ',
    'ลายเซ็นลูกค้า',
    'ลายเซ็นเจ้าหน้าที่',
    'หน้า 1 จาก 1',
  ]) {
    assert.match(source, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('no overflow:hidden is introduced that could silently clip document content', async () => {
  const source = await previewSourcePromise;
  assert.doesNotMatch(source, /overflow-hidden/);
  assert.doesNotMatch(source, /overflow:\s*hidden/);
});

// --- sibling print modes remain untouched -------------------------------------

test('service-report-print-mode CSS rules remain byte-present and unchanged in shape', async () => {
  const css = await cssSourcePromise;
  assert.match(css, /\.service-report-print-mode \.staff-shell \{/);
  assert.match(css, /\.service-report-print-mode \.print-area,/);
  assert.match(css, /body\.service-report-print-mode \{/);
});

test('delivery-note-print-mode CSS rules remain byte-present and unchanged in shape', async () => {
  const css = await cssSourcePromise;
  assert.match(css, /\.delivery-note-print-mode \.staff-shell \{/);
  assert.match(css, /\.delivery-note-print-mode \.print-area,/);
  assert.match(css, /body\.delivery-note-print-mode \{/);
});

test('ServiceReportPrintPreview and DeliveryNotePrintPreview source files are untouched by this fix', async () => {
  const reportSource = await readSource(
    'src/features/service-jobs/components/ServiceReportPrintPreview.tsx'
  );
  const noteSource = await readSource(
    'src/features/service-jobs/components/DeliveryNotePrintPreview.tsx'
  );
  assert.match(reportSource, /document\.body\.classList\.add\('service-report-print-mode'\)/);
  assert.match(noteSource, /document\.body\.classList\.add\('delivery-note-print-mode'\)/);
  assert.doesNotMatch(reportSource, /service-request-print-mode/);
  assert.doesNotMatch(noteSource, /service-request-print-mode/);
});

// --- normal screen layout unaffected -------------------------------------------

test('PageContainer still accepts and applies an additional className (screen layout mechanism unchanged)', async () => {
  const source = await readSource('src/shared/components/PageContainer.tsx');
  assert.match(source, /\$\{className\}/);
});

test('NewServiceJob.tsx screen-only elements (back button, heading) are unmodified aside from the new page class', async () => {
  const source = await pageSourcePromise;
  assert.match(source, /กลับงานบริการทั้งหมด/);
  assert.match(source, /สร้างงานบริการใหม่/);
  assert.match(source, /<p className="mt-1 text-neutral-500">\{subtitle\}<\/p>/);
});
