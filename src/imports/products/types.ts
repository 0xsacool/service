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
  variant?: string;
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

// Minimal projection of "a product that already exists" that a caller
// builds from whatever repository it's using (mock today, Firestore
// later) — the importer only ever reads this shape, never a repository
// directly, so importer logic doesn't change when the backend does.
export interface ExistingProductRecord {
  sku: string;
  brand: string;
  model: string;
  variant?: string;
  productName: string;
  categoryId?: string;
}

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
