import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', server: { middlewareMode: true } });
after(() => vite.close());

const { buildCustomerNotificationMessage, shareCustomerNotification } =
  await vite.ssrLoadModule('/src/services/customerNotificationShare.ts');

const detailsSource = await readFile(
  new URL('../src/features/service-jobs/pages/ServiceJobDetails.tsx', import.meta.url),
  'utf8'
);
const previewSource = await readFile(
  new URL(
    '../src/features/service-jobs/components/DeliveryNotePrintPreview.tsx',
    import.meta.url
  ),
  'utf8'
);
const cssSource = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');

function makeJob(overrides = {}) {
  return {
    id: 'BRN-2026-000001',
    brandId: 'bruno-thailand',
    publicTrackingTokenHash: null,
    customerName: 'Customer Name',
    customerPhone: '0812345678',
    customerEmail: 'customer@example.com',
    product: 'iPhone 14',
    productCategory: 'Smartphone',
    serialNumber: 'SERIAL-001',
    issue: 'หน้าจอแตก',
    description: 'รายละเอียดภายใน',
    status: 'Received',
    priority: 'Normal',
    createdAt: '2026-08-10',
    updatedAt: '2026-08-10',
    technician: 'Private Technician',
    estimatedCompletion: '2026-08-12',
    warranty: false,
    photos: [],
    timeline: [],
    notes: [{ author: 'Private Staff', date: '2026-08-10', text: 'Internal note' }],
    accessories: ['สายชาร์จ'],
    quote: 123,
    ...overrides,
  };
}

test('delivery-note action opens a separate preview and does not remain inert', () => {
  assert.match(detailsSource, /setShowDeliveryNotePreview\(true\)/);
  assert.match(detailsSource, /<DeliveryNotePrintPreview/);
  assert.match(detailsSource, /setShowDeliveryNotePreview\(false\)/);
  assert.match(detailsSource, /notifyCustomer/);
  assert.match(detailsSource, /แชร์ข้อความแล้ว/);
  assert.match(detailsSource, /คัดลอกข้อความแล้ว/);
  assert.match(detailsSource, /ไม่สามารถแชร์หรือคัดลอกข้อความได้/);
});

test('delivery note is one Thai-first print article with browser print and back actions', () => {
  assert.equal((previewSource.match(/<article className="print-area/g) ?? []).length, 1);
  assert.match(previewSource, /SERVICE TECH/);
  for (const label of [
    'ใบนำส่งสินค้า',
    'เลขที่งาน',
    'วันที่',
    'ชื่อลูกค้า',
    'โทรศัพท์',
    'สินค้า',
    'หมายเลขเครื่อง',
    'อาการที่ลูกค้าแจ้ง',
    'สถานะปัจจุบัน',
    'สิ่งที่ส่งมาพร้อมสินค้า',
    'หมายเหตุ',
    'ผู้ส่งมอบสินค้า',
    'เจ้าหน้าที่ผู้รับสินค้า',
  ]) {
    assert.match(previewSource, new RegExp(label));
  }
  assert.match(previewSource, /onClick=\{\(\) => window\.print\(\)\}/);
  assert.match(previewSource, /onClick=\{onClose\}/);
  assert.match(previewSource, /delivery-note-print-mode/);
  assert.match(cssSource, /size: A4 portrait/);
  assert.match(cssSource, /delivery-note-preview-toolbar/);
  assert.match(cssSource, /delivery-note-print-mode \.staff-shell__sidebar/);
  assert.match(cssSource, /delivery-note-print-mode \.print-area/);
  assert.doesNotMatch(previewSource, /counter\(page\)|Page 0|page-number/i);
});

test('delivery note does not expose private, security, or fake-link fields', () => {
  for (const field of [
    'brandId',
    'publicTrackingTokenHash',
    'firebaseUid',
    'R2',
    'attachment',
    'internal',
    'https://',
  ]) {
    assert.doesNotMatch(
      previewSource,
      new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    );
  }
  // F5d-69G Phase 7A — publicTrackingCodeHash/window.location/QRCode are now
  // legitimate, approved additions (same pattern as ServiceRequestPrintPreview):
  // the hash is only ever read in a boolean gate, never displayed as a value.
  assert.match(previewSource, /job\.publicTrackingCodeHash !== null/);
  assert.doesNotMatch(previewSource, /\{job\.publicTrackingCodeHash\}/);
  assert.match(previewSource, /window\.location\.origin/);
  assert.match(previewSource, /<QRCode\s/);
  assert.match(previewSource, /job\.accessories/);
  assert.doesNotMatch(previewSource, /job\.notes/);
  assert.doesNotMatch(previewSource, /job\.description/);
});

test('delivery note handles missing optional fields without inventing schema data', () => {
  assert.match(previewSource, /job\.customerEmail \?/);
  assert.match(previewSource, /job\.serialNumber/);
  assert.match(previewSource, /job\.accessories\?\./);
  assert.match(previewSource, /HandwritingLines/);
});

test('customer notification message uses job identity, product, and localized status only', () => {
  const message = buildCustomerNotificationMessage(makeJob());
  assert.match(message, /BRN-2026-000001/);
  assert.match(message, /iPhone 14/);
  assert.match(message, /รับสินค้าแล้ว/);
  assert.match(message, /ลิงก์ที่ได้รับจากเจ้าหน้าที่/);
  for (const privateValue of [
    'รายละเอียดภายใน',
    'Internal note',
    'Private Technician',
    'SERIAL-001',
  ]) {
    assert.doesNotMatch(message, new RegExp(privateValue));
  }
  assert.doesNotMatch(message, /https?:\/\//);
  assert.doesNotMatch(message, /publicTrackingTokenHash|brandId|firebaseUid|R2/i);
});

test('customer notification uses Web Share when available', async () => {
  const calls = [];
  const result = await shareCustomerNotification('message', {
    share: async (payload) => calls.push(payload),
    clipboard: { writeText: async () => assert.fail('clipboard should not run') },
  });
  assert.equal(result, 'shared');
  assert.deepEqual(calls, [{ text: 'message' }]);
});

test('customer notification falls back to clipboard when Web Share is unavailable', async () => {
  const copied = [];
  const result = await shareCustomerNotification('message', {
    clipboard: { writeText: async (value) => copied.push(value) },
  });
  assert.equal(result, 'copied');
  assert.deepEqual(copied, ['message']);
});

test('cancelled Web Share is a neutral result and genuine failure rejects', async () => {
  const cancelled = await shareCustomerNotification('message', {
    share: async () => {
      const error = new Error('cancelled');
      error.name = 'AbortError';
      throw error;
    },
  });
  assert.equal(cancelled, 'cancelled');

  await assert.rejects(
    shareCustomerNotification('message', {
      share: async () => {
        throw new Error('share failed');
      },
    }),
    /share failed/
  );
});

test('share path does not mutate the Service Job', async () => {
  const job = makeJob();
  const before = JSON.stringify(job);
  const message = buildCustomerNotificationMessage(job);
  await shareCustomerNotification(message, {
    clipboard: { writeText: async () => undefined },
  });
  assert.equal(JSON.stringify(job), before);
});
