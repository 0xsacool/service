import type {
  CustomerIntakeSelector,
  ServiceJobIntakePayload,
} from '../../src/services/serviceJobCreation.ts';
import { bangkokIsoDate, bangkokNumberingYear } from '../../src/services/bangkokTime.ts';
import {
  CHANNEL_IDS,
  ORDER_VERIFICATIONS,
  type ChannelId,
  type OrderVerification,
  type ServiceJob,
} from '../../src/types/serviceJob.ts';
import type { BrandId } from './brands.ts';
import { logAllocatorTransactionRetriesExhausted } from './allocatorDiagnostics.ts';

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
  if (!Number.isInteger(value) || value < 0 || value >= MAX_SEQUENCE_VALUE)
    throw new Error('Service Job number sequence is malformed or exhausted');
  return value + 1;
}
function formatSequence(prefix: string, year: number, sequence: number): string {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(sequence) ||
    sequence < 1 ||
    sequence > MAX_SEQUENCE_VALUE
  )
    throw new Error('Service Job number is malformed');
  return `${prefix}-${year}-${String(sequence).padStart(6, '0')}`;
}
function brandCode(brandId: BrandId): string {
  return brandId === 'bruno-thailand' ? 'BRN' : 'JLC';
}
// F5d-33/F5d-34 B-7: date reused bangkokIsoDate's own math inline (harmless
// duplication) but time used toLocaleTimeString with no timeZone, which
// resolves to the Workers runtime's default (UTC) rather than Bangkok —
// wrong by up to 7 hours, and specifically wrong across the Bangkok
// midnight boundary where `date` and `time` would disagree on the day.
// Both now derive from the same explicit Asia/Bangkok zone.
// F5d-69 — exported (previously module-private) so the intake-metadata test
// can assert what actually gets persisted, matching the same
// export-for-reuse precedent F5d-66 set for record()/string()/strings().
export function buildServerJob(
  brandId: BrandId,
  intake: ServiceJobIntakePayload,
  now: Date
): Omit<ServiceJob, 'id' | 'serviceRequestNumber'> {
  const createdAt = bangkokIsoDate(now);
  const time = now.toLocaleTimeString('th-TH', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Bangkok',
  });
  const chips = intake.problemChips.join(', ');
  const issue =
    chips || intake.problemDescription.trim().slice(0, 80) || 'Reported issue';
  const description =
    intake.problemDescription.trim() || chips || 'No additional description provided.';
  return {
    brandId,
    customerName: intake.customerName,
    customerPhone: intake.customerPhone,
    customerEmail: intake.customerEmail,
    product: intake.product,
    productCategory: intake.productCategory,
    serialNumber: intake.serialNumber,
    issue,
    description,
    status: 'Received',
    priority: 'Normal',
    createdAt,
    updatedAt: createdAt,
    technician: 'Unassigned',
    estimatedCompletion: '—',
    warranty: intake.warranty,
    photos: intake.photos,
    accessories: intake.accessories,
    timeline: [
      {
        status: 'Received',
        title: 'Claim received',
        description:
          'Product received at the service counter and logged into the system.',
        date: createdAt,
        time,
        done: true,
        current: true,
      },
    ],
    notes: intake.internalNotes.trim()
      ? [{ author: 'Staff', date: createdAt, text: intake.internalNotes.trim() }]
      : [],
    closedAt: null,
    publicTrackingTokenHash: null,
    publicTrackingCodeHash: null,
    // F5d-69 — already validated and invariant-resolved by
    // parseServiceJobIntake(); persisted verbatim as part of the existing
    // atomic Service Job write, with no additional Firestore write and no
    // customer-document mutation.
    contactChannel: intake.contactChannel ?? null,
    contactChannelIdentity: intake.contactChannelIdentity ?? null,
    orderNumber: intake.orderNumber ?? null,
    orderVerification: intake.orderVerification ?? null,
    purchaseDate: intake.purchaseDate ?? null,
    orderDeliveredDate: intake.orderDeliveredDate ?? null,
    externalEvidenceUrl: intake.externalEvidenceUrl ?? null,
    externalEvidenceNote: intake.externalEvidenceNote ?? null,
  };
}

// F5d-66 — exported (previously module-private) so serviceReportCreation.ts
// can reuse these exact bounded wire-body parsing primitives instead of
// duplicating them. Deliberately not shared with any app-side validation:
// this Worker's own parse layer is independently strict about untrusted
// request-body bounds (length/array-count caps), separate from app-side
// state validation, matching parseServiceJobIntake()'s existing precedent.
type UnknownRecord = Record<string, unknown>;
export function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}
export function string(value: unknown, max: number, required = true): string | null {
  return typeof value === 'string' &&
    value.length <= max &&
    (!required || value.trim().length > 0)
    ? value
    : null;
}
export function strings(value: unknown, maxItems: number, maxLength: number): string[] | null {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  return value.every((entry) => typeof entry === 'string' && entry.length <= maxLength)
    ? value
    : null;
}
// F5d-69 — bounded parsers for the optional contact/order/evidence metadata.
//
// SECURITY: the Worker holds privileged Firestore credentials and therefore
// bypasses Firestore Rules entirely, so these are the ONLY validation that
// runs on the creation path. Firestore Rules validate the same fields on
// later browser updates; the frontend's own validation is UX only. Every
// parser returns an explicit ok/value pair rather than reusing `null` as
// both "absent" and "invalid" — for these fields null is a legitimate
// accepted value, so the two outcomes must stay distinguishable.
export interface ParsedField<T> {
  ok: boolean;
  value: T;
}
const invalidField = <T>(): ParsedField<T | null> => ({ ok: false, value: null });
const nullField = <T>(): ParsedField<T | null> => ({ ok: true, value: null });

// Used only by nullableHttpsUrl below — see that function's comment for why
// the URL field alone screens for control characters. Ordinary text fields
// deliberately do not use this; see nullableBoundedString's comment.
function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

// Trim policy (explicit, per the locked contract): surrounding whitespace —
// including a CR/LF/tab paste artifact from another app — is always
// trimmed, a value that is blank after trimming resolves to null rather
// than persisting an empty string, and the length bound applies to the
// trimmed value. Trimming does not alter the display value itself, so
// orderNumber's "preserve exactly what staff typed" requirement still holds.
//
// F5d-69 Phase 2A-FIX: no interior-character screening is performed here.
// The original version rejected any control character outright (including
// before trimming, so a value like "ABC\r\n" failed even though trimming
// alone would have produced a clean "ABC") on the theory that Firestore
// Rules' RE2 `.` never matches a newline. That theory only holds for
// nullableHttpsUrl's whole-string `matches('https://.*')` pattern — Rules'
// validOptionalString for these plain fields has no character-class check
// at all, so the Worker's blanket rejection was a Worker-only invariant
// Rules did not mirror: exactly the divergence this contract exists to
// avoid, in the wrong direction (the Worker refusing something Rules would
// have accepted right back). Rules also has no per-character iteration, so
// there is no robust way to make it mirror a generic "no control character
// anywhere" rule. Ordinary text fields therefore rely on type + trimmed-
// length bounds only, matching exactly what Rules enforce on later edits.
// externalEvidenceUrl keeps its own stricter check — see nullableHttpsUrl.
export function nullableBoundedString(value: unknown, max: number): ParsedField<string | null> {
  if (value === undefined || value === null) return nullField();
  if (typeof value !== 'string') return invalidField();
  const trimmed = value.trim();
  if (trimmed.length === 0) return nullField();
  if (trimmed.length > max) return invalidField();
  return { ok: true, value: trimmed };
}

export function nullableEnum<T extends string>(
  value: unknown,
  allowed: readonly T[]
): ParsedField<T | null> {
  if (value === undefined || value === null) return nullField();
  if (typeof value !== 'string') return invalidField();
  return (allowed as readonly string[]).includes(value)
    ? { ok: true, value: value as T }
    : invalidField();
}

// Strict YYYY-MM-DD plus real calendar validation — 2026-02-30 and
// 2026-13-01 are both rejected here. Firestore Rules cannot perform this
// second step (no date arithmetic is available for it), so Rules enforce
// only the syntactic form with month/day ranges; see DECISIONS.md #041 and
// the Rules comment for that deliberate, documented asymmetry.
export function nullableCalendarDate(value: unknown): ParsedField<string | null> {
  const parsed = nullableBoundedString(value, 10);
  if (!parsed.ok) return invalidField();
  if (parsed.value === null) return nullField();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed.value)) return invalidField();
  const year = Number(parsed.value.slice(0, 4));
  const month = Number(parsed.value.slice(5, 7));
  const day = Number(parsed.value.slice(8, 10));
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  )
    return invalidField();
  return { ok: true, value: parsed.value };
}

// Robust URL parsing, never a startsWith() prefix test: `new URL()` resolves
// the real scheme, so javascript:, data:, http: and malformed input are all
// rejected on their actual protocol rather than on string shape. The value
// is only ever stored and displayed — no Worker code path fetches it.
//
// This field stays strict even though nullableBoundedString's generic text
// fields no longer screen for control characters (see that function's
// comment): the WHATWG URL parser silently *strips* ASCII tab/CR/LF from
// its input instead of rejecting it (verified directly —
// `new URL('https://example.com/\na')` parses cleanly to a href with no
// newline in it) rather than throwing, so relying on `new URL()` alone here
// would silently rewrite a control-character-bearing value instead of
// failing closed on it, contradicting "keeps its strict HTTPS contract".
// The explicit check below makes any control character anywhere in the raw
// value — including a trailing paste artifact the other fields would
// simply trim away — fail closed instead. This mirrors Rules'
// validOptionalHttpsUrl, whose whole-string `matches('https://.*')` also
// fails closed on an embedded newline (RE2's `.` never matches one), so
// Worker and Rules stay aligned specifically for this field.
export function nullableHttpsUrl(value: unknown, max: number): ParsedField<string | null> {
  if (typeof value === 'string' && hasControlCharacters(value)) return invalidField();
  const parsed = nullableBoundedString(value, max);
  if (!parsed.ok) return invalidField();
  if (parsed.value === null) return nullField();
  let url: URL;
  try {
    url = new URL(parsed.value);
  } catch {
    return invalidField();
  }
  if (url.protocol !== 'https:') return invalidField();
  return { ok: true, value: parsed.value };
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
  if (!body || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'intake'))
    return null;
  const intake = record(body.intake);
  if (!intake) return null;
  const allowed = [
    'customerName',
    'customerPhone',
    'customerEmail',
    'product',
    'productCategory',
    'serialNumber',
    'problemDescription',
    'problemChips',
    'accessories',
    'internalNotes',
    'photos',
    'warranty',
    // F5d-69 — all optional; an older client that sends none of these still
    // parses to a fully valid intake with every new field resolved to null.
    'contactChannel',
    'contactChannelIdentity',
    'orderNumber',
    'orderVerification',
    'purchaseDate',
    'orderDeliveredDate',
    'externalEvidenceUrl',
    'externalEvidenceNote',
  ];
  if (Object.keys(intake).some((key) => !allowed.includes(key))) return null;
  const customerName = string(intake.customerName, 200);
  const customerPhone = string(intake.customerPhone, 64);
  const customerEmail = string(intake.customerEmail, 320, false);
  const product = string(intake.product, 300);
  const productCategory = string(intake.productCategory, 100);
  // F5d-65 — was required (matching every existing derived RegisteredProduct,
  // which always has a real serial — Terra P2 already excludes blank ones
  // from ever being selectable). Manual "Register New Product" registration
  // (approved scope item #7) explicitly allows an unknown/absent serial —
  // it just forfeits repeat-visit recognition, a pre-existing, documented
  // limitation (BUSINESS_RULES.md), not a new risk. Widened to optional so
  // that path can actually submit; every existing caller already sends a
  // real serial and is unaffected.
  const serialNumber = string(intake.serialNumber, 150, false);
  const problemDescription = string(intake.problemDescription, 4000, false);
  const problemChips = strings(intake.problemChips, 20, 160);
  const accessories = strings(intake.accessories, 50, 160);
  const internalNotes = string(intake.internalNotes, 4000, false);
  const photos = photoDataUrls(
    intake.photos,
    10,
    MAX_PHOTO_DATA_URL_BYTES,
    MAX_PHOTOS_TOTAL_BYTES
  );
  const contactChannel = nullableEnum(intake.contactChannel, CHANNEL_IDS);
  const contactChannelIdentity = nullableBoundedString(intake.contactChannelIdentity, 120);
  const orderNumber = nullableBoundedString(intake.orderNumber, 64);
  const orderVerification = nullableEnum(intake.orderVerification, ORDER_VERIFICATIONS);
  const purchaseDate = nullableCalendarDate(intake.purchaseDate);
  const orderDeliveredDate = nullableCalendarDate(intake.orderDeliveredDate);
  const externalEvidenceUrl = nullableHttpsUrl(intake.externalEvidenceUrl, 2048);
  const externalEvidenceNote = nullableBoundedString(intake.externalEvidenceNote, 1000);
  if (
    customerName === null ||
    customerPhone === null ||
    customerEmail === null ||
    product === null ||
    productCategory === null ||
    serialNumber === null ||
    problemDescription === null ||
    problemChips === null ||
    accessories === null ||
    internalNotes === null ||
    photos === null ||
    typeof intake.warranty !== 'boolean' ||
    !contactChannel.ok ||
    !contactChannelIdentity.ok ||
    !orderNumber.ok ||
    !orderVerification.ok ||
    !purchaseDate.ok ||
    !orderDeliveredDate.ok ||
    !externalEvidenceUrl.ok ||
    !externalEvidenceNote.ok
  )
    return null;
  return {
    customerName,
    customerPhone,
    customerEmail,
    product,
    productCategory,
    serialNumber,
    problemDescription,
    problemChips,
    accessories,
    internalNotes,
    photos,
    warranty: intake.warranty,
    ...resolveIntakeMetadata({
      contactChannel: contactChannel.value,
      contactChannelIdentity: contactChannelIdentity.value,
      orderNumber: orderNumber.value,
      orderVerification: orderVerification.value,
      purchaseDate: purchaseDate.value,
      orderDeliveredDate: orderDeliveredDate.value,
      externalEvidenceUrl: externalEvidenceUrl.value,
      externalEvidenceNote: externalEvidenceNote.value,
    }),
  };
}

// F5d-69 cross-field invariants, applied once here so the parsed payload and
// the persisted document can never disagree. These are resolutions, not
// rejections: a client that omits orderVerification alongside a real
// orderNumber is expressing "not checked yet", and a phone-channel identity
// is redundant rather than malicious, so both normalize rather than failing
// the whole Service Job creation. Firestore Rules enforce the same
// invariants on later browser updates.
export interface ServiceJobIntakeMetadata {
  contactChannel: ChannelId | null;
  contactChannelIdentity: string | null;
  orderNumber: string | null;
  orderVerification: OrderVerification | null;
  purchaseDate: string | null;
  orderDeliveredDate: string | null;
  externalEvidenceUrl: string | null;
  externalEvidenceNote: string | null;
}

export function resolveIntakeMetadata(
  metadata: ServiceJobIntakeMetadata
): ServiceJobIntakeMetadata {
  // (C) identity cannot outlive the channel it belongs to; (D) the 'phone'
  // channel never carries its own identity — the customer's canonical phone
  // is the identity, and duplicating it here would create a second, driftable
  // copy of the same fact.
  const contactChannelIdentity =
    metadata.contactChannel === null || metadata.contactChannel === 'phone'
      ? null
      : metadata.contactChannelIdentity;
  // (A) verification state is meaningless without an order number; (B) an
  // order number with no stated verification defaults to 'unverified'.
  const orderVerification =
    metadata.orderNumber === null
      ? null
      : (metadata.orderVerification ?? 'unverified');
  return {
    ...metadata,
    contactChannelIdentity,
    orderVerification,
  };
}

// F5d-65 — the customer branch is a small, separate discriminator alongside
// `intake` rather than extra fields folded into it: `intake.customerName/
// customerPhone/customerEmail` already carry the name/phone/email a new
// customer needs (buildServiceJobIntakePayload() populates them identically
// for an existing or a brand-new customer), so duplicating those into a
// second nested object would only invite the two copies to disagree. This
// parser's only job is to fail closed on a malformed or ambiguous shape —
// e.g. a 'new' branch that also smuggles a customerId, or an 'existing'
// branch missing one — before any Firestore call is attempted.
function parseCustomerIntakeSelector(value: unknown): CustomerIntakeSelector | null {
  const body = record(value);
  if (!body || typeof body.kind !== 'string') return null;
  if (body.kind === 'new') {
    return Object.keys(body).length === 1 ? { kind: 'new' } : null;
  }
  if (body.kind === 'existing') {
    if (Object.keys(body).length !== 2 || !Object.hasOwn(body, 'customerId')) return null;
    const customerId = string(body.customerId, 200);
    return customerId ? { kind: 'existing', customerId } : null;
  }
  return null;
}

export interface ServiceJobCreateRequest {
  intake: ServiceJobIntakePayload;
  customer: CustomerIntakeSelector;
}

// Deployment reality this Worker must tolerate: Worker and frontend source
// deploy through separate, sequential gates in this project (every prior F5d
// rollout — e.g. Gate 7's Worker deploy landing before F5d-61/62's frontend
// deploy — confirms Worker-ahead-of-frontend windows are real, not
// hypothetical), so a newly deployed Worker must keep accepting the exact
// legacy body a still-live older frontend sends. The legacy shape is exactly
// `{ intake }` — one key, no `customer` at all — and is treated identically
// to an explicit `{ kind: 'existing', customerId: '' }`: no customer write,
// the unchanged four-write commit. Only the new two-key `{ intake, customer }`
// shape may declare a 'new' customer; anything else (0 keys, 3+ keys, wrong
// key names) is rejected exactly as before.
const LEGACY_EXISTING_CUSTOMER: CustomerIntakeSelector = {
  kind: 'existing',
  customerId: '',
};

// The full POST /service-jobs body parser. Delegates the `intake`
// sub-object to parseServiceJobIntake() unchanged (by re-wrapping it in the
// single-key shape that function already expects) rather than duplicating
// its bounds checks here — one allowlist per field, not two.
export function parseServiceJobCreateRequest(value: unknown): ServiceJobCreateRequest | null {
  const body = record(value);
  if (!body || !Object.hasOwn(body, 'intake')) return null;
  const keys = Object.keys(body);

  if (keys.length === 1) {
    const intake = parseServiceJobIntake({ intake: body.intake });
    return intake ? { intake, customer: LEGACY_EXISTING_CUSTOMER } : null;
  }

  if (keys.length === 2 && Object.hasOwn(body, 'customer')) {
    const intake = parseServiceJobIntake({ intake: body.intake });
    const customer = parseCustomerIntakeSelector(body.customer);
    return intake && customer ? { intake, customer } : null;
  }

  return null;
}

export function isValidIdempotencyKey(value: string | null): value is string {
  return (
    value !== null &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

export interface AllocationTransaction {
  readonly id: string;
}

// F5d-65 — the additional document the allocator's atomic commit writes only
// when `customer.kind === 'new'`. `id` is allocated fresh per attempt (see
// allocateServiceJob() below), never derived from `phone` — a phone-keyed
// document ID would force two real people who happen to share a phone number
// onto one Customer document, contradicting BUSINESS_RULES.md's own "no hard
// uniqueness constraint on phone" rule. `brandId` is always the authenticated
// staff's own verified brand (never client-supplied) — see
// authorizeStaffCreation()/index.ts.
export interface NewCustomerAllocation {
  id: string;
  name: string;
  phone: string;
  email: string;
  brandId: BrandId;
}

export interface ServiceJobCreationDataAccess {
  beginServiceJobTransaction(): Promise<AllocationTransaction>;
  getIntakeKey(transaction: AllocationTransaction, key: string): Promise<string | null>;
  // F5d-66 — widened to include 'repair_report' so the Service Report
  // allocator (serviceReportCreation.ts) can reuse this exact method/
  // implementation for FR-{YYYY}-{SEQ} allocation instead of introducing a
  // parallel sequence-read method; the underlying numberSequences document
  // shape and firestoreClient.ts implementation are already fully generic
  // on `type`. Existing 'tracking_number'/'service_request' callers are
  // unaffected — this is a type-level widening only.
  getSequence(
    transaction: AllocationTransaction,
    brandId: BrandId,
    type: 'tracking_number' | 'service_request' | 'repair_report',
    year: number
  ): Promise<number | null>;
  getServiceJob(
    transaction: AllocationTransaction,
    id: string
  ): Promise<ServiceJob | null>;
  serviceJobExists(transaction: AllocationTransaction, id: string): Promise<boolean>;
  commitServiceJobCreation(
    transaction: AllocationTransaction,
    input: {
      key: string;
      job: ServiceJob;
      trackingSequence: number;
      serviceRequestSequence: number;
      year: number;
      // F5d-65 — null for an existing customer (no customer write at all,
      // unchanged four-write commit); set only for a brand-new customer, in
      // which case the implementation must add exactly one create-only
      // `customers/{id}` write to the same atomic :commit as the Service
      // Job, intake key, and sequence writes — never a separate request.
      newCustomer: NewCustomerAllocation | null;
    }
  ): Promise<void>;
}
export class TransactionConflictError extends Error {}

export async function allocateServiceJob(input: {
  brandId: BrandId;
  key: string;
  intake: ServiceJobIntakePayload;
  // F5d-65 — optional and defaults to 'existing' with no id, so every
  // pre-existing caller (offline tests included) that never passed this
  // parameter keeps its exact prior behavior: no customer write, four-write
  // commit, unchanged. Only an explicit { kind: 'new' } adds the fifth write.
  customer?: CustomerIntakeSelector;
  dataAccess: ServiceJobCreationDataAccess;
  now?: () => Date;
}): Promise<ServiceJob> {
  const now = input.now ?? (() => new Date());
  const customer: CustomerIntakeSelector = input.customer ?? {
    kind: 'existing',
    customerId: '',
  };
  for (let attempt = 0; attempt < MAX_TRANSACTION_RETRIES; attempt += 1) {
    const transaction = await input.dataAccess.beginServiceJobTransaction();
    const existingId = await input.dataAccess.getIntakeKey(transaction, input.key);
    if (existingId) {
      const existing = await input.dataAccess.getServiceJob(transaction, existingId);
      if (!existing) throw new Error('Idempotency record has no canonical Service Job');
      return existing;
    }
    // A fresh opaque id is generated on every attempt, never reused across a
    // retry — safe because a TransactionConflictError only ever happens when
    // the whole atomic :commit (Service Job + intake key + sequences +
    // customer) was rejected in full: Firestore's :commit is all-or-nothing,
    // so a rejected attempt has written nothing anywhere, and the intake-key
    // check above already guarantees a genuinely *successful* prior attempt
    // is returned as-is instead of ever reaching this line again — so this
    // can never allocate two different ids for the same logical customer.
    const newCustomer: NewCustomerAllocation | null =
      customer.kind === 'new'
        ? {
            id: crypto.randomUUID(),
            name: input.intake.customerName,
            phone: input.intake.customerPhone,
            email: input.intake.customerEmail,
            brandId: input.brandId,
          }
        : null;
    const current = now();
    const year = bangkokNumberingYear(current);
    const trackingStart = nextSequence(
      (await input.dataAccess.getSequence(
        transaction,
        input.brandId,
        'tracking_number',
        year
      )) ?? 0
    );
    const serviceRequestSequence = nextSequence(
      (await input.dataAccess.getSequence(
        transaction,
        input.brandId,
        'service_request',
        year
      )) ?? 0
    );
    let trackingSequence = trackingStart;
    let id: string | null = null;
    for (let probe = 0; probe < MAX_SERVICE_JOB_COLLISION_CHECKS; probe += 1) {
      const candidate = formatSequence(brandCode(input.brandId), year, trackingSequence);
      if (!(await input.dataAccess.serviceJobExists(transaction, candidate))) {
        id = candidate;
        break;
      }
      trackingSequence = nextSequence(trackingSequence);
    }
    if (!id) throw new Error('Service Job tracking collision limit reached');
    const job: ServiceJob = {
      ...buildServerJob(input.brandId, input.intake, current),
      id,
      serviceRequestNumber: formatSequence('SR', year, serviceRequestSequence),
    };
    try {
      await input.dataAccess.commitServiceJobCreation(transaction, {
        key: input.key,
        job,
        trackingSequence,
        serviceRequestSequence,
        year,
        newCustomer,
      });
      return job;
    } catch (error) {
      if (
        error instanceof TransactionConflictError &&
        attempt + 1 < MAX_TRANSACTION_RETRIES
      )
        continue;
      // F5d-59: reached only when every allowed retry attempt has been
      // exhausted with a TransactionConflictError still occurring on the
      // last one (the loop's own condition above already ruled out "will
      // retry"). logAllocatorStageFailure()'s unconditional
      // TransactionConflictError skip (see allocatorDiagnostics.ts) means
      // this exact case would otherwise stay completely unattributed, no
      // matter how deeply firestore-commit's own wrap sees it — this is the
      // one call site that actually knows "this was the last attempt."
      // Fires at most once per allocateServiceJob() call, only here, never
      // on a retryable attempt. The original error is rethrown completely
      // unchanged immediately after.
      if (error instanceof TransactionConflictError)
        logAllocatorTransactionRetriesExhausted();
      throw error;
    }
  }
  throw new Error('Service Job transaction retries exhausted');
}
