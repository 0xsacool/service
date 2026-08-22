// PI-3 — the wire contract for POST /products/import, defined once and
// shared. The browser builds a request with this module; the Worker
// re-validates the received body with the SAME parser. The Worker's copy is
// the authoritative one — the browser's use of it is a convenience that
// catches problems early, never a substitute.
//
// Runtime-neutral: no imports beyond sibling .ts modules, no import.meta.env,
// no firebase/React/DOM.

export const PRODUCT_IMPORT_LIMITS = {
  version: 1,
  maxBodyBytes: 1_048_576,
  maxRows: 200,
  minRowNumber: 1,
  maxRowNumber: 1_000_000,
  maxBrand: 80,
  maxSku: 128,
  maxModel: 128,
  maxProductName: 200,
  maxCategory: 80,
  maxFileName: 255,
  // The catalog fingerprint is a fixed-width lowercase SHA-256 hex digest.
  fingerprintLength: 64,
} as const;

export interface ProductImportRequestRow {
  rowNumber: number;
  brand: string;
  sku: string | null;
  model: string;
  productName: string;
  category: string | null;
}

export interface ProductImportRequest {
  version: 1;
  fileName: string | null;
  catalogFingerprint: string;
  rows: ProductImportRequestRow[];
}

const ROOT_KEYS = ['version', 'fileName', 'catalogFingerprint', 'rows'] as const;
const ROW_KEYS = [
  'rowNumber',
  'brand',
  'sku',
  'model',
  'productName',
  'category',
] as const;

// Named explicitly so the rejection is self-documenting rather than merely a
// side effect of the allowlist. Every one of these is either server-owned
// (ids, timestamps, actor), authorization state, or a field an import is
// forbidden to touch (status/warranty/associations). A body carrying any of
// them is rejected outright rather than silently ignored — silently
// ignoring would let a caller believe it had set something it had not.
export const FORBIDDEN_REQUEST_FIELDS = [
  'id',
  'productId',
  'brandId',
  'variant',
  'status',
  'warrantyMonths',
  'createdAt',
  'updatedAt',
  'actorUid',
  'createdBy',
  'updatedBy',
  'accessoryIds',
  'commonProblemIds',
  'collection',
  'path',
  'authorization',
  'canImportProducts',
] as const;

export type ProductImportRequestParseFailure =
  | 'malformed_body'
  | 'unsupported_version'
  | 'unknown_field'
  | 'forbidden_field'
  | 'too_many_rows'
  | 'no_rows'
  | 'invalid_row_number'
  | 'invalid_field'
  | 'blank_required_field'
  | 'unsafe_value';

export interface ProductImportRequestParseResult {
  ok: boolean;
  value: ProductImportRequest | null;
  failure: ProductImportRequestParseFailure | null;
  detail: string | null;
}

const invalid = (
  failure: ProductImportRequestParseFailure,
  detail: string
): ProductImportRequestParseResult => ({ ok: false, value: null, failure, detail });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Code points, not UTF-16 code units — a limit expressed in "characters"
// must not count an emoji or a surrogate pair as two.
export function codePointLength(value: string): number {
  return [...value].length;
}

// Every Product field is single-line free text, so any C0 control character
// or DEL is rejected outright.
//
// This is deliberately stricter than serviceJobCreation.ts's plain-text
// fields, which document a considered decision NOT to control-char screen
// because Firestore Rules cannot mirror per-character iteration and a
// Worker-only invariant would be an undocumented divergence. That reasoning
// does not apply here: `products` is Worker-write-only with client writes
// unconditionally denied, so there is no Rules-side validation to diverge
// FROM. The Worker is the only writer and therefore the only boundary.
export function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

// Spreadsheet formula injection: a value that a downstream CSV/Excel export
// would re-interpret as a formula when the catalog is exported and reopened.
// Product import accepts no numeric field at all, so there is no legitimate
// leading '-' to preserve — rejecting all four sigils costs nothing real.
const FORMULA_PREFIXES = ['=', '+', '-', '@'];

export function looksLikeFormula(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && FORMULA_PREFIXES.includes(trimmed[0]!);
}

// PI-4R correction — this is now the SINGLE, AUTHORITATIVE filename
// canonicalization contract, used both by the browser (before it ever
// builds a request) and by parseProductImportRequest itself (the actual
// security boundary — the Worker re-runs this same parser on every
// request it receives, regardless of what the browser already did).
// PI-4R proved browser-only sanitization was insufficient: a forged
// request sent directly to the Worker, bypassing the browser entirely,
// could otherwise carry a path-bearing fileName straight into the
// `productImports` audit record. Never trusts the caller to have already
// sanitized — always re-derives the basename and re-validates from the
// raw input.
//
// Any problem here (a path, control characters, a formula-injection
// prefix, an oversized value, or a value that reduces to nothing)
// degrades the FIELD to null rather than failing the whole request —
// fileName is audit-only free text, never used for identity, matching,
// Worker Firestore access, or any filesystem operation, so there is no
// security reason to reject an otherwise-valid import over it. This is
// the same "cosmetic field" policy already governing this field, applied
// consistently at the one place that actually enforces it authoritatively
// (previously only the browser call site behaved this leniently; the
// parser's own check used to hard-fail the entire request on some of the
// same problems, and let a path straight through on the others).
//
// Deliberately NOT the aggressive alphanumeric-only allowlist
// worker/src/paths.ts's sanitizeFileName uses for R2 object keys — that
// purpose (a safe storage-key path segment) is different from this one (a
// free-text Thai-first-compatible display string), and mangling
// "สินค้า Bruno 2026.csv" into underscores would defeat the localization
// requirement for no real security benefit.
export function sanitizeImportFileName(rawName: string): string | null {
  // Directory component, if any, is discarded — only the final path segment
  // is ever meaningful for an uploaded file's name, regardless of separator
  // style the source OS/browser might supply, and regardless of whether the
  // path is genuine (an odd browser) or forged (a direct request crafted to
  // smuggle one in).
  const basename = rawName.split(/[/\\]/).pop() ?? '';
  const normalized = basename.normalize('NFC').trim();
  if (normalized.length === 0) return null;
  if (hasControlCharacters(normalized)) return null;
  if (looksLikeFormula(normalized)) return null;
  if (codePointLength(normalized) > PRODUCT_IMPORT_LIMITS.maxFileName) return null;
  return normalized;
}

function checkUnknownAndForbidden(
  record: Record<string, unknown>,
  allowed: readonly string[],
  where: string
): ProductImportRequestParseResult | null {
  for (const key of Object.keys(record)) {
    if (
      (FORBIDDEN_REQUEST_FIELDS as readonly string[]).includes(key) &&
      !allowed.includes(key)
    ) {
      return invalid('forbidden_field', `${where}: field "${key}" may not be supplied`);
    }
    if (!allowed.includes(key)) {
      return invalid('unknown_field', `${where}: unknown field "${key}"`);
    }
  }
  return null;
}

interface BoundedTextOptions {
  max: number;
  required: boolean;
  label: string;
  where: string;
}

function boundedText(
  raw: unknown,
  options: BoundedTextOptions
): { ok: true; value: string | null } | ProductImportRequestParseResult {
  if (raw === null || raw === undefined) {
    if (options.required) {
      return invalid(
        'blank_required_field',
        `${options.where}: ${options.label} is required`
      );
    }
    return { ok: true, value: null };
  }
  if (typeof raw !== 'string') {
    return invalid('invalid_field', `${options.where}: ${options.label} must be text`);
  }
  // PI-4 correction — authoritative DISPLAY normalization is NFC, applied
  // here, before every safety check below, not merely at the identity layer.
  // Identity normalization (NFKC + fold + lowercase, productIdentity.ts's
  // normalizeIdentityValue) is a separate, downstream concern for MATCHING
  // and is never applied here — this must stay pure NFC so display case and
  // spacing are preserved exactly, never lowercased. Normalizing before the
  // checks (not after) means control-character/formula/length validation
  // runs against the exact string that will be persisted, not a
  // pre-normalization view that could differ from it: an NFD-forged request
  // must not be able to slip a noncanonical string past validation and into
  // a Product document. `normalizeDisplayValue` in productIdentity.ts
  // performs the identical NFC+trim transform for values already inside the
  // catalog; this is that same contract enforced at the parse boundary.
  const normalized = raw.normalize('NFC');
  if (hasControlCharacters(normalized)) {
    return invalid(
      'unsafe_value',
      `${options.where}: ${options.label} contains control characters`
    );
  }
  if (looksLikeFormula(normalized)) {
    return invalid(
      'unsafe_value',
      `${options.where}: ${options.label} may not begin with = + - or @`
    );
  }
  const trimmed = normalized.trim();
  if (trimmed.length === 0) {
    if (options.required) {
      return invalid(
        'blank_required_field',
        `${options.where}: ${options.label} is required`
      );
    }
    return { ok: true, value: null };
  }
  if (codePointLength(trimmed) > options.max) {
    return invalid(
      'invalid_field',
      `${options.where}: ${options.label} exceeds ${options.max} characters`
    );
  }
  return { ok: true, value: trimmed };
}

function isParseFailure(
  value: { ok: true; value: string | null } | ProductImportRequestParseResult
): value is ProductImportRequestParseResult {
  return value.ok === false;
}

// The authoritative parser. Returns a fully-typed request or a typed
// failure; never throws, never partially accepts, never coerces.
export function parseProductImportRequest(
  body: unknown
): ProductImportRequestParseResult {
  if (!isRecord(body)) return invalid('malformed_body', 'body must be a JSON object');

  const rootCheck = checkUnknownAndForbidden(body, ROOT_KEYS, 'body');
  if (rootCheck) return rootCheck;

  if (body.version !== PRODUCT_IMPORT_LIMITS.version) {
    return invalid('unsupported_version', 'body.version must be 1');
  }

  // PI-4R correction — fileName no longer goes through the generic
  // boundedText machinery (which would hard-fail the WHOLE request on a
  // control character or an oversized value, and — critically — never
  // rejected or stripped a directory path at all, since neither `/` nor
  // `\` is a control character or a formula-prefix). sanitizeImportFileName
  // is the single authoritative canonicalization: it always reduces to a
  // safe bounded basename or null, so whatever is accepted here can never
  // be a path, regardless of whether this body came from the browser's own
  // (already-sanitizing) code path or a forged direct request.
  const rawFileName = body.fileName;
  let fileName: string | null;
  if (rawFileName === null || rawFileName === undefined) {
    fileName = null;
  } else if (typeof rawFileName !== 'string') {
    return invalid('invalid_field', 'body: fileName must be text');
  } else {
    fileName = sanitizeImportFileName(rawFileName);
  }

  const fingerprint = body.catalogFingerprint;
  if (
    typeof fingerprint !== 'string' ||
    fingerprint.length !== PRODUCT_IMPORT_LIMITS.fingerprintLength ||
    !/^[0-9a-f]+$/.test(fingerprint)
  ) {
    return invalid('invalid_field', 'body.catalogFingerprint must be a SHA-256 hex digest');
  }

  if (!Array.isArray(body.rows)) {
    return invalid('malformed_body', 'body.rows must be an array');
  }
  if (body.rows.length === 0) return invalid('no_rows', 'body.rows must not be empty');
  if (body.rows.length > PRODUCT_IMPORT_LIMITS.maxRows) {
    return invalid(
      'too_many_rows',
      `body.rows exceeds the ${PRODUCT_IMPORT_LIMITS.maxRows}-row limit`
    );
  }

  const rows: ProductImportRequestRow[] = [];
  let previousRowNumber = 0;

  for (let index = 0; index < body.rows.length; index += 1) {
    const raw: unknown = body.rows[index];
    const where = `rows[${index}]`;
    if (!isRecord(raw)) return invalid('malformed_body', `${where} must be an object`);

    const rowCheck = checkUnknownAndForbidden(raw, ROW_KEYS, where);
    if (rowCheck) return rowCheck;

    const rowNumber = raw.rowNumber;
    if (
      typeof rowNumber !== 'number' ||
      !Number.isInteger(rowNumber) ||
      rowNumber < PRODUCT_IMPORT_LIMITS.minRowNumber ||
      rowNumber > PRODUCT_IMPORT_LIMITS.maxRowNumber
    ) {
      return invalid('invalid_row_number', `${where}: rowNumber is out of range`);
    }
    // Strictly ascending, which also makes them unique. Ascending (not just
    // unique) so a row's position in the request always matches its position
    // in the user's file — the row numbers in an error message have to point
    // at the right lines.
    if (rowNumber <= previousRowNumber) {
      return invalid(
        'invalid_row_number',
        `${where}: rowNumber must be strictly ascending`
      );
    }
    previousRowNumber = rowNumber;

    const brand = boundedText(raw.brand, {
      max: PRODUCT_IMPORT_LIMITS.maxBrand,
      required: true,
      label: 'brand',
      where,
    });
    if (isParseFailure(brand)) return brand;

    const sku = boundedText(raw.sku, {
      max: PRODUCT_IMPORT_LIMITS.maxSku,
      required: false,
      label: 'sku',
      where,
    });
    if (isParseFailure(sku)) return sku;

    const model = boundedText(raw.model, {
      max: PRODUCT_IMPORT_LIMITS.maxModel,
      required: true,
      label: 'model',
      where,
    });
    if (isParseFailure(model)) return model;

    const productName = boundedText(raw.productName, {
      max: PRODUCT_IMPORT_LIMITS.maxProductName,
      required: true,
      label: 'productName',
      where,
    });
    if (isParseFailure(productName)) return productName;

    const category = boundedText(raw.category, {
      max: PRODUCT_IMPORT_LIMITS.maxCategory,
      required: false,
      label: 'category',
      where,
    });
    if (isParseFailure(category)) return category;

    rows.push({
      rowNumber,
      brand: brand.value!,
      sku: sku.value,
      model: model.value!,
      productName: productName.value!,
      category: category.value,
    });
  }

  return {
    ok: true,
    failure: null,
    detail: null,
    value: {
      version: PRODUCT_IMPORT_LIMITS.version,
      fileName,
      catalogFingerprint: fingerprint,
      rows,
    },
  };
}

// The canonical serialization the idempotency fingerprint hashes (§19).
// Positional arrays, never object-key enumeration, for exactly the reason
// documented in productCatalogFingerprint.ts. Row order is the request's own
// (already proven strictly ascending by the parser), so no re-sort is needed
// or wanted — two requests differing only in row order ARE different
// requests.
export function buildCanonicalRequestString(request: ProductImportRequest): string {
  return JSON.stringify([
    'pir-1',
    request.version,
    request.fileName ?? '',
    request.catalogFingerprint,
    request.rows.map((row) => [
      row.rowNumber,
      row.brand,
      row.sku ?? '',
      row.model,
      row.productName,
      row.category ?? '',
    ]),
  ]);
}
