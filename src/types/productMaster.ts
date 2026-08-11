// The Product Master foundation (Sprint P1) — replaces the flat,
// Apple-based per-serial lookup with a proper catalog: categories, products,
// and their associated accessories/common problems, each addressable by a
// stable id. Adding a new product is a pure data change (a new entry in
// productMaster.mock.ts referencing existing or new category/accessory/
// problem ids) — no repository or component code changes required.
export type ProductStatus = 'Active' | 'Legacy';

export interface ProductCategory {
  id: string;
  name: string;
}

export interface AccessoryDefinition {
  id: string;
  label: string;
}

export type CommonProblemStatus = 'Active' | 'Inactive';

// Active/Inactive lets a problem be retired from the reusable catalog
// without deleting it — anything that already referenced it (a product's
// commonProblemIds, eventually a service job) keeps working, it just stops
// being offered for new selection. Sprint P4.
export interface CommonProblemDefinition {
  id: string;
  label: string;
  status: CommonProblemStatus;
  description?: string;
}

export interface ProductMasterEntry {
  id: string;
  brand: string;
  categoryId: string;
  name: string;
  model: string;
  status: ProductStatus;
  warrantyMonths: number;
  accessoryIds: string[];
  commonProblemIds: string[];
  // Optional bridge to the Import Framework (Sprint P2): an imported
  // catalog row is uniquely keyed by SKU, not by model (one model can have
  // several SKU variants). Manually-added products (Sprint P3 "Add
  // Product") have neither — there's no SKU field on that form — so these
  // stay undefined for anything never touched by an import.
  sku?: string;
  variant?: string;
}
