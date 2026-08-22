import { getField } from '../shared/parser';
import type { ParsedRow } from '../shared/types';
import { resolveProductCategoryId } from '../../services/productCategories';
import {
  normalizeDisplayValue,
  type ImportIdentityFields,
} from '../../services/productIdentity';
import type {
  KnownProductCategory,
  NormalizedProductRow,
  ProductImportContext,
  ProductImportRecord,
} from './types';

// The import framework carries `sku`/`categoryId` as `''`/`undefined` when
// absent (a spreadsheet cell is always a string); the shared identity layer
// carries both as `null`. This is the single place the two conventions meet
// — it lives here rather than in the importer so the validator can use it
// too without a circular import.
export function toIdentityFields(record: ProductImportRecord): ImportIdentityFields {
  return {
    sku: record.sku || null,
    brand: record.brand,
    model: record.model,
    productName: record.productName,
    categoryId: record.categoryId ?? null,
  };
}

// Splits a SKU into Model + Variant only when the row doesn't already
// supply both explicitly, e.g. "BOE021-WH" -> model "BOE021", variant
// "WH". This does NOT expand variant codes into full names ("WH" stays
// "WH", not "White") — that mapping would require a hardcoded
// code-to-name table per brand, which conflicts with this framework's
// "must work for any future brand, do not hardcode" requirement. Expanding
// abbreviations is a Service Admin data-entry concern, not this
// framework's.
function deriveModelAndVariantFromSku(sku: string): { model: string; variant?: string } {
  const separatorIndex = sku.lastIndexOf('-');
  if (separatorIndex <= 0 || separatorIndex === sku.length - 1) {
    return { model: sku };
  }
  return {
    model: sku.slice(0, separatorIndex),
    variant: sku.slice(separatorIndex + 1),
  };
}

const VARIANT_ALIAS_HEADERS = ['Variant', 'Variant Name', 'Color'] as const;

// PI-4R correction — getField() returns the FIRST alias header that EXISTS
// in the row, even when that column's value is blank for this row; it was
// never designed to look past a present-but-blank column to a later
// synonym, and changing that general contract would risk every OTHER use
// of getField() (Brand/Model/Product Name/Category) in ways well beyond
// this fix's scope. An unsupported-variant signal must never depend on
// which alias header happens to come first — a CSV with an empty "Variant"
// column sitting next to a meaningful "Color" column must still be caught.
// This inspects every alias header independently (not short-circuiting on
// the first one found) and collects every column that is BOTH present AND
// has a genuinely nonblank value, in a fixed, CSV-header-order-independent
// sequence — so which column the spreadsheet happens to list first can
// never change whether the row is blocked.
function collectExplicitVariantValues(fields: Record<string, string>): string[] {
  const values: string[] = [];
  for (const alias of VARIANT_ALIAS_HEADERS) {
    const target = alias.trim().toLowerCase();
    const key = Object.keys(fields).find((k) => k.toLowerCase() === target);
    if (key === undefined) continue;
    const raw = fields[key];
    if (raw && raw.trim().length > 0) {
      values.push(normalizeDisplayValue(raw));
    }
  }
  return values;
}

// Maps the company spreadsheet's own column names (whatever casing/
// spacing they use) into the internal Product Master import shape. Never
// throws and never rejects a row outright — even a row with nothing
// usable in it still produces a (mostly empty) record, so the validator
// stage is the single place that decides what's wrong with a row.
//
// PI-3 — every text field is passed through normalizeDisplayValue (NFC +
// trim) here, once, so that everything downstream (validation, matching,
// fingerprinting, and the value finally written) sees the same canonical
// form. Category resolution now uses the shared resolveProductCategoryId so
// the Worker resolves an identical category from identical text.
export function normalizeProductRow(
  row: ParsedRow,
  context: ProductImportContext = {}
): NormalizedProductRow {
  const brand = normalizeDisplayValue(getField(row.fields, 'Brand') ?? '');
  const sku = normalizeDisplayValue(getField(row.fields, 'SKU') ?? '');
  const productName = normalizeDisplayValue(
    getField(row.fields, 'Product Name', 'Name') ?? ''
  );
  const categoryRaw = getField(row.fields, 'Category') || undefined;

  const explicitModel = getField(row.fields, 'Model');
  // PI-4R correction — every alias header is inspected independently
  // (collectExplicitVariantValues), never just the first one getField()
  // would have found; an earlier blank alias can no longer mask a later
  // meaningful one. Already normalized (NFC + trim) per value, so the
  // validator's blocking check (productValidator.ts) sees exactly the
  // canonical value, never raw cell text.
  const explicitVariantValues = collectExplicitVariantValues(row.fields);
  const explicitVariant =
    explicitVariantValues.length > 0 ? explicitVariantValues.join(', ') : undefined;

  const derived = explicitModel
    ? { model: normalizeDisplayValue(explicitModel) }
    : deriveModelAndVariantFromSku(sku);

  const knownCategories: KnownProductCategory[] | undefined = context.knownCategories;

  return {
    rowNumber: row.rowNumber,
    record: {
      brand,
      model: derived.model,
      sku,
      variant: explicitVariant ?? derived.variant,
      explicitVariant,
      productName,
      categoryRaw,
      categoryId:
        (knownCategories
          ? resolveProductCategoryId(categoryRaw, knownCategories)
          : resolveProductCategoryId(categoryRaw)) ?? undefined,
    },
  };
}
