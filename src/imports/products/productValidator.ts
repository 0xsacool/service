import { findDuplicateRowNumbers, issue, requiredField } from '../shared/validator';
import type { ValidationIssue } from '../shared/types';
import {
  hasSku,
  normalizeIdentityValue,
  requestIdentityKey,
} from '../../services/productIdentity';
import { toIdentityFields } from './productNormalizer';
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

  const missingBrand = requiredField(record.brand, 'Brand', rowNumber, 'MISSING_BRAND');
  if (missingBrand) issues.push(missingBrand);

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

  // PI-4 correction — Product Master Production Import's wire contract has
  // no variant/color field at all (worker/src/productImportRequest.ts's
  // FORBIDDEN_REQUEST_FIELDS explicitly rejects one), so a value here would
  // otherwise be silently discarded on commit. `record.explicitVariant` is
  // set ONLY when the CSV genuinely had a Variant/Variant Name/Color column
  // with a non-blank value for this row — never for a variant the importer
  // itself derived from splitting an ordinary hyphenated SKU
  // (productNormalizer.ts's deriveModelAndVariantFromSku), which stays
  // silently harmless exactly as before. This is a blocking error, not a
  // warning: the alternative is committing the row anyway and losing data
  // the user explicitly provided.
  if (record.explicitVariant) {
    issues.push(
      issue(
        rowNumber,
        'UNSUPPORTED_VARIANT',
        `Row ${rowNumber}: Variant/Color "${record.explicitVariant}" is not supported by Product Master Production Import — remove this column's value for this row, or represent it through Brand/Model/SKU/Product Name instead`,
        'error',
        'variant'
      )
    );
  }

  return issues;
}

// Batch-wide checks (PI-3 §3). Two rows collide when they resolve to the
// same IDENTITY, which is the shared requestIdentityKey — `sku:<normalized>`
// for a row carrying a real SKU, `model:<normalized>` for a SKU-less row.
//
// The two namespaces are deliberately separate. A SKU-bearing row and a
// SKU-less row that happen to share a model string are NOT duplicates of
// each other: they resolve against different halves of the catalog (a
// SKU-less row can only ever match a SKU-less product), so they are two
// genuinely different identities and flagging them would be a false
// positive.
//
// Both collision kinds are errors on EVERY implicated row, never a silent
// "last one wins" — which row should survive is a judgement only the person
// who made the spreadsheet can make.
function findProductDuplicateIssues(rows: NormalizedProductRow[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const duplicateIdentities = findDuplicateRowNumbers(
    rows,
    (row) => row.rowNumber,
    (row) => requestIdentityKey(toIdentityFields(row.record)) ?? undefined
  );

  for (const [key, rowNumbers] of duplicateIdentities) {
    const isSkuIdentity = key.startsWith('sku:');
    for (const rowNumber of rowNumbers) {
      const row = rows.find((candidate) => candidate.rowNumber === rowNumber);
      const others = rowNumbers.filter((n) => n !== rowNumber).join(', ');
      // Show the row's own original-cased value, never the normalized key —
      // each row should see its own spelling in its own message.
      issues.push(
        isSkuIdentity
          ? issue(
              rowNumber,
              'DUPLICATE_SKU',
              `Row ${rowNumber}: SKU "${row?.record.sku ?? ''}" also appears on row(s) ${others}`,
              'error',
              'sku'
            )
          : issue(
              rowNumber,
              'DUPLICATE_MODEL_IDENTITY',
              `Row ${rowNumber}: Model "${row?.record.model ?? ''}" has no SKU and also appears on row(s) ${others} — without a SKU these rows are the same product`,
              'error',
              'model'
            )
      );
    }
  }

  // A repeated Model across rows that DO carry distinct SKUs stays a
  // warning, not an error: a brand can legitimately reuse a model code
  // across bundle/colour SKUs. Only their resolving to the same EXISTING
  // product makes it an error, which the importer detects after matching.
  const duplicateModels = findDuplicateRowNumbers(
    rows.filter((row) => hasSku(row.record.sku)),
    (row) => row.rowNumber,
    (row) =>
      row.record.model
        ? `${normalizeIdentityValue(row.record.model)}::${normalizeIdentityValue(row.record.variant ?? '')}`
        : undefined
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
// (new/identical/changed/conflict) to produce the final preview status per
// row.
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
