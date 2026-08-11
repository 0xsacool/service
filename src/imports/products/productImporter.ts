import { isBlankRow, parseRows } from '../shared/parser';
import { buildPreview, statusFrom } from '../shared/preview';
import type { MatchState } from '../shared/preview';
import type { ImportPreview, ImportPreviewRow, TabularInput } from '../shared/types';
import { normalizeProductRow } from './productNormalizer';
import { validateProductImport } from './productValidator';
import type {
  ExistingProductRecord,
  ProductImportContext,
  ProductImportRecord,
} from './types';

function fieldsMatch(a: ProductImportRecord, b: ExistingProductRecord): boolean {
  return (
    a.brand === b.brand &&
    a.model === b.model &&
    (a.variant ?? '') === (b.variant ?? '') &&
    a.productName === b.productName &&
    (a.categoryId ?? '') === (b.categoryId ?? '')
  );
}

function matchStateFor(
  record: ProductImportRecord,
  existingProducts: ExistingProductRecord[] | undefined
): MatchState {
  if (!existingProducts || !record.sku) return 'new';
  const existing = existingProducts.find(
    (product) => product.sku.toLowerCase() === record.sku.toLowerCase()
  );
  if (!existing) return 'new';
  return fieldsMatch(record, existing) ? 'identical' : 'changed';
}

// The single public entry point for importing Product Master data: parse
// -> normalize -> validate -> classify -> preview. Everything it depends
// on (parser/validator/preview building blocks) is entity-agnostic; the
// only product-specific pieces are the normalizer and validator this
// function wires together. Returns a preview only — nothing is written
// anywhere, per Sprint P2 scope (no repository call, no UI).
export function runProductImport(
  input: TabularInput,
  context: ProductImportContext = {}
): ImportPreview<ProductImportRecord> {
  const parsedRows = parseRows(input).filter((row) => !isBlankRow(row));
  const normalizedRows = parsedRows.map((row) => normalizeProductRow(row, context));
  const issuesByRow = validateProductImport(normalizedRows, context);

  const rows: ImportPreviewRow<ProductImportRecord>[] = normalizedRows.map((row) => {
    const issues = issuesByRow.get(row.rowNumber) ?? [];
    const matchState = matchStateFor(row.record, context.existingProducts);
    return {
      rowNumber: row.rowNumber,
      status: statusFrom(issues, matchState),
      record: row.record,
      issues,
    };
  });

  return buildPreview(rows);
}
