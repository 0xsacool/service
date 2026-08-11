import type { ProductMasterEntry, ProductStatus } from '../types';
import type { ProductImportRecord } from '../imports/products';
import { slugify } from '../utils/slugify';

export interface NewProductInput {
  brand: string;
  categoryId: string;
  model: string;
  sku: string;
  productName: string;
  warrantyMonths: number;
  status: ProductStatus;
}

// Imported rows that create a brand-new product default to this — the
// Import Framework (Sprint P2) deliberately never produces warranty data
// (out of scope for that sprint), but ProductMasterEntry.warrantyMonths is
// a required field, so a new row needs *some* value. Flagged clearly in
// the Import Result screen; a Service Admin corrects it via a future
// Product Master edit screen (not built this sprint).
const DEFAULT_IMPORTED_WARRANTY_MONTHS = 12;
const DEFAULT_IMPORTED_STATUS: ProductStatus = 'Active';

export function generateProductId(
  brand: string,
  model: string,
  existingIds: Set<string>
): string {
  const base = slugify(`${brand}-${model}`) || 'product';
  if (!existingIds.has(base)) return base;

  let suffix = 2;
  while (existingIds.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

type EditableEntryFields = Pick<
  ProductMasterEntry,
  'brand' | 'categoryId' | 'name' | 'model' | 'sku' | 'status' | 'warrantyMonths'
>;

function mapInputToEntryFields(input: NewProductInput): EditableEntryFields {
  return {
    brand: input.brand,
    categoryId: input.categoryId,
    name: input.productName,
    model: input.model,
    sku: input.sku || undefined,
    status: input.status,
    warrantyMonths: input.warrantyMonths,
  };
}

export function buildProductMasterEntry(
  input: NewProductInput,
  existingIds: Set<string>
): ProductMasterEntry {
  return {
    id: generateProductId(input.brand, input.model, existingIds),
    ...mapInputToEntryFields(input),
    accessoryIds: [],
    commonProblemIds: [],
  };
}

// Product Detail's General tab edit form shares the exact same field set
// and validation as Add Product (ProductFieldsForm/NewProductInput) — this
// is the one place that shape becomes an update patch instead of a new
// entry. Unlike buildProductUpdatePatch below (which only ever touches the
// handful of fields an import owns), this touches every editable field,
// because it's a deliberate full edit by an admin, not a partial import.
export function buildProductUpdateFromInput(
  input: NewProductInput
): Partial<ProductMasterEntry> {
  return mapInputToEntryFields(input);
}

// A "new" row from the Import Framework's preview becomes a full
// ProductMasterEntry this way. categoryId falls back to '' when the
// spreadsheet's category text didn't match a known category (the importer
// already surfaced that as a warning) — the product still imports, just
// uncategorized until an admin fixes it.
export function buildProductFromImportRecord(
  record: ProductImportRecord,
  existingIds: Set<string>
): ProductMasterEntry {
  return {
    id: generateProductId(record.brand, record.model, existingIds),
    brand: record.brand,
    categoryId: record.categoryId ?? '',
    name: record.productName,
    model: record.model,
    sku: record.sku || undefined,
    variant: record.variant,
    status: DEFAULT_IMPORTED_STATUS,
    warrantyMonths: DEFAULT_IMPORTED_WARRANTY_MONTHS,
    accessoryIds: [],
    commonProblemIds: [],
  };
}

// An "updated" row only ever patches the fields an import actually owns —
// brand/model/sku/variant/name, and categoryId only when the row resolved
// to a real category. warrantyMonths/status/accessoryIds/commonProblemIds
// are never touched here: those "remain manually maintained by Service
// Admin" per the Sprint P2/P3 spec, even when the same SKU reappears in a
// later import.
export function buildProductUpdatePatch(
  record: ProductImportRecord
): Partial<ProductMasterEntry> {
  return {
    brand: record.brand,
    model: record.model,
    name: record.productName,
    sku: record.sku || undefined,
    variant: record.variant,
    ...(record.categoryId ? { categoryId: record.categoryId } : {}),
  };
}
