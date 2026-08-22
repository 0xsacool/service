import { resolveProductCategoryId } from './productCategories.ts';
import {
  changedImportOwnedFields,
  matchCatalogProduct,
  requestIdentityKey,
  type CatalogProduct,
  type ImportIdentityFields,
  type ImportOwnedField,
} from './productIdentity.ts';
import type { ProductImportRequestRow } from './productImportRequest.ts';

// PI-3 — classification of an already-validated import request against an
// authoritative catalog. This is what the privileged Worker runs INSIDE its
// transaction to re-derive every row's outcome for itself, rather than
// trusting the classification the browser sent.
//
// It is shared rather than Worker-local so that the server's verdict and
// the browser's preview are the same function over the same primitives.
// Runtime-neutral: sibling .ts imports only.

export type ProductImportRowStatus = 'new' | 'updated' | 'skipped' | 'error';

export interface ProductImportRowIssue {
  code: string;
  message: string;
}

export interface ClassifiedProductImportRow {
  rowNumber: number;
  status: ProductImportRowStatus;
  // The existing catalog document this row resolved to, for 'updated' and
  // 'skipped'. Always null for 'new' (the id does not exist yet — the
  // Worker allocates it) and for 'error'.
  productId: string | null;
  // Exactly the fields an UPDATE will write. Also the write mask.
  changedFields: ImportOwnedField[];
  // The category id this row resolved to, or null when blank/unrecognized.
  categoryId: string | null;
  warnings: ProductImportRowIssue[];
  errors: ProductImportRowIssue[];
}

export interface ProductImportClassification {
  rows: ClassifiedProductImportRow[];
  hasErrors: boolean;
  created: number;
  updated: number;
  skipped: number;
  warnings: number;
}

function toIdentityFields(
  row: ProductImportRequestRow,
  categoryId: string | null
): ImportIdentityFields {
  return {
    sku: row.sku,
    brand: row.brand,
    model: row.model,
    productName: row.productName,
    categoryId,
  };
}

export function classifyProductImport(
  rows: readonly ProductImportRequestRow[],
  catalog: readonly CatalogProduct[]
): ProductImportClassification {
  // Pass 1 — resolve category and catalog identity per row, independently.
  const resolved = rows.map((row) => {
    const categoryId = resolveProductCategoryId(row.category);
    const warnings: ProductImportRowIssue[] = [];
    const errors: ProductImportRowIssue[] = [];

    if (row.category !== null && categoryId === null) {
      warnings.push({
        code: 'unknown_category',
        message: `Row ${row.rowNumber}: category "${row.category}" is not recognized and was left unchanged`,
      });
    }

    const identity = toIdentityFields(row, categoryId);
    const outcome = matchCatalogProduct(identity, catalog);

    if (outcome.kind === 'conflict') {
      errors.push({
        code: 'product_identity_conflict',
        message: `Row ${row.rowNumber}: matches ${outcome.candidates.length} existing products`,
      });
    }

    return {
      row,
      identity,
      categoryId,
      matched: outcome.kind === 'matched' ? outcome.product : null,
      warnings,
      errors,
    };
  });

  // Pass 2 — collisions that only exist between rows.
  //
  // (a) Two rows sharing a request identity: the same SKU twice, or the
  //     same model twice among SKU-less rows.
  const rowsByIdentity = new Map<string, number[]>();
  for (const entry of resolved) {
    const key = requestIdentityKey(entry.identity);
    if (key === null) continue;
    rowsByIdentity.set(key, [...(rowsByIdentity.get(key) ?? []), entry.row.rowNumber]);
  }

  // (b) Two rows resolving to the same EXISTING product. Each row may be
  //     individually valid; together they would have one silently overwrite
  //     the other inside a single atomic import.
  const rowsByProduct = new Map<string, number[]>();
  for (const entry of resolved) {
    if (!entry.matched) continue;
    rowsByProduct.set(entry.matched.id, [
      ...(rowsByProduct.get(entry.matched.id) ?? []),
      entry.row.rowNumber,
    ]);
  }

  const collisionErrors = new Map<number, ProductImportRowIssue[]>();
  const addCollision = (rowNumber: number, issue: ProductImportRowIssue) => {
    collisionErrors.set(rowNumber, [...(collisionErrors.get(rowNumber) ?? []), issue]);
  };

  for (const [, rowNumbers] of rowsByIdentity) {
    if (rowNumbers.length < 2) continue;
    for (const rowNumber of rowNumbers) {
      addCollision(rowNumber, {
        code: 'duplicate_in_request',
        message: `Row ${rowNumber}: the same product identity appears on row(s) ${rowNumbers
          .filter((n) => n !== rowNumber)
          .join(', ')}`,
      });
    }
  }

  for (const [, rowNumbers] of rowsByProduct) {
    if (rowNumbers.length < 2) continue;
    for (const rowNumber of rowNumbers) {
      addCollision(rowNumber, {
        code: 'duplicate_in_request',
        message: `Row ${rowNumber}: resolves to the same existing product as row(s) ${rowNumbers
          .filter((n) => n !== rowNumber)
          .join(', ')}`,
      });
    }
  }

  // Pass 3 — final status per row. An error always wins over a match state:
  // a row that failed any check is never safe to create or update.
  const classified: ClassifiedProductImportRow[] = resolved.map((entry) => {
    const errors = [
      ...entry.errors,
      ...(collisionErrors.get(entry.row.rowNumber) ?? []),
    ];

    if (errors.length > 0) {
      return {
        rowNumber: entry.row.rowNumber,
        status: 'error',
        productId: null,
        changedFields: [],
        categoryId: entry.categoryId,
        warnings: entry.warnings,
        errors,
      };
    }

    if (!entry.matched) {
      return {
        rowNumber: entry.row.rowNumber,
        status: 'new',
        productId: null,
        changedFields: [],
        categoryId: entry.categoryId,
        warnings: entry.warnings,
        errors: [],
      };
    }

    const changedFields = changedImportOwnedFields(entry.identity, entry.matched);
    return {
      rowNumber: entry.row.rowNumber,
      status: changedFields.length === 0 ? 'skipped' : 'updated',
      productId: entry.matched.id,
      changedFields,
      categoryId: entry.categoryId,
      warnings: entry.warnings,
      errors: [],
    };
  });

  return {
    rows: classified,
    hasErrors: classified.some((row) => row.status === 'error'),
    created: classified.filter((row) => row.status === 'new').length,
    updated: classified.filter((row) => row.status === 'updated').length,
    skipped: classified.filter((row) => row.status === 'skipped').length,
    warnings: classified.reduce((total, row) => total + row.warnings.length, 0),
  };
}
