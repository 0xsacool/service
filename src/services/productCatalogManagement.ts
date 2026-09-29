import type { ProductMasterEntry, ProductStatus } from '../types/productMaster.ts';
import {
  PRODUCT_IMPORT_LIMITS,
  codePointLength,
  hasControlCharacters,
  looksLikeFormula,
} from './productImportRequest.ts';

export interface ProductCatalogUpdateRequest {
  version: 1;
  brand: string;
  categoryId: string;
  model: string;
  sku: string | null;
  productName: string;
  warrantyMonths: number;
  status: ProductStatus;
}

const ALLOWED_KEYS = new Set([
  'version',
  'brand',
  'categoryId',
  'model',
  'sku',
  'productName',
  'warrantyMonths',
  'status',
]);

function requiredText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFC').trim();
  if (
    normalized.length === 0 ||
    codePointLength(normalized) > maxLength ||
    hasControlCharacters(normalized) ||
    looksLikeFormula(normalized)
  ) {
    return null;
  }
  return normalized;
}

function optionalText(value: unknown, maxLength: number): string | null | undefined {
  if (value === null || value === '') return null;
  const normalized = requiredText(value, maxLength);
  return normalized === null ? undefined : normalized;
}

export function parseProductCatalogUpdateRequest(
  input: unknown
): ProductCatalogUpdateRequest | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  if (Object.keys(raw).some((key) => !ALLOWED_KEYS.has(key)) || raw.version !== 1) {
    return null;
  }

  const brand = requiredText(raw.brand, PRODUCT_IMPORT_LIMITS.maxBrand);
  const categoryId = requiredText(raw.categoryId, PRODUCT_IMPORT_LIMITS.maxCategory);
  const model = requiredText(raw.model, PRODUCT_IMPORT_LIMITS.maxModel);
  const sku = optionalText(raw.sku, PRODUCT_IMPORT_LIMITS.maxSku);
  const productName = requiredText(raw.productName, PRODUCT_IMPORT_LIMITS.maxProductName);
  const warrantyMonths = raw.warrantyMonths;
  const status = raw.status;

  if (
    !brand ||
    !categoryId ||
    !model ||
    sku === undefined ||
    !productName ||
    !Number.isSafeInteger(warrantyMonths) ||
    Number(warrantyMonths) <= 0 ||
    (status !== 'Active' && status !== 'Legacy')
  ) {
    return null;
  }

  return {
    version: 1,
    brand,
    categoryId,
    model,
    sku,
    productName,
    warrantyMonths: Number(warrantyMonths),
    status,
  };
}

export function productCatalogUpdateFromEntry(
  entry: ProductMasterEntry
): ProductCatalogUpdateRequest {
  return {
    version: 1,
    brand: entry.brand,
    categoryId: entry.categoryId,
    model: entry.model,
    sku: entry.sku ?? null,
    productName: entry.name,
    warrantyMonths: entry.warrantyMonths,
    status: entry.status,
  };
}
