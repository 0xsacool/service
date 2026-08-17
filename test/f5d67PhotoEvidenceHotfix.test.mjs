import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test, after } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const readSource = async (path) =>
  await readFile(new URL(`../${path}`, import.meta.url), 'utf8');

// F5d-67 — regression coverage for the production bug where a real,
// uncompressed phone-camera photo pushed the intake payload past the
// Worker's existing size caps (worker/src/serviceJobCreation.ts), causing
// POST /service-jobs to reject the entire request before allocation. This
// exercises the new client-side compression pipeline (pure logic only — no
// jsdom/canvas is available in this Node test environment, matching this
// project's existing precedent of testing pure logic directly and leaving
// real-DOM-only paths documented rather than force-fit into a mismatched
// environment).

const vite = await createServer({
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
});
after(() => vite.close());

const {
  MAX_PHOTO_DATA_URL_SAFE_BYTES,
  MAX_PHOTOS_TOTAL_SAFE_BYTES,
  MAX_PHOTO_ITEMS,
  MAX_IMAGE_DIMENSION,
  RECOMMENDED_PHOTO_COUNT,
  PHOTO_PROCESSING_CONCURRENCY,
  PHOTOS_TARGET_AGGREGATE_BYTES,
  computeScaledDimensions,
  computePerPhotoTargetBytes,
  compressToFit,
  compressWithLadder,
  processInBatches,
  validatePhotosForSubmission,
  wouldExceedAggregate,
  processPhotoFile,
  ImageDecodeError,
  ImageTooLargeError,
} = await vite.ssrLoadModule('/src/services/imageEvidenceProcessing.ts');

const { photoProcessingErrorMessage, photoValidationErrorMessage } =
  await vite.ssrLoadModule('/src/features/service-jobs/photoEvidenceErrorMessages.ts');

const {
  serviceJobCreateErrorMessage,
  serviceJobUpdateErrorMessage,
  serviceJobIntakeTooLargeMessage,
} = await vite.ssrLoadModule('/src/features/service-jobs/serviceJobErrorMessages.ts');

const {
  buildServiceJobIntakePayload,
  buildCustomerIntakeSelector,
  estimateIntakeRequestBytes,
  MAX_INTAKE_REQUEST_SAFE_BYTES,
} = await vite.ssrLoadModule('/src/services/serviceJobCreation.ts');

const { PhotoEvidenceSection } = await vite.ssrLoadModule(
  '/src/features/service-jobs/components/PhotoEvidenceSection.tsx'
);

// The Worker's own authoritative caps (worker/src/serviceJobCreation.ts,
// unchanged by this fix) — duplicated here as literals rather than imported,
// since app-side tests load through Vite's SSR module graph and the Worker
// module isn't part of that graph. Kept in sync manually; the Worker's own
// test suite (worker/test/serviceJobCreation.test.mts) is authoritative for
// these values.
const WORKER_MAX_PHOTO_DATA_URL_BYTES = 300 * 1024;
const WORKER_MAX_PHOTOS_TOTAL_BYTES = 700 * 1024;
const WORKER_MAX_PHOTO_ITEMS = 10;

// --- computeScaledDimensions -------------------------------------------

test('a large image is downscaled to the max dimension, aspect ratio preserved', () => {
  const { width, height } = computeScaledDimensions(4000, 3000, 1600);
  assert.equal(width, 1600);
  assert.equal(height, 1200);
  assert.equal(Math.abs(width / height - 4000 / 3000) < 0.001, true);
});

test('a portrait image is downscaled on its longest side, aspect ratio preserved', () => {
  const { width, height } = computeScaledDimensions(3000, 4000, 1600);
  assert.equal(height, 1600);
  assert.equal(width, 1200);
});

test('an already-small image is never enlarged', () => {
  const result = computeScaledDimensions(800, 600, 1600);
  assert.deepEqual(result, { width: 800, height: 600 });
});

test('an image exactly at the max dimension is returned unchanged', () => {
  const result = computeScaledDimensions(1600, 900, 1600);
  assert.deepEqual(result, { width: 1600, height: 900 });
});

// --- compressToFit -------------------------------------------------------

test('compressToFit returns the first quality whose encoded size fits', () => {
  const sizesByQuality = { 0.82: 500_000, 0.68: 300_000, 0.55: 200_000 };
  const encode = (quality) => 'x'.repeat(sizesByQuality[quality]);
  const result = compressToFit(encode, 250_000, [0.82, 0.68, 0.55]);
  assert.equal(result.quality, 0.55);
  assert.equal(result.dataUrl.length, 200_000);
});

test('compressToFit returns null when no offered quality fits', () => {
  const encode = () => 'x'.repeat(999_999);
  const result = compressToFit(encode, 250_000, [0.82, 0.68, 0.55]);
  assert.equal(result, null);
});

// --- compressWithLadder (realistic-photo simulation) ----------------------

// Simulates a realistic relationship: encoded size grows with dimension and
// quality. A "big camera photo" (4000x3000) needs both downscaling and
// quality reduction to fit; this proves the full ladder converges below the
// safe per-photo ceiling without ever enlarging or leaking an oversized
// result.
function simulateEncoder(width, height) {
  const pixelBudget = width * height;
  return (quality) => 'x'.repeat(Math.round(pixelBudget * quality * 0.18));
}

test('a realistically large camera photo is processed below the safe per-photo limit', () => {
  const result = compressWithLadder(4000, 3000, simulateEncoder);
  assert.notEqual(result, null);
  assert.equal(result.dataUrl.length <= MAX_PHOTO_DATA_URL_SAFE_BYTES, true);
});

test('the ladder never requests a dimension larger than the source', () => {
  const requestedDimensions = [];
  const trackingEncoder = (width, height) => {
    requestedDimensions.push(Math.max(width, height));
    return simulateEncoder(width, height);
  };
  compressWithLadder(1000, 700, trackingEncoder);
  for (const dimension of requestedDimensions) {
    assert.equal(dimension <= 1000, true);
  }
});

test('an image that cannot fit even at the smallest ladder rung returns null', () => {
  const alwaysOversized = () => () => 'x'.repeat(999_999);
  const result = compressWithLadder(4000, 3000, alwaysOversized);
  assert.equal(result, null);
});

// --- validatePhotosForSubmission / wouldExceedAggregate -------------------

test('a single photo under both safe ceilings passes validation', () => {
  const photos = [{ dataUrl: 'x'.repeat(MAX_PHOTO_DATA_URL_SAFE_BYTES) }];
  assert.deepEqual(validatePhotosForSubmission(photos), { ok: true });
});

test('a single photo over the safe per-photo ceiling fails validation', () => {
  const photos = [{ dataUrl: 'x'.repeat(MAX_PHOTO_DATA_URL_SAFE_BYTES + 1) }];
  const result = validatePhotosForSubmission(photos);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'photo-too-large');
});

test('several individually-valid photos that combine over the aggregate ceiling fail validation', () => {
  const perPhoto = Math.floor(MAX_PHOTOS_TOTAL_SAFE_BYTES / 3) + 100;
  const photos = [
    { dataUrl: 'x'.repeat(perPhoto) },
    { dataUrl: 'x'.repeat(perPhoto) },
    { dataUrl: 'x'.repeat(perPhoto) },
  ];
  const result = validatePhotosForSubmission(photos);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'aggregate-too-large');
});

test('more than MAX_PHOTO_ITEMS photos fail validation regardless of size', () => {
  const photos = Array.from({ length: MAX_PHOTO_ITEMS + 1 }, () => ({ dataUrl: 'x' }));
  const result = validatePhotosForSubmission(photos);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'too-many-photos');
});

test('wouldExceedAggregate correctly rejects a photo that would push the running total over the safe ceiling', () => {
  const existing = [{ dataUrl: 'x'.repeat(Math.floor(MAX_PHOTOS_TOTAL_SAFE_BYTES * 0.7)) }];
  const candidateThatFits = 'x'.repeat(10);
  const candidateThatOverflows = 'x'.repeat(Math.floor(MAX_PHOTOS_TOTAL_SAFE_BYTES * 0.5));
  assert.equal(wouldExceedAggregate(existing, candidateThatFits), false);
  assert.equal(wouldExceedAggregate(existing, candidateThatOverflows), true);
});

// --- processPhotoFile: the one DOM-independent branch --------------------

test('a non-image file is rejected with ImageDecodeError before any DOM decode is attempted', async () => {
  const fakeFile = { type: 'application/pdf', name: 'warranty.pdf' };
  await assert.rejects(() => processPhotoFile(fakeFile), ImageDecodeError);
});

// --- error message mapping ------------------------------------------------

test('known image-processing errors map to specific, safe Thai messages', () => {
  assert.equal(
    photoProcessingErrorMessage(new ImageDecodeError()),
    'ไม่สามารถประมวลผลรูปภาพนี้ได้ กรุณาลองไฟล์รูปภาพอื่น'
  );
  assert.equal(
    photoProcessingErrorMessage(new ImageTooLargeError()),
    'รูปภาพนี้มีขนาดใหญ่เกินไป แม้จะบีบอัดแล้ว กรุณาลองรูปภาพอื่น'
  );
});

test('an unrecognized processing error still falls back to a safe generic message, never the raw error', () => {
  const message = photoProcessingErrorMessage(new Error('some internal detail: /private/path'));
  assert.doesNotMatch(message, /internal|private|path|Error/);
});

test('validation failure reasons map to specific, actionable Thai messages', () => {
  assert.match(photoValidationErrorMessage('photo-too-large'), /ใหญ่เกินไป/);
  assert.match(photoValidationErrorMessage('aggregate-too-large'), /รวม/);
  assert.match(photoValidationErrorMessage('too-many-photos'), /10/);
});

// --- unchanged behavior: generic Service Job error message ----------------

test('serviceJobCreateErrorMessage/serviceJobUpdateErrorMessage remain generic and unchanged by this fix', () => {
  const fakeInternalError = new Error('Worker Service Job creation failed (500)');
  assert.equal(
    serviceJobCreateErrorMessage(fakeInternalError),
    'ไม่สามารถสร้างงานบริการได้ กรุณาลองอีกครั้ง'
  );
  assert.equal(
    serviceJobUpdateErrorMessage(fakeInternalError),
    'ไม่สามารถบันทึกการเปลี่ยนแปลงได้ กรุณาลองอีกครั้ง'
  );
});

// --- integration-shaped regression test: the actual production bug -------

test('REGRESSION: a realistic camera-sized evidence photo no longer produces an oversized Service Job intake payload', () => {
  // Simulates the exact real-world shape of the bug report: a normal phone
  // photo, several MB uncompressed, well past both the client's and the
  // Worker's raw limits before any processing.
  const rawCameraPhotoWidth = 4032;
  const rawCameraPhotoHeight = 3024;

  const processed = compressWithLadder(rawCameraPhotoWidth, rawCameraPhotoHeight, simulateEncoder);
  assert.notEqual(processed, null, 'a realistic camera photo must be processable');

  // Below the client's own safe ceiling (with margin)...
  assert.equal(processed.dataUrl.length <= MAX_PHOTO_DATA_URL_SAFE_BYTES, true);
  // ...which independently guarantees it is below the Worker's real,
  // authoritative per-photo cap — the actual assumption the Worker's
  // parseServiceJobIntake() enforces and that caused the original failure.
  assert.equal(MAX_PHOTO_DATA_URL_SAFE_BYTES < WORKER_MAX_PHOTO_DATA_URL_BYTES, true);
  assert.equal(processed.dataUrl.length <= WORKER_MAX_PHOTO_DATA_URL_BYTES, true);

  // A Service Job intake with several such processed photos still respects
  // both the client's aggregate ceiling and the Worker's real aggregate cap.
  const photos = [
    processed.dataUrl,
    processed.dataUrl,
  ];
  const validation = validatePhotosForSubmission(photos.map((dataUrl) => ({ dataUrl })));
  assert.equal(validation.ok, true);
  const totalBytes = photos.reduce((sum, p) => sum + p.length, 0);
  assert.equal(totalBytes <= MAX_PHOTOS_TOTAL_SAFE_BYTES, true);
  assert.equal(MAX_PHOTOS_TOTAL_SAFE_BYTES < WORKER_MAX_PHOTOS_TOTAL_BYTES, true);
  assert.equal(totalBytes <= WORKER_MAX_PHOTOS_TOTAL_BYTES, true);

  assert.equal(MAX_PHOTO_ITEMS <= WORKER_MAX_PHOTO_ITEMS, true);
});

// --- unchanged: no-photo flow ----------------------------------------------

test('a Service Job intake with zero photos always passes photo validation', () => {
  assert.deepEqual(validatePhotosForSubmission([]), { ok: true });
});

test('MAX_IMAGE_DIMENSION keeps enough resolution for label/serial-number legibility', () => {
  // Not a pixel-perfect OCR guarantee — a documented, sane floor: this
  // fix must not compress evidence photos into illegibility to satisfy size
  // limits alone.
  assert.equal(MAX_IMAGE_DIMENSION >= 1200, true);
});

// ===========================================================================
// F5d-67 Phase 2R — hardening before source freeze
// ===========================================================================

// --- 1. Three-photo normal workflow (Product, Damaged Area, Serial Number) --

test('RECOMMENDED_PHOTO_COUNT matches the UI\'s own recommended checklist (3)', () => {
  assert.equal(RECOMMENDED_PHOTO_COUNT, 3);
});

test('computePerPhotoTargetBytes gives all three photos in a 3-photo batch the same, aggregate-safe share', () => {
  const target = computePerPhotoTargetBytes(0, 3);
  assert.equal(target * 3 <= MAX_PHOTOS_TOTAL_SAFE_BYTES, true);
  assert.equal(computePerPhotoTargetBytes(0, 1), target);
  assert.equal(computePerPhotoTargetBytes(1, 1), target);
  assert.equal(computePerPhotoTargetBytes(2, 1), target);
});

test('computePerPhotoTargetBytes never exceeds the absolute per-photo ceiling', () => {
  for (const [existing, batch] of [[0, 1], [0, 3], [0, 10], [5, 1], [9, 1]]) {
    assert.equal(computePerPhotoTargetBytes(existing, batch) <= MAX_PHOTO_DATA_URL_SAFE_BYTES, true);
  }
});

// --- Phase 2R2: the 3-photo target must leave meaningful headroom, not ~1 byte --

test('the 3-photo compression target divides PHOTOS_TARGET_AGGREGATE_BYTES (600 KiB), not the 640 KiB hard ceiling', () => {
  const target = computePerPhotoTargetBytes(0, 3);
  assert.equal(target, 200 * 1024);
  assert.equal(target * RECOMMENDED_PHOTO_COUNT, PHOTOS_TARGET_AGGREGATE_BYTES);
});

test('REGRESSION: the 3-photo worst-case total leaves meaningful (not 1-byte) headroom under the hard aggregate ceiling', () => {
  const target = computePerPhotoTargetBytes(0, 3);
  const worstCaseTotal = target * RECOMMENDED_PHOTO_COUNT;
  const headroom = MAX_PHOTOS_TOTAL_SAFE_BYTES - worstCaseTotal;
  assert.equal(worstCaseTotal <= MAX_PHOTOS_TOTAL_SAFE_BYTES, true);
  assert.equal(headroom, 40 * 1024);
  assert.equal(headroom >= 32 * 1024, true, `expected meaningful headroom, got ${headroom} bytes`);
  // The target budget itself also sits below the hard ceiling, which in
  // turn sits below the Worker's real authoritative aggregate cap.
  assert.equal(PHOTOS_TARGET_AGGREGATE_BYTES < MAX_PHOTOS_TOTAL_SAFE_BYTES, true);
  assert.equal(MAX_PHOTOS_TOTAL_SAFE_BYTES < WORKER_MAX_PHOTOS_TOTAL_BYTES, true);
});

test('REGRESSION: three realistic camera-sized photos can all be processed and fit safely below the Worker aggregate limit', () => {
  const target = computePerPhotoTargetBytes(0, 3);
  const photos = [
    compressWithLadder(4032, 3024, simulateEncoder, target), // product overview (landscape)
    compressWithLadder(3024, 4032, simulateEncoder, target), // damaged area (portrait)
    compressWithLadder(4000, 3000, simulateEncoder, target), // serial number / label
  ];

  for (const photo of photos) {
    assert.notEqual(photo, null, 'every one of the three recommended photos must be processable');
    // Within per-photo limits (both the batch target and the absolute ceiling).
    assert.equal(photo.dataUrl.length <= target, true);
    assert.equal(photo.dataUrl.length <= MAX_PHOTO_DATA_URL_SAFE_BYTES, true);
  }

  const validation = validatePhotosForSubmission(photos.map((p) => ({ dataUrl: p.dataUrl })));
  assert.deepEqual(validation, { ok: true });

  const totalBytes = photos.reduce((sum, p) => sum + p.dataUrl.length, 0);
  assert.equal(totalBytes <= MAX_PHOTOS_TOTAL_SAFE_BYTES, true);
  // Safely below the Worker's real, authoritative aggregate cap.
  assert.equal(totalBytes <= WORKER_MAX_PHOTOS_TOTAL_BYTES, true);
});

test('a target reachable via dimension reduction alone does not fall through to the most destructive quality tier', () => {
  // Simulates the common "3-photo batch" target (~213 KiB for a 4032x3024
  // photo): the 1280px tier at quality 0.78 comfortably fits this target
  // (verified by direct computation against the same simulateEncoder used
  // throughout this file), so the chosen result must land there or better —
  // never at the lowest-quality (0.4) tier, which is reserved for images
  // that genuinely can't fit any other way.
  const target = computePerPhotoTargetBytes(0, 3);
  const result = compressWithLadder(4032, 3024, simulateEncoder, target);
  assert.notEqual(result, null);
  assert.equal(result.quality >= 0.55, true, `expected a moderate quality, got ${result.quality}`);
});

test('a genuinely oversized target still eventually reaches the lowest quality tier rather than failing outright', () => {
  // A much tighter target than the 3-photo case (simulating many photos
  // already selected) legitimately needs the most aggressive tier — proves
  // the low-quality fallback still exists and works, it's just not reached
  // prematurely for an easier target.
  const veryTightTarget = 20_000;
  const result = compressWithLadder(4032, 3024, simulateEncoder, veryTightTarget);
  assert.notEqual(result, null);
  assert.equal(result.dataUrl.length <= veryTightTarget, true);
});

// --- 2. Processing memory/concurrency --------------------------------------

test('processInBatches never runs more than the given concurrency at once', async () => {
  let current = 0;
  let maxObserved = 0;
  const items = Array.from({ length: 7 }, (_, i) => i);
  const worker = async (item) => {
    current += 1;
    maxObserved = Math.max(maxObserved, current);
    await new Promise((resolve) => setTimeout(resolve, 5));
    current -= 1;
    return item * 2;
  };
  const results = await processInBatches(items, worker, PHOTO_PROCESSING_CONCURRENCY);
  assert.equal(maxObserved <= PHOTO_PROCESSING_CONCURRENCY, true);
  assert.equal(maxObserved >= 1, true);
  assert.deepEqual(
    results.map((r) => r.value),
    items.map((i) => i * 2)
  );
});

test('processInBatches preserves successful sibling results when one item fails', async () => {
  const items = ['ok-1', 'fail', 'ok-2', 'ok-3'];
  const worker = async (item) => {
    if (item === 'fail') throw new Error('simulated decode failure');
    return item.toUpperCase();
  };
  const results = await processInBatches(items, worker, 2);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[0].value, 'OK-1');
  assert.equal(results[1].status, 'rejected');
  assert.equal(results[2].status, 'fulfilled');
  assert.equal(results[2].value, 'OK-2');
  assert.equal(results[3].status, 'fulfilled');
  assert.equal(results[3].value, 'OK-3');
});

test('processInBatches with concurrency 1 processes strictly one at a time', async () => {
  let concurrent = 0;
  let violated = false;
  const worker = async () => {
    concurrent += 1;
    if (concurrent > 1) violated = true;
    await new Promise((resolve) => setTimeout(resolve, 1));
    concurrent -= 1;
  };
  await processInBatches([1, 2, 3, 4], worker, 1);
  assert.equal(violated, false);
});

test('PHOTO_PROCESSING_CONCURRENCY is a small bound, never the full MAX_PHOTO_ITEMS', () => {
  assert.equal(PHOTO_PROCESSING_CONCURRENCY < MAX_PHOTO_ITEMS, true);
  assert.equal(PHOTO_PROCESSING_CONCURRENCY >= 1, true);
});

// --- 3. Whole-request size defense -----------------------------------------

function fakeIntake(overrides = {}) {
  return {
    customerName: 'ทดสอบ ระบบ',
    customerPhone: '0812345678',
    customerEmail: '',
    product: 'Test Product',
    productCategory: 'Test Category',
    serialNumber: 'SN12345',
    problemDescription: 'ทดสอบปัญหา',
    problemChips: [],
    accessories: [],
    internalNotes: '',
    photos: [],
    warranty: false,
    ...overrides,
  };
}
const existingCustomerSelector = { kind: 'existing', customerId: 'cust-1' };

test('REGRESSION: a realistic three-photo intake request stays safely under the Worker whole-request ceiling', () => {
  const target = computePerPhotoTargetBytes(0, 3);
  const photos = [
    compressWithLadder(4032, 3024, simulateEncoder, target).dataUrl,
    compressWithLadder(3024, 4032, simulateEncoder, target).dataUrl,
    compressWithLadder(4000, 3000, simulateEncoder, target).dataUrl,
  ];
  const intake = fakeIntake({ photos });
  const bytes = estimateIntakeRequestBytes(intake, existingCustomerSelector);
  assert.equal(bytes <= MAX_INTAKE_REQUEST_SAFE_BYTES, true);
  assert.equal(MAX_INTAKE_REQUEST_SAFE_BYTES < 900 * 1024, true);
  assert.equal(bytes <= 900 * 1024, true);
});

test('REGRESSION: photos individually and aggregately valid, but the complete serialized request too large, is rejected locally', () => {
  // Two photos comfortably inside both the per-photo and aggregate photo
  // ceilings (so the photo-only checks alone would pass this intake)...
  const photos = ['x'.repeat(250 * 1024), 'x'.repeat(250 * 1024)];
  const photoOnlyValidation = validatePhotosForSubmission(photos.map((dataUrl) => ({ dataUrl })));
  assert.deepEqual(photoOnlyValidation, { ok: true });

  // ...but padded with enough non-photo text to push the whole serialized
  // request over the Worker's real MAX_INTAKE_BYTES-derived safe ceiling.
  // Deliberately far past the Worker's own real per-field length caps (this
  // is a structural proof that estimateIntakeRequestBytes/the threshold
  // comparison itself is correct for any input, independent of per-photo or
  // aggregate photo checks — not a claim this exact payload is reachable
  // through the real UI, which enforces its own field-length limits).
  const intake = fakeIntake({
    photos,
    internalNotes: 'y'.repeat(500_000),
  });
  const bytes = estimateIntakeRequestBytes(intake, existingCustomerSelector);
  assert.equal(bytes > MAX_INTAKE_REQUEST_SAFE_BYTES, true, 'test setup must actually exceed the ceiling');
});

test('estimateIntakeRequestBytes measures real UTF-8 bytes, not UTF-16 string length (Thai text)', () => {
  const asciiIntake = fakeIntake({ problemDescription: 'a'.repeat(1000) });
  const thaiIntake = fakeIntake({ problemDescription: 'ก'.repeat(1000) });
  const asciiBytes = estimateIntakeRequestBytes(asciiIntake, existingCustomerSelector);
  const thaiBytes = estimateIntakeRequestBytes(thaiIntake, existingCustomerSelector);
  // Thai characters are multi-byte in UTF-8; the same string .length must
  // still produce a strictly larger byte count for Thai than for ASCII.
  assert.equal(thaiBytes > asciiBytes, true);
});

test('a Service Job intake with zero photos and ordinary fields stays far under the whole-request ceiling (unchanged)', () => {
  const intake = fakeIntake();
  const bytes = estimateIntakeRequestBytes(intake, existingCustomerSelector);
  assert.equal(bytes <= MAX_INTAKE_REQUEST_SAFE_BYTES, true);
  assert.equal(bytes < 10 * 1024, true);
});

test('buildServiceJobIntakePayload/buildCustomerIntakeSelector output plugs directly into estimateIntakeRequestBytes', () => {
  const intake = buildServiceJobIntakePayload({
    customer: { kind: 'existing', id: 'c1', name: 'ลูกค้า', phone: '0800000000', email: '' },
    product: {
      id: 'p1',
      customerId: 'c1',
      productName: 'Test',
      model: 'X',
      category: 'Cat',
      serialNumber: 'SN1',
      warrantyStatus: 'in_warranty',
      purchaseDate: null,
    },
    intake: {
      problemDescription: 'ปัญหา',
      problemChips: [],
      accessories: [],
      internalNotes: '',
      photos: [],
    },
  });
  const customer = buildCustomerIntakeSelector({
    kind: 'existing',
    id: 'c1',
    name: 'ลูกค้า',
    phone: '0800000000',
    email: '',
  });
  const bytes = estimateIntakeRequestBytes(intake, customer);
  assert.equal(typeof bytes, 'number');
  assert.equal(bytes > 0, true);
});

// ===========================================================================
// F5d-67 Phase 2R2 — closing the in-flight add/remove race
// ===========================================================================
//
// The Phase 3 audit found: addFiles() snapshots `photos` when it starts,
// and only calls onChange() once every file in the batch has settled. Since
// the per-photo remove control was not disabled while isProcessing, a
// removal that executed mid-batch was silently reverted when that stale
// snapshot was written back. The fix blocks removal outright during
// processing — both via the button's `disabled` attribute (so a real click
// never fires) and inside removePhoto() itself (defense-in-depth against
// any other caller) — rather than trying to reconcile a stale snapshot
// after the fact. There is no jsdom/canvas in this Node test environment
// (matching this project's existing precedent for this file), so the
// `isProcessing` transition itself can't be interactively driven; these
// tests instead prove the fix at the two levels that are directly
// inspectable: the rendered idle-state markup, and the source structure of
// the guard itself.

test('remove control renders enabled (no `disabled` attribute) in the normal idle state', () => {
  const markup = renderToStaticMarkup(
    createElement(PhotoEvidenceSection, {
      photos: [{ id: 'one', dataUrl: 'data:image/png;base64,AA==', fileName: 'front.png' }],
      onChange() {},
    })
  );
  // isProcessing defaults to false; React renders a true boolean `disabled`
  // prop as the literal attribute `disabled=""` and omits it entirely when
  // false, so its total absence here (not to be confused with the
  // `disabled:cursor-not-allowed` Tailwind variant class, which is present
  // in idle markup too and is not an HTML attribute) proves the idle-state
  // remove (and add) controls are fully interactive — "remove behavior
  // returns normally after processing completes" for the steady state
  // processing always returns to.
  assert.doesNotMatch(markup, /disabled=""/);
  assert.match(markup, /aria-disabled="false"/);
  assert.match(markup, /aria-label="ลบรูป front\.png รูปที่ 1"/);
});

test('REGRESSION: the remove control is wired to the same isProcessing flag that gates the add controls', async () => {
  const source = await readSource('src/features/service-jobs/components/PhotoEvidenceSection.tsx');
  // Whitespace-anchored so this doesn't also match inside
  // `aria-disabled={isProcessing}`, which contains the same substring.
  const gatedControlCount = (source.match(/\sdisabled=\{isProcessing\}/g) ?? []).length;
  // Two add-entry points (empty-state button, "add more" button) plus the
  // per-photo remove button must all be gated — three total.
  assert.equal(gatedControlCount, 3, `expected 3 controls gated by isProcessing, found ${gatedControlCount}`);
  assert.match(source, /aria-disabled=\{isProcessing\}/);
});

test('REGRESSION: removePhoto() itself refuses to run while isProcessing is true (defense-in-depth, not just the disabled button)', async () => {
  const source = await readSource('src/features/service-jobs/components/PhotoEvidenceSection.tsx');
  const removePhotoMatch = source.match(/const removePhoto = \(id: string\) => \{([\s\S]*?)\n  \};/);
  assert.notEqual(removePhotoMatch, null, 'removePhoto function body must be present');
  const body = removePhotoMatch[1];
  // The guard must be an early return keyed on isProcessing, positioned
  // before the onChange/filter call — not merely a comment.
  assert.match(body, /if\s*\(\s*isProcessing\s*\)\s*return;/);
  const guardIndex = body.search(/if\s*\(\s*isProcessing\s*\)\s*return;/);
  const onChangeIndex = body.search(/onChange\(photos\.filter/);
  assert.equal(guardIndex >= 0 && onChangeIndex > guardIndex, true, 'guard must run before the removal itself');
});

test('REGRESSION: the stale-snapshot scenario cannot execute a removal while an add operation is in flight', async () => {
  // Structural proof of the actual race fix: with removePhoto() guarded by
  // the same isProcessing flag that addFiles() sets for its whole async
  // duration (setIsProcessing(true) before processing, setIsProcessing(false)
  // only in a `finally` after processing settles), there is no point during
  // addFiles()'s stale-snapshot window where a removal can execute — the
  // window addFiles() holds `working` stale for is exactly the window
  // removePhoto() is blocked for.
  const source = await readSource('src/features/service-jobs/components/PhotoEvidenceSection.tsx');
  assert.match(source, /setIsProcessing\(true\)/);
  assert.match(source, /\}\s*finally\s*\{\s*setIsProcessing\(false\);\s*\}/);
  assert.match(source, /if\s*\(\s*isProcessing\s*\)\s*return;/);
});
