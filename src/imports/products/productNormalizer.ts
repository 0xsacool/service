import { getField } from '../shared/parser';
import type { ParsedRow } from '../shared/types';
import type {
  KnownProductCategory,
  NormalizedProductRow,
  ProductImportContext,
} from './types';

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

function resolveCategoryId(
  categoryRaw: string | undefined,
  knownCategories: KnownProductCategory[] | undefined
): string | undefined {
  if (!categoryRaw || !knownCategories) return undefined;
  const target = categoryRaw.toLowerCase();
  const match = knownCategories.find(
    (category) =>
      category.id.toLowerCase() === target || category.name.toLowerCase() === target
  );
  return match?.id;
}

// Maps the company spreadsheet's own column names (whatever casing/
// spacing they use) into the internal Product Master import shape. Never
// throws and never rejects a row outright — even a row with nothing
// usable in it still produces a (mostly empty) record, so the validator
// stage is the single place that decides what's wrong with a row.
export function normalizeProductRow(
  row: ParsedRow,
  context: ProductImportContext = {}
): NormalizedProductRow {
  const brand = getField(row.fields, 'Brand') ?? '';
  const sku = getField(row.fields, 'SKU') ?? '';
  const productName = getField(row.fields, 'Product Name', 'Name') ?? '';
  const categoryRaw = getField(row.fields, 'Category') || undefined;

  const explicitModel = getField(row.fields, 'Model');
  const explicitVariant = getField(row.fields, 'Variant', 'Variant Name', 'Color');

  const derived = explicitModel
    ? { model: explicitModel }
    : deriveModelAndVariantFromSku(sku);

  return {
    rowNumber: row.rowNumber,
    record: {
      brand,
      model: derived.model,
      sku,
      variant: explicitVariant || derived.variant,
      productName,
      categoryRaw,
      categoryId: resolveCategoryId(categoryRaw, context.knownCategories),
    },
  };
}
