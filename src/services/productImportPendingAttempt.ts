import {
  parseProductImportRequest,
  type ProductImportRequest,
} from './productImportRequest';

// PI-3 Slice 2 — tracks whether a wizard session currently owns an
// in-flight/retryable import attempt, and which idempotency key it owns.
// Pure and framework-agnostic so it's usable from importWizardController.ts
// and testable in isolation, with no React dependency (fetch/commit stays
// entirely outside this module).
//
// The two recovery paths this exists to distinguish:
//   - an AMBIGUOUS commit failure (network error, or a 5xx) must retry with
//     the SAME key — the Worker's idempotency replay is what makes that
//     safe (see worker/src/productImport.ts's isReplayOf).
//   - a stale_catalog rejection, or a brand new wizard session, must burn
//     the key — reusing it after the classification changes is never safe.
export type PendingAttemptState =
  | { kind: 'idle' }
  | { kind: 'active'; idempotencyKey: string };

export function startAttempt(idempotencyKey: string): PendingAttemptState {
  return { kind: 'active', idempotencyKey };
}

// No-op by design — documents the ambiguous-retry recovery path (§12): the
// same state, same key, resubmitted unchanged.
export function retainForRetry(state: PendingAttemptState): PendingAttemptState {
  return state;
}

export function discard(): PendingAttemptState {
  return { kind: 'idle' };
}

// PI-4 correction — same canonical form the Worker itself accepts
// (worker/src/serviceJobCreation.ts's isValidIdempotencyKey): a UUIDv4,
// case-insensitively. crypto.randomUUID() always emits this exact shape;
// this is the validator, not the generator, and is what both persistAttempt
// and readPersistedAttempt use to refuse anything else.
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4_PATTERN.test(value);
}

export function mintIdempotencyKey(): string {
  return crypto.randomUUID();
}

// --- Session-scoped recovery -------------------------------------------
//
// PI-4 correction — this module previously persisted whatever
// ProductImportRequest-shaped object the caller happened to pass, trusted
// entirely on the TypeScript type, never re-validated at the actual
// sessionStorage boundary. That is exactly the gap a forged/tampered
// sessionStorage entry (or a caller bug) could exploit: sessionStorage is
// plain browser-writable string storage, not a trusted channel, so nothing
// crossing it may be trusted merely because it once matched a TypeScript
// type at write time.
//
// The corrected contract, enforced on BOTH write and read:
//   - the raw serialized value has a hard maximum length, checked BEFORE
//     JSON.parse, so an arbitrarily large stored string is never even
//     parsed, let alone kept;
//   - the parsed value's outer shape is an EXACT key set — schemaVersion,
//     idempotencyKey, request, nothing else;
//   - schemaVersion must be exactly the current version;
//   - idempotencyKey must be a valid UUIDv4;
//   - request must pass the SAME authoritative parseProductImportRequest
//     the Worker itself re-validates every request against — the value
//     actually stored/returned is the parser's own canonical (NFC-normalized,
//     trimmed, bounded) output, never the caller's raw input;
//   - ANY failure at any of these steps REMOVES the stored value from
//     sessionStorage — a malformed/tampered/oversized entry is not merely
//     ignored, it is deleted, so it can never be re-encountered.
//
// What this can never contain, by construction of ProductImportRequest and
// FORBIDDEN_REQUEST_FIELDS: a Firebase ID token, an Authorization header
// value, a bearer token, any other secret, or the raw CSV file — only the
// already-narrow, already-validated request shape (rowNumber/brand/sku/
// model/productName/category, a fileName, and a catalog fingerprint).

export interface PersistedPendingAttempt {
  schemaVersion: 1;
  idempotencyKey: string;
  request: ProductImportRequest;
}

const STORAGE_KEY = 'pi3-product-import-pending-attempt';
const SCHEMA_VERSION = 1;
const ALLOWED_OUTER_KEYS = ['schemaVersion', 'idempotencyKey', 'request'] as const;

// Generous margin over any realistically valid request (200 rows × ~600
// bounded characters per row is well under 200 KiB even before accounting
// for JSON structure) but still a hard, finite ceiling — never "as large as
// the caller likes."
const MAX_STORED_ATTEMPT_LENGTH = 524_288; // 512 KiB of JS string length

function getBrowserStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

function removeStored(storage: Storage | undefined): void {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing more can be done if sessionStorage itself is unusable
    // (privacy mode, quota) — there is nothing left to remove either way.
  }
}

// Persists ONLY a value that survives the SAME authoritative parser the
// Worker re-validates every request against — never the caller's raw
// object as-is. If validation fails (should not happen in the normal
// flow, since the caller already built a well-formed request, but this is
// the actual enforcement point, not an assumption), nothing is written;
// persistence is a recovery convenience, never a requirement for the
// current in-memory attempt to keep working.
export function persistAttempt(
  idempotencyKey: string,
  request: ProductImportRequest,
  storage: Storage | undefined = getBrowserStorage()
): void {
  if (!isValidIdempotencyKey(idempotencyKey)) return;
  const validated = parseProductImportRequest(request);
  if (!validated.ok || !validated.value) return;

  try {
    const record: PersistedPendingAttempt = {
      schemaVersion: SCHEMA_VERSION,
      idempotencyKey,
      request: validated.value,
    };
    const serialized = JSON.stringify(record);
    if (serialized.length > MAX_STORED_ATTEMPT_LENGTH) return;
    storage?.setItem(STORAGE_KEY, serialized);
  } catch {
    // sessionStorage can throw (quota, privacy mode) — see above.
  }
}

export function clearPersistedAttempt(storage: Storage | undefined = getBrowserStorage()): void {
  removeStored(storage);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyAllowedOuterKeys(record: Record<string, unknown>): boolean {
  return Object.keys(record).every((key) =>
    (ALLOWED_OUTER_KEYS as readonly string[]).includes(key)
  );
}

// Strictly parses whatever sessionStorage holds. Malformed/unsupported
// stored state — oversized, garbage JSON, a wrong schema version, extra
// outer keys, an invalid idempotency key, or a request that no longer
// passes the SAME authoritative parser the Worker itself re-validates
// every request against — is not merely ignored: it is ACTIVELY REMOVED
// from sessionStorage, so a rejected entry can never be re-encountered on
// a later read. The caller then proceeds exactly as if nothing had ever
// been persisted.
export function readPersistedAttempt(
  storage: Storage | undefined = getBrowserStorage()
): PersistedPendingAttempt | null {
  let raw: string | null | undefined;
  try {
    raw = storage?.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  // Checked BEFORE JSON.parse — an oversized stored string is rejected (and
  // removed) without ever being parsed.
  if (raw.length > MAX_STORED_ATTEMPT_LENGTH) {
    removeStored(storage);
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    removeStored(storage);
    return null;
  }

  if (!isRecord(parsed) || !hasOnlyAllowedOuterKeys(parsed)) {
    removeStored(storage);
    return null;
  }
  if (parsed.schemaVersion !== SCHEMA_VERSION) {
    removeStored(storage);
    return null;
  }
  if (!isValidIdempotencyKey(parsed.idempotencyKey)) {
    removeStored(storage);
    return null;
  }

  const requestResult = parseProductImportRequest(parsed.request);
  if (!requestResult.ok || !requestResult.value) {
    removeStored(storage);
    return null;
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    idempotencyKey: parsed.idempotencyKey,
    request: requestResult.value,
  };
}
