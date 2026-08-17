import { RECOMMENDED_PHOTO_CHECKLIST } from '../constants';

// F5d-67 — hotfix for the production bug where a real, uncompressed
// phone-camera photo (typically 1-8 MB) pushed the intake payload past the
// Worker's existing MAX_PHOTO_DATA_URL_BYTES/MAX_PHOTOS_TOTAL_BYTES caps
// (worker/src/serviceJobCreation.ts), causing POST /service-jobs to reject
// the entire request before allocation. Those Worker caps are the
// authoritative limit and are unchanged by this fix; everything here exists
// only to make a normal camera photo fit comfortably under them without
// staff ever needing to resize anything by hand.
//
// The safe ceilings below intentionally sit under the Worker's real caps
// (300 KiB/photo, 700 KiB aggregate) — never rely on exactly hitting the
// Worker boundary, since JSON/base64 framing and multi-photo combination
// leave no room for a client estimate that lands exactly on the limit.
export const MAX_PHOTO_DATA_URL_SAFE_BYTES = 260 * 1024;
export const MAX_PHOTOS_TOTAL_SAFE_BYTES = 640 * 1024;
export const MAX_PHOTO_ITEMS = 10;

// F5d-67 Phase 2R — the UI's own recommended checklist (Product, Damaged
// Area, Serial Number) is the documented normal workflow, so three photos
// must be a guaranteed-fit case, not merely a common one. Single-sourced
// from the same checklist shown to staff rather than a duplicated literal.
export const RECOMMENDED_PHOTO_COUNT = RECOMMENDED_PHOTO_CHECKLIST.length;

// F5d-67 Phase 2R2 — the compression TARGET budget used to size individual
// photos, kept deliberately below MAX_PHOTOS_TOTAL_SAFE_BYTES (the hard
// rejection ceiling, unchanged) so the common 3-photo workflow lands with
// real headroom rather than landing exactly on the rejection boundary.
// Dividing evenly by RECOMMENDED_PHOTO_COUNT (3) gives an exact 204,800
// bytes (200 KiB) per photo with zero remainder; three such photos total
// exactly 600 KiB, leaving a genuine 40 KiB (not 1 byte) of margin under
// the 640 KiB hard ceiling, which itself still has a 60 KiB margin under
// the Worker's real 700 KiB aggregate cap.
export const PHOTOS_TARGET_AGGREGATE_BYTES = 600 * 1024;

// Longest-side cap in pixels. Large enough to keep a product overview,
// damaged area, and serial number/label text legible; small enough that a
// JPEG re-encode at this size reliably fits the safe per-photo ceiling
// within the quality tiers below for a typical camera photo.
export const MAX_IMAGE_DIMENSION = 1600;

// F5d-67 Phase 2R — restructured from a flat "hold dimension, crush quality
// to the floor" ladder into dimension/quality tiers, each tried in full
// before moving to a smaller dimension. This means a moderate quality at a
// smaller dimension is always tried before an aggressive, visibly
// destructive quality reduction at a larger one — dimension reduction is a
// gentler way to shrink a photo than crushing JPEG quality, and it alone is
// often enough to hit a tight per-photo target (e.g. when three photos are
// selected together) without ever touching the lowest quality tier.
export interface DimensionQualityTier {
  dimension: number;
  qualities: readonly number[];
}
export const DIMENSION_QUALITY_TIERS: readonly DimensionQualityTier[] = [
  { dimension: MAX_IMAGE_DIMENSION, qualities: [0.82, 0.68] },
  { dimension: 1280, qualities: [0.78, 0.62] },
  { dimension: 1024, qualities: [0.75, 0.58] },
  { dimension: 800, qualities: [0.72, 0.55] },
  { dimension: 600, qualities: [0.68, 0.5] },
  { dimension: 480, qualities: [0.6, 0.4] },
];

// F5d-67 Phase 2R — bounded concurrency for decode/compress work. Decoding
// a full-resolution camera photo into a canvas can use tens of MB per image;
// processing up to MAX_PHOTO_ITEMS (10) of them at once was never safe on
// mobile memory. A small pool keeps memory bounded while still processing
// faster than fully sequential.
export const PHOTO_PROCESSING_CONCURRENCY = 2;

export class ImageDecodeError extends Error {
  constructor(message = 'Could not decode the selected file as an image') {
    super(message);
    this.name = 'ImageDecodeError';
  }
}

export class ImageTooLargeError extends Error {
  constructor(message = 'Image remains too large after compression') {
    super(message);
    this.name = 'ImageTooLargeError';
  }
}

// Never enlarges — if the source is already at or under maxDimension on its
// longest side, it is returned unchanged. Aspect ratio is always preserved.
export function computeScaledDimensions(
  width: number,
  height: number,
  maxDimension: number
): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('computeScaledDimensions: invalid source dimensions');
  }
  const longest = Math.max(width, height);
  if (longest <= maxDimension) {
    return { width: Math.round(width), height: Math.round(height) };
  }
  const scale = maxDimension / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export interface CompressAttempt {
  quality: number;
  dataUrl: string;
}

// Pure control loop, deliberately decoupled from the real Canvas encoder so
// it can be exercised in a plain Node test with a fake `encode`. Tries each
// quality in order and returns the first result whose data URL length is at
// or under maxBytes; null if none of the offered qualities fit.
export function compressToFit(
  encode: (quality: number) => string,
  maxBytes: number,
  qualities: readonly number[]
): CompressAttempt | null {
  for (const quality of qualities) {
    const dataUrl = encode(quality);
    if (dataUrl.length <= maxBytes) {
      return { quality, dataUrl };
    }
  }
  return null;
}

// Pure orchestration: for each dimension/quality tier (never larger than
// the source), try every quality in that tier before moving to a smaller
// dimension. Decoupled from the real Canvas encoder via `makeEncoder` so
// this — including "never enlarge," "aspect ratio preserved," and "prefer
// dimension reduction over destructive quality" — is fully exercisable in a
// plain Node test. Returns null only if nothing in any tier fits.
export function compressWithLadder(
  naturalWidth: number,
  naturalHeight: number,
  makeEncoder: (width: number, height: number) => (quality: number) => string,
  maxBytes: number = MAX_PHOTO_DATA_URL_SAFE_BYTES,
  tiers: readonly DimensionQualityTier[] = DIMENSION_QUALITY_TIERS
): CompressAttempt | null {
  for (const tier of tiers) {
    const { width, height } = computeScaledDimensions(naturalWidth, naturalHeight, tier.dimension);
    const encode = makeEncoder(width, height);
    const result = compressToFit(encode, maxBytes, tier.qualities);
    if (result) return result;
    // Already at native size (no scaling occurred) and every quality in
    // this tier still didn't fit — trying a smaller tier than the original
    // is still valid (further downscale), so continue rather than stop.
  }
  return null;
}

// F5d-67 Phase 2R — the per-photo compression TARGET used for a given add
// action. Deliberately independent of any sibling photo's actual resulting
// size (no sequential dependency), so it stays correct under bounded
// concurrency regardless of completion order: every photo in the same batch
// is given the same share of the aggregate safe budget, sized against
// whichever is larger — the documented recommended workflow (3 photos) or
// the actual total this batch would produce. A lone first photo is still
// conservatively budgeted against the 3-photo case, since that's the
// documented normal workflow and a later add in a separate action must not
// retroactively invalidate an earlier accepted photo.
export function computePerPhotoTargetBytes(
  existingAcceptedCount: number,
  batchSize: number
): number {
  const expectedTotal = Math.max(RECOMMENDED_PHOTO_COUNT, existingAcceptedCount + batchSize, 1);
  return Math.min(
    MAX_PHOTO_DATA_URL_SAFE_BYTES,
    Math.floor(PHOTOS_TARGET_AGGREGATE_BYTES / expectedTotal)
  );
}

export type PhotoSubmissionValidationFailure =
  | { ok: false; reason: 'too-many-photos' }
  | { ok: false; reason: 'photo-too-large' }
  | { ok: false; reason: 'aggregate-too-large' };

export type PhotoSubmissionValidationResult =
  | { ok: true }
  | PhotoSubmissionValidationFailure;

// Defense-in-depth final check before a Service Job payload is built — every
// photo added through processPhotoFile()/PhotoEvidenceSection should already
// satisfy this, but this is the one gate that runs immediately before
// submission regardless of how a photo entered `intake.photos`.
export function validatePhotosForSubmission(
  photos: readonly { dataUrl: string }[]
): PhotoSubmissionValidationResult {
  if (photos.length > MAX_PHOTO_ITEMS) {
    return { ok: false, reason: 'too-many-photos' };
  }
  let total = 0;
  for (const photo of photos) {
    if (photo.dataUrl.length > MAX_PHOTO_DATA_URL_SAFE_BYTES) {
      return { ok: false, reason: 'photo-too-large' };
    }
    total += photo.dataUrl.length;
  }
  if (total > MAX_PHOTOS_TOTAL_SAFE_BYTES) {
    return { ok: false, reason: 'aggregate-too-large' };
  }
  return { ok: true };
}

// Would adding `candidateDataUrl` to the already-accepted `existingPhotos`
// push the running aggregate over the safe ceiling? Used at add-time so
// individually-valid photos can never combine into an oversized request —
// the offending photo is rejected rather than silently recompressing
// already-accepted ones.
export function wouldExceedAggregate(
  existingPhotos: readonly { dataUrl: string }[],
  candidateDataUrl: string
): boolean {
  const currentTotal = existingPhotos.reduce((sum, photo) => sum + photo.dataUrl.length, 0);
  return currentTotal + candidateDataUrl.length > MAX_PHOTOS_TOTAL_SAFE_BYTES;
}

// F5d-67 Phase 2R — a small bounded-concurrency pool. Each item is
// processed independently: one failure never cancels or drops the others,
// matching Promise.allSettled's per-item isolation, but never more than
// `concurrency` decode/compress operations run at once regardless of how
// many items are queued.
export async function processInBatches<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  concurrency: number
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let nextIndex = 0;
  async function runNext(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      try {
        const value = await worker(items[index], index);
        results[index] = { status: 'fulfilled', value };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }
  const poolSize = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: poolSize }, () => runNext()));
  return results;
}

async function decodeImage(file: File): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    // Modern browsers auto-apply EXIF orientation when decoding an <img>;
    // this deliberately does not attempt its own EXIF parsing/rotation —
    // it trusts the browser's own decode, matching this fix's scope.
    await image.decode();
    return image;
  } catch {
    throw new ImageDecodeError();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function encodeAtDimension(
  image: HTMLImageElement,
  width: number,
  height: number
): (quality: number) => string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new ImageDecodeError('Canvas 2D context is unavailable');
  context.drawImage(image, 0, 0, width, height);
  return (quality: number) => canvas.toDataURL('image/jpeg', quality);
}

// The full client-side pipeline: decode -> resize (never enlarge) -> encode
// JPEG with iterative quality reduction, preferring dimension reduction over
// destructive quality, falling back to progressively smaller dimensions only
// once every quality in the current tier fails. `maxBytes` defaults to the
// absolute per-photo ceiling but callers (PhotoEvidenceSection) pass the
// batch-aware target from computePerPhotoTargetBytes() so the recommended
// 3-photo workflow reliably fits the aggregate ceiling. Throws
// ImageDecodeError for an unsupported/corrupt file, or ImageTooLargeError if
// no combination in the tiers fits.
export async function processPhotoFile(
  file: File,
  maxBytes: number = MAX_PHOTO_DATA_URL_SAFE_BYTES
): Promise<{ dataUrl: string; fileName: string }> {
  if (!file.type.startsWith('image/')) {
    throw new ImageDecodeError('Selected file is not an image');
  }
  const image = await decodeImage(file);
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;

  const result = compressWithLadder(
    naturalWidth,
    naturalHeight,
    (width, height) => encodeAtDimension(image, width, height),
    maxBytes
  );
  if (!result) throw new ImageTooLargeError();
  return { dataUrl: result.dataUrl, fileName: file.name };
}
