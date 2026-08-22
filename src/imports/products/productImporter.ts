import { isBlankRow, parseRows } from '../shared/parser';
import { buildPreview, statusFrom } from '../shared/preview';
import type { MatchState } from '../shared/preview';
import { issue } from '../shared/validator';
import type {
  ImportPreview,
  ImportPreviewRow,
  TabularInput,
  ValidationIssue,
} from '../shared/types';
import {
  changedImportOwnedFields,
  matchCatalogProduct,
  type CatalogProduct,
} from '../../services/productIdentity';
import { normalizeProductRow, toIdentityFields } from './productNormalizer';
import { validateProductImport } from './productValidator';
import type {
  NormalizedProductRow,
  ProductImportContext,
  ProductImportRecord,
} from './types';

interface RowResolution {
  rowNumber: number;
  record: ProductImportRecord;
  matchState: MatchState;
  matched: CatalogProduct | null;
  issues: ValidationIssue[];
}

function resolveRow(
  row: NormalizedProductRow,
  catalog: readonly CatalogProduct[] | undefined
): RowResolution {
  const base = { rowNumber: row.rowNumber, record: row.record };

  if (!catalog) {
    return { ...base, matchState: 'new', matched: null, issues: [] };
  }

  const outcome = matchCatalogProduct(toIdentityFields(row.record), catalog);

  if (outcome.kind === 'conflict') {
    return {
      ...base,
      matchState: 'new',
      matched: null,
      issues: [
        issue(
          row.rowNumber,
          'PRODUCT_IDENTITY_CONFLICT',
          `Row ${row.rowNumber}: matches ${outcome.candidates.length} existing products — the catalog cannot tell which one this row means`,
          'error'
        ),
      ],
    };
  }

  if (outcome.kind === 'new') {
    return { ...base, matchState: 'new', matched: null, issues: [] };
  }

  const changed = changedImportOwnedFields(toIdentityFields(row.record), outcome.product);
  return {
    ...base,
    matchState: changed.length === 0 ? 'identical' : 'changed',
    matched: outcome.product,
    issues: [],
  };
}

// PI-3 §3, third bullet: two request rows that each resolve cleanly on
// their own but land on the SAME existing product. Neither row is
// individually wrong, so this cannot be caught before matching — and
// letting it through would mean one row silently overwriting the other's
// result inside a single atomic import.
function findSameTargetIssues(resolutions: RowResolution[]): ValidationIssue[] {
  const rowsByProductId = new Map<string, number[]>();
  for (const resolution of resolutions) {
    if (!resolution.matched) continue;
    const rowNumbers = rowsByProductId.get(resolution.matched.id) ?? [];
    rowNumbers.push(resolution.rowNumber);
    rowsByProductId.set(resolution.matched.id, rowNumbers);
  }

  const issues: ValidationIssue[] = [];
  for (const rowNumbers of rowsByProductId.values()) {
    if (rowNumbers.length < 2) continue;
    for (const rowNumber of rowNumbers) {
      issues.push(
        issue(
          rowNumber,
          'DUPLICATE_TARGET_PRODUCT',
          `Row ${rowNumber}: resolves to the same existing product as row(s) ${rowNumbers
            .filter((n) => n !== rowNumber)
            .join(', ')}`,
          'error'
        )
      );
    }
  }
  return issues;
}

// The single public entry point for importing Product Master data: parse
// -> normalize -> validate -> match -> classify -> preview.
//
// PI-3 — matching now goes through the shared identity module, so this
// function and the privileged Worker classify a given row identically by
// construction rather than by two implementations agreeing. Returns a
// preview only: nothing is written anywhere, no repository is touched.
export function runProductImport(
  input: TabularInput,
  context: ProductImportContext = {}
): ImportPreview<ProductImportRecord> {
  const parsedRows = parseRows(input).filter((row) => !isBlankRow(row));
  const normalizedRows = parsedRows.map((row) => normalizeProductRow(row, context));
  const issuesByRow = validateProductImport(normalizedRows, context);

  const resolutions = normalizedRows.map((row) =>
    resolveRow(row, context.existingProducts)
  );

  const sameTargetIssues = findSameTargetIssues(resolutions);
  const sameTargetByRow = new Map<number, ValidationIssue[]>();
  for (const sameTargetIssue of sameTargetIssues) {
    const existing = sameTargetByRow.get(sameTargetIssue.rowNumber) ?? [];
    sameTargetByRow.set(sameTargetIssue.rowNumber, [...existing, sameTargetIssue]);
  }

  const rows: ImportPreviewRow<ProductImportRecord>[] = resolutions.map((resolution) => {
    const issues = [
      ...(issuesByRow.get(resolution.rowNumber) ?? []),
      ...resolution.issues,
      ...(sameTargetByRow.get(resolution.rowNumber) ?? []),
    ];
    return {
      rowNumber: resolution.rowNumber,
      status: statusFrom(issues, resolution.matchState),
      record: resolution.record,
      issues,
    };
  });

  return buildPreview(rows);
}
