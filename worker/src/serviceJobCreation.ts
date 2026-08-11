import type { ServiceJobIntakePayload } from '../../src/services/serviceJobCreation.ts';
import { bangkokIsoDate, bangkokNumberingYear } from '../../src/services/bangkokTime.ts';
import type { ServiceJob } from '../../src/types/serviceJob.ts';
import type { BrandId } from './brands.ts';

// F5d-33/F5d-34 B-8: intake photos are stored as base64 data URLs directly
// on the ServiceJob document — there is no separate attachment/R2 path for
// them. Firestore caps a single document at 1 MiB total, so the real
// governing constraint isn't "how big is a normal camera photo" (multiple
// MB, uncompressed) but "how much of that 1 MiB budget photos may consume
// without crowding out every other field." MAX_PHOTOS_TOTAL_BYTES is set
// well under that ceiling, with per-photo and per-item-count caps so one
// oversized photo can't consume the whole budget alone. This raises the
// previous ~32 KB-per-photo limit roughly 10x (enough for a reasonably
// compressed intake photo) but does NOT make raw, uncompressed phone-camera
// photos (commonly several MB) work — that needs client-side compression or
// moving photos to the existing Worker/R2 attachment pipeline instead of
// embedding them in the document, which is out of this fix's scope.
export const MAX_PHOTO_DATA_URL_BYTES = 300 * 1024;
export const MAX_PHOTOS_TOTAL_BYTES = 700 * 1024;
export const MAX_INTAKE_BYTES = 900 * 1024;
export const MAX_TRANSACTION_RETRIES = 5;
const MAX_SERVICE_JOB_COLLISION_CHECKS = 32;
const MAX_SEQUENCE_VALUE = 999999;

function nextSequence(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value >= MAX_SEQUENCE_VALUE) throw new Error('Service Job number sequence is malformed or exhausted');
  return value + 1;
}
function formatSequence(prefix: string, year: number, sequence: number): string {
  if (!Number.isInteger(year) || !Number.isInteger(sequence) || sequence < 1 || sequence > MAX_SEQUENCE_VALUE) throw new Error('Service Job number is malformed');
  return `${prefix}-${year}-${String(sequence).padStart(6, '0')}`;
}
function brandCode(brandId: BrandId): string { return brandId === 'bruno-thailand' ? 'BRN' : 'JLC'; }
// F5d-33/F5d-34 B-7: date reused bangkokIsoDate's own math inline (harmless
// duplication) but time used toLocaleTimeString with no timeZone, which
// resolves to the Workers runtime's default (UTC) rather than Bangkok —
// wrong by up to 7 hours, and specifically wrong across the Bangkok
// midnight boundary where `date` and `time` would disagree on the day.
// Both now derive from the same explicit Asia/Bangkok zone.
function buildServerJob(brandId: BrandId, intake: ServiceJobIntakePayload, now: Date): Omit<ServiceJob, 'id' | 'serviceRequestNumber'> {
  const createdAt = bangkokIsoDate(now);
  const time = now.toLocaleTimeString('th-TH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Bangkok' });
  const chips = intake.problemChips.join(', ');
  const issue = chips || intake.problemDescription.trim().slice(0, 80) || 'Reported issue';
  const description = intake.problemDescription.trim() || chips || 'No additional description provided.';
  return { brandId, customerName: intake.customerName, customerPhone: intake.customerPhone, customerEmail: intake.customerEmail, product: intake.product, productCategory: intake.productCategory, serialNumber: intake.serialNumber, issue, description, status: 'Received', priority: 'Normal', createdAt, updatedAt: createdAt, technician: 'Unassigned', estimatedCompletion: '—', warranty: intake.warranty, photos: intake.photos, accessories: intake.accessories, timeline: [{ status: 'Received', title: 'Claim received', description: 'Product received at the service counter and logged into the system.', date: createdAt, time, done: true, current: true }], notes: intake.internalNotes.trim() ? [{ author: 'Staff', date: createdAt, text: intake.internalNotes.trim() }] : [], closedAt: null, publicTrackingTokenHash: null, publicTrackingCodeHash: null };
}

type UnknownRecord = Record<string, unknown>;
function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}
function string(value: unknown, max: number, required = true): string | null {
  return typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0) ? value : null;
}
function strings(value: unknown, maxItems: number, maxLength: number): string[] | null {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  return value.every((entry) => typeof entry === 'string' && entry.length <= maxLength) ? value : null;
}
// Bounds both each photo individually and the sum across all of them, so
// the aggregate stays inside MAX_PHOTOS_TOTAL_BYTES regardless of how the
// per-photo allowance is split across the (up to maxItems) photos.
function photoDataUrls(
  value: unknown,
  maxItems: number,
  maxItemBytes: number,
  maxTotalBytes: number
): string[] | null {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  let total = 0;
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length > maxItemBytes) return null;
    total += entry.length;
    if (total > maxTotalBytes) return null;
  }
  return value as string[];
}

export function parseServiceJobIntake(value: unknown): ServiceJobIntakePayload | null {
  const body = record(value);
  if (!body || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'intake')) return null;
  const intake = record(body.intake);
  if (!intake) return null;
  const allowed = ['customerName', 'customerPhone', 'customerEmail', 'product', 'productCategory', 'serialNumber', 'problemDescription', 'problemChips', 'accessories', 'internalNotes', 'photos', 'warranty'];
  if (Object.keys(intake).some((key) => !allowed.includes(key))) return null;
  const customerName = string(intake.customerName, 200);
  const customerPhone = string(intake.customerPhone, 64);
  const customerEmail = string(intake.customerEmail, 320, false);
  const product = string(intake.product, 300);
  const productCategory = string(intake.productCategory, 100);
  const serialNumber = string(intake.serialNumber, 150);
  const problemDescription = string(intake.problemDescription, 4000, false);
  const problemChips = strings(intake.problemChips, 20, 160);
  const accessories = strings(intake.accessories, 50, 160);
  const internalNotes = string(intake.internalNotes, 4000, false);
  const photos = photoDataUrls(intake.photos, 10, MAX_PHOTO_DATA_URL_BYTES, MAX_PHOTOS_TOTAL_BYTES);
  if (customerName === null || customerPhone === null || customerEmail === null || product === null || productCategory === null || serialNumber === null || problemDescription === null || problemChips === null || accessories === null || internalNotes === null || photos === null || typeof intake.warranty !== 'boolean') return null;
  return { customerName, customerPhone, customerEmail, product, productCategory, serialNumber, problemDescription, problemChips, accessories, internalNotes, photos, warranty: intake.warranty };
}

export function isValidIdempotencyKey(value: string | null): value is string {
  return value !== null && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export interface AllocationTransaction { readonly id: string; }
export interface ServiceJobCreationDataAccess {
  beginServiceJobTransaction(): Promise<AllocationTransaction>;
  getIntakeKey(transaction: AllocationTransaction, key: string): Promise<string | null>;
  getSequence(transaction: AllocationTransaction, brandId: BrandId, type: 'tracking_number' | 'service_request', year: number): Promise<number | null>;
  getServiceJob(transaction: AllocationTransaction, id: string): Promise<ServiceJob | null>;
  commitServiceJobCreation(transaction: AllocationTransaction, input: { key: string; job: ServiceJob; trackingSequence: number; serviceRequestSequence: number; year: number }): Promise<void>;
}
export class TransactionConflictError extends Error {}

export async function allocateServiceJob(input: { brandId: BrandId; key: string; intake: ServiceJobIntakePayload; dataAccess: ServiceJobCreationDataAccess; now?: () => Date }): Promise<ServiceJob> {
  const now = input.now ?? (() => new Date());
  for (let attempt = 0; attempt < MAX_TRANSACTION_RETRIES; attempt += 1) {
    const transaction = await input.dataAccess.beginServiceJobTransaction();
    const existingId = await input.dataAccess.getIntakeKey(transaction, input.key);
    if (existingId) {
      const existing = await input.dataAccess.getServiceJob(transaction, existingId);
      if (!existing) throw new Error('Idempotency record has no canonical Service Job');
      return existing;
    }
    const current = now();
    const year = bangkokNumberingYear(current);
    const trackingStart = nextSequence(await input.dataAccess.getSequence(transaction, input.brandId, 'tracking_number', year) ?? 0);
    const serviceRequestSequence = nextSequence(await input.dataAccess.getSequence(transaction, input.brandId, 'service_request', year) ?? 0);
    let trackingSequence = trackingStart;
    let id: string | null = null;
    for (let probe = 0; probe < MAX_SERVICE_JOB_COLLISION_CHECKS; probe += 1) {
      const candidate = formatSequence(brandCode(input.brandId), year, trackingSequence);
      if (!(await input.dataAccess.getServiceJob(transaction, candidate))) { id = candidate; break; }
      trackingSequence = nextSequence(trackingSequence);
    }
    if (!id) throw new Error('Service Job tracking collision limit reached');
    const job: ServiceJob = { ...buildServerJob(input.brandId, input.intake, current), id, serviceRequestNumber: formatSequence('SR', year, serviceRequestSequence) };
    try {
      await input.dataAccess.commitServiceJobCreation(transaction, { key: input.key, job, trackingSequence, serviceRequestSequence, year });
      return job;
    } catch (error) {
      if (error instanceof TransactionConflictError && attempt + 1 < MAX_TRANSACTION_RETRIES) continue;
      throw error;
    }
  }
  throw new Error('Service Job transaction retries exhausted');
}
