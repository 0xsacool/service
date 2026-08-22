import type { CatalogProduct } from '../../services/productIdentity';

// Import-time Product Master fields only. Deliberately narrower than
// src/types/productMaster.ts's ProductMasterEntry — accessories, common
// problems, warranty months, and status stay Service-Admin-maintained
// (Sprint P2 spec), so this framework never produces them. Turning a
// ProductImportRecord into a full ProductMasterEntry (deciding sensible
// defaults for the admin-only fields on brand-new products) is a future
// decision for whatever consumes this output, not this framework's job.
export interface ProductImportRecord {
  brand: string;
  model: string;
  sku: string;
  // Populated from EITHER an explicit CSV column OR split off the SKU when
  // no Model column was given (deriveModelAndVariantFromSku) — display/
  // dedup use only (Mock-only ProductMasterEntry.variant, the
  // DUPLICATE_MODEL warning key). Never sent to the Worker: the Production
  // wire contract has no variant field at all.
  variant?: string;
  // PI-4 correction — set ONLY when the CSV actually had a Variant/
  // Variant Name/Color column with a non-blank value for this row, never
  // when `variant` above came from the harmless internal SKU-splitting
  // fallback. This is what distinguishes "the user explicitly supplied
  // data the Production contract cannot represent" (must block import,
  // never silently drop) from "cosmetic legacy derivation from an ordinary
  // hyphenated SKU" (must not block an otherwise-valid row).
  explicitVariant?: string;
  productName: string;
  categoryId?: string;
  categoryRaw?: string;
}

// What the importer needs to know about a category to accept it — not the
// full ProductCategory shape, so this framework never has to import
// anything from src/repositories or src/types/productMaster.
export interface KnownProductCategory {
  id: string;
  name: string;
}

// PI-3 — "a product that already exists" is now the shared CatalogProduct
// shape (src/services/productIdentity.ts), so the browser preview and the
// privileged Worker match against structurally identical input. It carries
// the document `id` (which the previous shape lacked) because PI-3 needs to
// detect two request rows resolving to the same existing product, and
// because the catalog fingerprint is keyed by id.
export type ExistingProductRecord = CatalogProduct;

export interface ProductImportContext {
  existingProducts?: ExistingProductRecord[];
  knownCategories?: KnownProductCategory[];
}

// Pairs a normalized record with the row it came from, so the validator
// and preview stages don't need to re-derive row numbers from array
// position.
export interface NormalizedProductRow {
  rowNumber: number;
  record: ProductImportRecord;
}
