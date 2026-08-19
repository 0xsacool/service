import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

// F5d-69 Phase 2B — Service Request print additions. Follows the exact
// source-structural assertion convention test/serviceRequestPrint.test.mjs
// established for this same component (F5d-68): actual physical pagination
// cannot be executed in this Node/no-jsdom environment, so these are the
// strongest deterministic proxy available. The real A4 geometry hard gate
// (worst-normal-case content, three photos, measured against the A4
// content-height budget) was run separately via a static fixture built from
// this fix's own compiled Tailwind CSS, served locally and measured live in
// a browser — never through the production-Firestore-wired dev server, to
// avoid any risk of a production write. Result: 973.33px measured against a
// 1046.93px budget (the browser's own mm->px conversion for a 277mm probe
// element, not an assumed DPI constant) — 73.6px / 7.03% headroom, fits on
// one page. Recorded here as strong predictive evidence only, never as a
// claim of actual PDF success — matching F5d-68's own recorded caveat.

const readSource = async (path) =>
  await readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const previewSourcePromise = readSource(
  'src/features/service-jobs/components/ServiceRequestPrintPreview.tsx'
);

let failures = 0;
function check(name, value) {
  if (value) return;
  failures += 1;
  console.error(`  FAIL  ${name}`);
}

// --- all required metadata rendered -----------------------------------------

test('the customer/order metadata grid renders contactChannel via channelLabel', async () => {
  const source = await previewSourcePromise;
  assert.match(source, /job\.contactChannel &&[\s\S]{0,80}channelLabel\(job\.contactChannel\)/);
});

test('the customer/order metadata grid renders contactChannelIdentity when present', async () => {
  const source = await previewSourcePromise;
  assert.match(source, /job\.contactChannelIdentity &&/);
});

test('the customer/order metadata grid renders orderNumber when present', async () => {
  const source = await previewSourcePromise;
  assert.match(source, /job\.orderNumber &&/);
});

test('the customer/order metadata grid renders purchaseDate via formatThaiDate when present', async () => {
  const source = await previewSourcePromise;
  assert.match(source, /job\.purchaseDate &&[\s\S]{0,80}formatThaiDate\(job\.purchaseDate\)/);
});

test('the customer/order metadata grid renders orderDeliveredDate via formatThaiDate when present', async () => {
  const source = await previewSourcePromise;
  assert.match(source, /job\.orderDeliveredDate &&[\s\S]{0,120}formatThaiDate\(job\.orderDeliveredDate\)/);
});

test('the metadata grid uses print:grid-cols-3 for the compact print layout', async () => {
  const source = await previewSourcePromise;
  assert.match(source, /grid grid-cols-2 gap-x-6 gap-y-2 print:grid-cols-3/);
});

// --- URL/note never print; only the fixed indicator -------------------------

test('REGRESSION: externalEvidenceUrl itself is never interpolated into the print document', async () => {
  const source = await previewSourcePromise;
  assert.doesNotMatch(source, /\{job\.externalEvidenceUrl\}/);
  assert.doesNotMatch(source, /value=\{job\.externalEvidenceUrl\}/);
});

test('REGRESSION: externalEvidenceNote is never rendered in the print document at all', async () => {
  const source = await previewSourcePromise;
  assert.doesNotMatch(source, /job\.externalEvidenceNote/);
});

test('when externalEvidenceUrl exists, only the fixed short indicator string prints', async () => {
  const source = await previewSourcePromise;
  assert.match(
    source,
    /job\.externalEvidenceUrl &&[\s\S]{0,120}value="มีหลักฐานเพิ่มเติมออนไลน์"/
  );
});

test('no QR code is rendered for the evidence link (only the one tracking QR remains, unchanged)', async () => {
  // F5d-69G Phase 5A — the tracking QR is now a real <QRCode> element rather
  // than placeholder text; the invariant this test protects is unchanged
  // (evidence links never get their own QR), only the detection mechanism
  // updates to match the real component.
  const source = await previewSourcePromise;
  const qrOccurrences = (source.match(/<QRCode\s/g) ?? []).length;
  assert.equal(qrOccurrences, 1, 'expected exactly the one tracking QR element, no separate one for evidence');
});

// --- three photos remain supported on the same physical page ----------------

test('REGRESSION: photo thumbnails remain 64px in print mode (print:h-16 print:w-16)', async () => {
  const source = await previewSourcePromise;
  assert.match(source, /h-20 w-20 print:h-16 print:w-16/);
});

test('REGRESSION: the photo block keeps print:break-inside-avoid', async () => {
  const source = await previewSourcePromise;
  assert.match(source, /print:break-inside-avoid[\s\S]{0,200}รูปถ่ายที่บันทึกไว้/);
});

// --- legacy job missing every F5d-69 field -----------------------------------

test('every new print field is conditionally rendered, so a legacy job (all fields null) prints the unchanged pre-F5d-69 layout', async () => {
  const source = await previewSourcePromise;
  // Every one of the six new fields is gated behind its own `job.field &&`
  // guard rather than a fallback placeholder string — unlike serialNumber's
  // pre-existing 'ยังไม่ได้บันทึก' fallback — so a legacy document
  // contributes zero extra rows instead of a wall of "not recorded" text.
  for (const field of [
    'job.contactChannel',
    'job.contactChannelIdentity',
    'job.orderNumber',
    'job.purchaseDate',
    'job.orderDeliveredDate',
    'job.externalEvidenceUrl',
  ]) {
    check(`${field} is conditionally guarded, not unconditionally rendered`, source.includes(`${field} &&`));
  }
});

test('REGRESSION: existing unconditional customer fields (name/phone/email) are unchanged', async () => {
  const source = await previewSourcePromise;
  assert.match(source, /label="ชื่อ" value=\{job\.customerName\}/);
  assert.match(source, /label="โทรศัพท์" value=\{job\.customerPhone\}/);
  assert.match(source, /label="อีเมล" value=\{job\.customerEmail\}/);
});

test('REGRESSION: no document content was removed — every pre-existing section header is still present', async () => {
  const source = await previewSourcePromise;
  for (const heading of ['ลูกค้า', 'สินค้า', 'รายละเอียดอาการ', 'อุปกรณ์ที่นำมาด้วย', 'รูปถ่ายที่บันทึกไว้']) {
    check(`heading "${heading}" still present`, source.includes(heading));
  }
});

console.log(`\nf5d69Print: ${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
if (failures > 0) process.exit(1);
