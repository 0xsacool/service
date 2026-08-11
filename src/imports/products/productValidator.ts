import { findDuplicateRowNumbers, issue, requiredField } from '../shared/validator';
import type { ValidationIssue } from '../shared/types';
import type { NormalizedProductRow, ProductImportContext } from './types';

// Per-row checks that don't need to see the rest of the batch. A row with
// neither a SKU nor a derivable Model has nothing to identify the product
// by at all ("malformed"), which is reported instead of, not alongside,
// the more specific "missing Model" — the latter would just be noise once
// the row is already flagged as structurally unusable.
function validateProductRow(
  row: NormalizedProductRow,
  context: ProductImportContext
): ValidationIssue[] {
  const { rowNumber, record } = row;
  const issues: ValidationIssue[] = [];

  if (record.sku === '' && record.model === '') {
    issues.push(
      issue(
        rowNumber,
        'MALFORMED_ROW',
        `Row ${rowNumber}: no SKU or Model — cannot identify this product`,
        'error'
      )
    );
  } else {
    const missingModel = requiredField(record.model, 'Model', rowNumber, 'MISSING_MODEL');
    if (missingModel) issues.push(missingModel);
  }

  const missingName = requiredField(
    record.productName,
    'Product Name',
    rowNumber,
    'EMPTY_PRODUCT_NAME'
  );
  if (missingName) issues.push(missingName);

  if (record.categoryRaw && context.knownCategories && !record.categoryId) {
    issues.push(
      issue(
        rowNumber,
        'INVALID_CATEGORY',
        `Row ${rowNumber}: category "${record.categoryRaw}" is not a recognized category`,
        'warning',
        'category'
      )
    );
  }

  return issues;
}

// Batch-wide checks: SKU is the unique key this framework imports on, so a
// repeated SKU is an error (which row should win is ambiguous — flag both
// for a human to resolve). A repeated Model+Variant is only a warning: a
// brand can legitimately reuse a model code across bundle SKUs, so this is
// a nudge for review, not a block.
function findProductDuplicateIssues(rows: NormalizedProductRow[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const duplicateSkus = findDuplicateRowNumbers(
    rows,
    (row) => row.rowNumber,
    (row) => row.record.sku || undefined
  );
  for (const [sku, rowNumbers] of duplicateSkus) {
    for (const rowNumber of rowNumbers) {
      issues.push(
        issue(
          rowNumber,
          'DUPLICATE_SKU',
          `Row ${rowNumber}: SKU "${sku}" also appears on row(s) ${rowNumbers
            .filter((n) => n !== rowNumber)
            .join(', ')}`,
          'error',
          'sku'
        )
      );
    }
  }

  const duplicateModels = findDuplicateRowNumbers(
    rows,
    (row) => row.rowNumber,
    (row) =>
      row.record.model ? `${row.record.model}::${row.record.variant ?? ''}` : undefined
  );
  for (const [key, rowNumbers] of duplicateModels) {
    const [model, variant] = key.split('::');
    const variantSuffix = variant ? ` (variant "${variant}")` : '';
    for (const rowNumber of rowNumbers) {
      issues.push(
        issue(
          rowNumber,
          'DUPLICATE_MODEL',
          `Row ${rowNumber}: Model "${model}"${variantSuffix} also appears on row(s) ${rowNumbers
            .filter((n) => n !== rowNumber)
            .join(', ')}`,
          'warning',
          'model'
        )
      );
    }
  }

  return issues;
}

// Returns every row's issues keyed by row number (rows with no issues are
// simply absent from the map) — the importer merges this with match-state
// (new/identical/changed) to produce the final preview status per row.
export function validateProductImport(
  rows: NormalizedProductRow[],
  context: ProductImportContext = {}
): Map<number, ValidationIssue[]> {
  const issuesByRow = new Map<number, ValidationIssue[]>();

  const addIssues = (rowNumber: number, newIssues: ValidationIssue[]) => {
    if (newIssues.length === 0) return;
    const existing = issuesByRow.get(rowNumber) ?? [];
    issuesByRow.set(rowNumber, [...existing, ...newIssues]);
  };

  for (const row of rows) {
    addIssues(row.rowNumber, validateProductRow(row, context));
  }
  for (const duplicateIssue of findProductDuplicateIssues(rows)) {
    addIssues(duplicateIssue.rowNumber, [duplicateIssue]);
  }

  return issuesByRow;
}
