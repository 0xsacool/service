import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
async function readLocaleSource() {
  return fs.readFile(
    new URL('../src/features/tracking/publicTrackingLocale.ts', import.meta.url),
    'utf8'
  );
}

test('public tracking exposes only the approved locale set and Thai is the default', async () => {
  const source = await readLocaleSource();
  assert.match(source, /PUBLIC_TRACKING_LOCALES = \['th', 'en', 'ja', 'zh-CN'\]/);
  assert.match(source, /return isPublicTrackingLocale\(value\) \? value : 'th'/);
  assert.match(source, /PUBLIC_TRACKING_LOCALE_STORAGE_KEY/);
});

test('public locale persistence stores only a locale value, never tracking credentials', async () => {
  const source = await readLocaleSource();
  assert.match(
    source,
    /storage\?\.setItem\(PUBLIC_TRACKING_LOCALE_STORAGE_KEY, locale\)/
  );
  assert.doesNotMatch(source, /token|hash|payload/i);
});

test('every public status is localized in all four locales', async () => {
  const source = await readLocaleSource();
  for (const status of [
    'Received',
    'Diagnosing',
    'Awaiting Parts',
    'In Repair',
    'Quality Check',
    'Ready for Pickup',
    'Completed',
    'Cancelled',
    'Rejected',
  ]) {
    assert.ok(
      source.includes(`${status}:`) || source.includes(`'${status}':`),
      `missing ${status}`
    );
  }
});

test('public DTO and timeline remain privacy-safe while the UI localizes display only', async () => {
  const dtoSource = await fs.readFile(
    new URL('../src/features/tracking/publicTracking.ts', import.meta.url),
    'utf8'
  );
  const resultSource = await fs.readFile(
    new URL('../src/features/tracking/pages/TrackResult.tsx', import.meta.url),
    'utf8'
  );
  assert.match(dtoSource, /export interface PublicTrackingDto/);
  assert.match(dtoSource, /maskedSerial/);
  assert.doesNotMatch(dtoSource, /customerPhone|customerEmail|internalNotes|description/);
  assert.match(resultSource, /statusLabels\[event\.status\]/);
  assert.doesNotMatch(resultSource, /event\.description|event\.notes|event\.internal/);
  assert.match(resultSource, /PublicTrackingLanguageSelector/);
});

test('staff and print surfaces are Thai-first without changing persisted status values', async () => {
  const statusSource = await fs.readFile(
    new URL('../src/services/serviceJobPresentation.ts', import.meta.url),
    'utf8'
  );
  const reportSource = await fs.readFile(
    new URL(
      '../src/features/service-jobs/components/ServiceReportPrintPreview.tsx',
      import.meta.url
    ),
    'utf8'
  );
  const loginSource = await fs.readFile(
    new URL('../src/features/auth/pages/Login.tsx', import.meta.url),
    'utf8'
  );
  assert.match(statusSource, /รับสินค้าแล้ว/);
  assert.match(statusSource, /กำลังดำเนินการซ่อม/);
  assert.match(reportSource, /ใบรายงานการตรวจสอบและซ่อม/);
  assert.doesNotMatch(reportSource, /counter\(page\)|Page 0/);
  assert.match(loginSource, /เข้าสู่ระบบ/);
});
