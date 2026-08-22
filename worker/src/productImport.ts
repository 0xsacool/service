import {
  buildCanonicalRequestString,
  parseProductImportRequest,
  PRODUCT_IMPORT_LIMITS,
  type ProductImportRequest,
} from '../../src/services/productImportRequest.ts';
import {
  classifyProductImport,
  type ClassifiedProductImportRow,
} from '../../src/services/productImportClassification.ts';
import {
  computeCatalogFingerprint,
  sha256Hex,
} from '../../src/services/productCatalogFingerprint.ts';
import type { CatalogProduct } from '../../src/services/productIdentity.ts';
import {
  MAX_TRANSACTION_RETRIES,
  TransactionConflictError,
  type AllocationTransaction,
} from './serviceJobCreation.ts';

// PI-3 — the privileged Product Master import transaction.
//
// Every rule this enforces exists because the browser cannot be trusted with
// any of it: Firestore Rules deny client writes to `products` outright
// (DECISIONS.md #030), so this Worker is the only writer and therefore the
// only validation boundary that matters. The browser's preview is advisory —
// this module re-reads the authoritative catalog and re-derives every row's
// outcome for itself before writing anything.

export const PRODUCT_IMPORT_OPERATION = 'product_import_v1';

// The whole catalog is read inside the transaction to recompute the
// fingerprint. That is bounded rather than unbounded: past this many
// documents the import fails closed instead of fingerprinting a partial view
// (which would silently defeat stale-catalog detection). Chosen well above
// any plausible near-term catalog and well under Firestore's own limits.
export const MAX_CATALOG_PRODUCTS = 2000;

// New products imported this way get a definite, non-guessed baseline. An
// import never carries status or warranty on the wire, so these are the only
// possible values for a brand-new row, and they are never applied on update.
export const IMPORTED_PRODUCT_STATUS = 'Active';
export const IMPORTED_PRODUCT_WARRANTY_MONTHS = 12;

export class ProductImportValidationError extends Error {
  public readonly rows: ClassifiedProductImportRow[];
  constructor(message: string, rows: ClassifiedProductImportRow[]) {
    super(message);
    this.name = 'ProductImportValidationError';
    this.rows = rows;
  }
}
export class StaleCatalogError extends Error {}
export class IdempotencyMismatchError extends Error {}
export class CatalogTooLargeError extends Error {}
export class ProductImportRetryExhaustedError extends Error {}

export interface ProductCatalogState {
  revision: number;
}

export interface CompletedProductImportRow {
  rowNumber: number;
  status: 'new' | 'updated' | 'skipped';
  productId: string;
  warnings: string[];
}

// The durable audit + idempotency record. Bounded by construction: it stores
// outcomes and identifiers only — never the raw CSV, never the raw request
// JSON, never a bearer token, never customer data.
export interface CompletedProductImport {
  operation: string;
  actorUid: string;
  requestFingerprint: string;
  fileName: string | null;
  startedAt: string;
  completedAt: string;
  catalogFingerprintBefore: string;
  catalogFingerprintAfter: string;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  warnings: number;
  productIds: string[];
  rows: CompletedProductImportRow[];
  status: 'completed';
}

export interface ProductCreateWrite {
  productId: string;
  brand: string;
  categoryId: string;
  model: string;
  sku: string | null;
  productName: string;
}

export interface ProductUpdateWrite {
  productId: string;
  // Only the changed import-owned fields. This IS the update mask — nothing
  // outside it is sent, so status/warrantyMonths/accessoryIds/
  // commonProblemIds/createdAt survive untouched.
  fields: Partial<Pick<ProductCreateWrite, 'brand' | 'categoryId' | 'model' | 'sku' | 'productName'>>;
}

export interface ProductImportCommitInput {
  key: string;
  record: CompletedProductImport;
  creates: ProductCreateWrite[];
  updates: ProductUpdateWrite[];
  // null means "do not touch the catalog state document" — used when the
  // import mutated nothing (a SKIP-only import).
  nextCatalogRevision: number | null;
  now: string;
}

export interface ProductImportDataAccess {
  beginTransaction(): Promise<AllocationTransaction>;
  getProductImport(
    transaction: AllocationTransaction,
    key: string
  ): Promise<CompletedProductImport | null>;
  listProducts(
    transaction: AllocationTransaction,
    limit: number
  ): Promise<CatalogProduct[]>;
  getProductCatalogState(
    transaction: AllocationTransaction
  ): Promise<ProductCatalogState | null>;
  commitProductImport(
    transaction: AllocationTransaction,
    input: ProductImportCommitInput
  ): Promise<void>;
}

export interface ProductImportResult {
  record: CompletedProductImport;
  replayed: boolean;
}

// Parses and validates the raw body. Separated from the transaction so a
// malformed request is rejected before any Firestore work begins.
export function parseProductImportBody(body: unknown) {
  return parseProductImportRequest(body);
}

export async function computeRequestFingerprint(
  request: ProductImportRequest
): Promise<string> {
  return await sha256Hex(buildCanonicalRequestString(request));
}

function isReplayOf(
  existing: CompletedProductImport,
  actorUid: string,
  requestFingerprint: string
): boolean {
  return (
    existing.operation === PRODUCT_IMPORT_OPERATION &&
    existing.actorUid === actorUid &&
    existing.requestFingerprint === requestFingerprint
  );
}

export async function runProductImportTransaction(input: {
  key: string;
  actorUid: string;
  request: ProductImportRequest;
  dataAccess: ProductImportDataAccess;
  now?: () => Date;
  newProductId?: () => string;
}): Promise<ProductImportResult> {
  const now = input.now ?? (() => new Date());
  // Server-allocated, never derived from anything the browser sent. A
  // browser-supplied or slug-derived id would let two concurrent imports
  // collide on the same document, and would let a caller choose where its
  // data lands.
  const newProductId = input.newProductId ?? (() => crypto.randomUUID());

  const requestFingerprint = await computeRequestFingerprint(input.request);
  const startedAt = now().toISOString();

  for (let attempt = 0; attempt < MAX_TRANSACTION_RETRIES; attempt += 1) {
    // A fresh transaction per attempt — every retry must re-read the
    // authoritative catalog, never reuse the previous attempt's view.
    const transaction = await input.dataAccess.beginTransaction();

    const existing = await input.dataAccess.getProductImport(transaction, input.key);
    if (existing) {
      // A replay returns the canonical stored outcome and writes nothing.
      // Anything else sharing this key — a different actor, a different
      // operation, or a different body — is a genuine conflict, never a
      // silent overwrite.
      if (!isReplayOf(existing, input.actorUid, requestFingerprint)) {
        throw new IdempotencyMismatchError(
          'This idempotency key was already used for a different import'
        );
      }
      return { record: existing, replayed: true };
    }

    const catalog = await input.dataAccess.listProducts(
      transaction,
      MAX_CATALOG_PRODUCTS + 1
    );
    if (catalog.length > MAX_CATALOG_PRODUCTS) {
      throw new CatalogTooLargeError(
        `The product catalog exceeds the ${MAX_CATALOG_PRODUCTS}-item import limit`
      );
    }

    const catalogFingerprintBefore = await computeCatalogFingerprint(catalog);
    if (catalogFingerprintBefore !== input.request.catalogFingerprint) {
      // Abort and re-preview. Deliberately NOT "reclassify against the new
      // catalog and commit anyway" — the staff member approved a specific
      // set of outcomes, and the catalog they approved against no longer
      // exists.
      throw new StaleCatalogError(
        'The product catalog changed after this import was previewed'
      );
    }

    const classification = classifyProductImport(input.request.rows, catalog);
    if (classification.hasErrors) {
      // Any error blocks the ENTIRE import. There is no partial write:
      // nothing has been written at this point and the transaction is
      // abandoned uncommitted.
      throw new ProductImportValidationError(
        'This import contains rows that cannot be applied',
        classification.rows
      );
    }

    const creates: ProductCreateWrite[] = [];
    const updates: ProductUpdateWrite[] = [];
    const resultRows: CompletedProductImportRow[] = [];

    for (const row of classification.rows) {
      const source = input.request.rows.find(
        (candidate) => candidate.rowNumber === row.rowNumber
      )!;

      if (row.status === 'new') {
        const productId = newProductId();
        creates.push({
          productId,
          brand: source.brand,
          // An unrecognized or blank category never blocks the row; it
          // simply imports uncategorized, with the warning already attached.
          categoryId: row.categoryId ?? '',
          model: source.model,
          sku: source.sku,
          productName: source.productName,
        });
        resultRows.push({
          rowNumber: row.rowNumber,
          status: 'new',
          productId,
          warnings: row.warnings.map((warning) => warning.message),
        });
        continue;
      }

      if (row.status === 'updated') {
        const productId = row.productId!;
        const fields: ProductUpdateWrite['fields'] = {};
        for (const field of row.changedFields) {
          if (field === 'brand') fields.brand = source.brand;
          if (field === 'model') fields.model = source.model;
          if (field === 'productName') fields.productName = source.productName;
          if (field === 'sku') fields.sku = source.sku;
          // categoryId only ever appears in changedFields when the row
          // resolved to a recognized category, so an unknown category can
          // never clear an existing one.
          if (field === 'categoryId') fields.categoryId = row.categoryId ?? '';
        }
        updates.push({ productId, fields });
        resultRows.push({
          rowNumber: row.rowNumber,
          status: 'updated',
          productId,
          warnings: row.warnings.map((warning) => warning.message),
        });
        continue;
      }

      resultRows.push({
        rowNumber: row.rowNumber,
        status: 'skipped',
        productId: row.productId!,
        warnings: row.warnings.map((warning) => warning.message),
      });
    }

    const mutating = creates.length > 0 || updates.length > 0;

    // The projected post-import catalog, fingerprinted so the audit record
    // states what the catalog became, not merely what it was.
    const projected: CatalogProduct[] = [
      ...catalog.map((product) => {
        const update = updates.find((candidate) => candidate.productId === product.id);
        return update ? { ...product, ...update.fields } : product;
      }),
      ...creates.map((create) => ({
        id: create.productId,
        sku: create.sku,
        brand: create.brand,
        model: create.model,
        productName: create.productName,
        categoryId: create.categoryId || null,
      })),
    ];
    const catalogFingerprintAfter = await computeCatalogFingerprint(projected);

    const state = await input.dataAccess.getProductCatalogState(transaction);
    const currentRevision = state?.revision ?? 0;
    // A SKIP-only import mutated no product, so the catalog did not change
    // and its revision must not move — a revision bump is a statement that
    // the catalog changed. The completed audit record is still written: the
    // import genuinely happened and completed, it simply had nothing to do.
    const nextCatalogRevision = mutating ? currentRevision + 1 : null;

    const completedAt = now().toISOString();
    const record: CompletedProductImport = {
      operation: PRODUCT_IMPORT_OPERATION,
      actorUid: input.actorUid,
      requestFingerprint,
      fileName: input.request.fileName,
      startedAt,
      completedAt,
      catalogFingerprintBefore,
      catalogFingerprintAfter,
      total: input.request.rows.length,
      created: creates.length,
      updated: updates.length,
      skipped: classification.skipped,
      warnings: classification.warnings,
      productIds: resultRows.map((row) => row.productId),
      rows: resultRows,
      status: 'completed',
    };

    try {
      await input.dataAccess.commitProductImport(transaction, {
        key: input.key,
        record,
        creates,
        updates,
        nextCatalogRevision,
        now: completedAt,
      });
      return { record, replayed: false };
    } catch (error) {
      if (error instanceof TransactionConflictError) {
        if (attempt + 1 < MAX_TRANSACTION_RETRIES) continue;
        // The Service Report allocator lets the raw TransactionConflictError
        // propagate on exhaustion, because it has no typed error contract to
        // satisfy. This route does: §22 requires a distinct
        // transaction_retry_exhausted outcome, so exhaustion is converted
        // here rather than falling through to the generic 503 that every
        // other unexpected failure produces. The two are genuinely different
        // conditions — one means "the catalog is too busy right now, retrying
        // is reasonable", the other means "something is wrong".
        throw new ProductImportRetryExhaustedError(
          'Product import could not be committed after repeated conflicts'
        );
      }
      throw error;
    }
  }

  // Unreachable while the loop body either returns or throws, kept as a
  // defensive backstop so a future edit that adds a `continue` path cannot
  // silently fall out of the function with no result.
  throw new ProductImportRetryExhaustedError(
    'Product import could not be committed after repeated conflicts'
  );
}

export { PRODUCT_IMPORT_LIMITS };
