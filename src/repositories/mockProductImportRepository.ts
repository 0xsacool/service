import type { ProductMasterEntry } from '../types';
import { productMasterRepository } from './productMasterRepository';
import type { ProductImportRequest, ProductImportRequestRow } from '../services/productImportRequest';
import { buildCanonicalRequestString } from '../services/productImportRequest';
import {
  classifyProductImport,
  type ClassifiedProductImportRow,
} from '../services/productImportClassification';
import { computeCatalogFingerprint } from '../services/productCatalogFingerprint';
import type { CatalogProduct } from '../services/productIdentity';
import { generateProductId } from '../services/productMasterAdmin';
import {
  ProductImportError,
  type ProductImportCommitResult,
  type ProductImportCommittedRow,
  type ProductImportRepository,
} from './types';

// PI-3 Slice 2 — simulates the Worker's POST /products/import contract
// entirely client-side over the mock catalog, so mock-mode development and
// tests exercise the same request/response/error shape the real Worker
// implementation in worker/src/productImport.ts produces. Reuses the same
// shared classification/fingerprint modules the Worker runs, so the two
// verdicts can never structurally diverge.

function toCatalogProduct(entry: ProductMasterEntry): CatalogProduct {
  return {
    id: entry.id,
    sku: entry.sku ?? null,
    brand: entry.brand,
    model: entry.model,
    productName: entry.name,
    categoryId: entry.categoryId || null,
  };
}

interface StoredImport {
  requestFingerprint: string;
  result: ProductImportCommitResult;
}

// Module-scoped, session-lived — same lifetime discipline as
// productMasterRepository's own in-memory Map.
const importsByKey = new Map<string, StoredImport>();

// Mirrors worker/src/productImport.ts's per-row commit loop exactly (same
// three branches, same write-mask construction from changedFields, same
// warnings.map((w) => w.message) projection) so the mock and Worker
// responses are structurally identical, not just conceptually similar.
function applyClassifiedRow(
  row: ClassifiedProductImportRow,
  requestRow: ProductImportRequestRow,
  existingIds: Set<string>
): ProductImportCommittedRow {
  const warnings = row.warnings.map((warning) => warning.message);

  if (row.status === 'new') {
    const id = generateProductId(requestRow.brand, requestRow.model, existingIds);
    existingIds.add(id);
    const entry: ProductMasterEntry = {
      id,
      brand: requestRow.brand,
      categoryId: row.categoryId ?? '',
      name: requestRow.productName,
      model: requestRow.model,
      sku: requestRow.sku ?? undefined,
      status: 'Active',
      warrantyMonths: 12,
      accessoryIds: [],
      commonProblemIds: [],
    };
    productMasterRepository.createProduct(entry);
    return { rowNumber: row.rowNumber, status: 'new', productId: id, warnings };
  }

  const productId = row.productId!;

  if (row.status === 'updated') {
    const patch: Partial<ProductMasterEntry> = {};
    for (const field of row.changedFields) {
      switch (field) {
        case 'brand':
          patch.brand = requestRow.brand;
          break;
        case 'model':
          patch.model = requestRow.model;
          break;
        case 'productName':
          patch.name = requestRow.productName;
          break;
        case 'sku':
          patch.sku = requestRow.sku ?? undefined;
          break;
        case 'categoryId':
          if (row.categoryId) patch.categoryId = row.categoryId;
          break;
      }
    }
    productMasterRepository.updateProduct(productId, patch);
    return { rowNumber: row.rowNumber, status: 'updated', productId, warnings };
  }

  // 'skipped' — matched an existing product with no owned-field change; no
  // write, same as the Worker's resultRows.push for the skipped branch.
  return { rowNumber: row.rowNumber, status: 'skipped', productId, warnings };
}

export function createMockProductImportRepository(): ProductImportRepository {
  return {
    async commit(request: ProductImportRequest, idempotencyKey: string) {
      const requestFingerprint = buildCanonicalRequestString(request);

      const previous = importsByKey.get(idempotencyKey);
      if (previous) {
        if (previous.requestFingerprint !== requestFingerprint) {
          throw new ProductImportError(
            'This import request no longer matches the one this idempotency key was used for',
            409,
            'idempotency_mismatch'
          );
        }
        return { ...previous.result, replayed: true };
      }

      const catalogBefore = productMasterRepository.getProducts().map(toCatalogProduct);
      const catalogFingerprintBefore = await computeCatalogFingerprint(catalogBefore);
      if (catalogFingerprintBefore !== request.catalogFingerprint) {
        throw new ProductImportError(
          'The product catalog has changed since this import was previewed',
          409,
          'stale_catalog'
        );
      }

      const classification = classifyProductImport(request.rows, catalogBefore);
      if (classification.hasErrors) {
        // Wire shape matches worker/src/index.ts's validation_failed body
        // exactly: only the errored rows, only {rowNumber, errors} — never
        // the full classification row.
        throw new ProductImportError(
          'One or more rows failed validation',
          400,
          'validation_failed',
          classification.rows
            .filter((row) => row.errors.length > 0)
            .map((row) => ({ rowNumber: row.rowNumber, errors: row.errors }))
        );
      }

      const requestRowsByNumber = new Map(
        request.rows.map((row) => [row.rowNumber, row])
      );
      const existingIds = new Set(catalogBefore.map((product) => product.id));
      const committedRows: ProductImportCommittedRow[] = [];

      for (const row of classification.rows) {
        const requestRow = requestRowsByNumber.get(row.rowNumber);
        if (!requestRow) continue;
        committedRows.push(applyClassifiedRow(row, requestRow, existingIds));
      }

      const catalogAfter = productMasterRepository.getProducts().map(toCatalogProduct);
      const catalogFingerprintAfter = await computeCatalogFingerprint(catalogAfter);

      const result: ProductImportCommitResult = {
        importId: idempotencyKey,
        replayed: false,
        catalogFingerprintBefore,
        catalogFingerprintAfter,
        summary: {
          total: classification.rows.length,
          created: classification.created,
          updated: classification.updated,
          skipped: classification.skipped,
          warnings: classification.warnings,
        },
        rows: committedRows,
      };

      importsByKey.set(idempotencyKey, { requestFingerprint, result });
      return result;
    },
  };
}
