import type { ProductCategory } from '../types/productMaster.ts';

// PI-3 — extracted verbatim from repositories/mockData/productMaster.mock.ts
// so the Cloudflare Worker can share the exact same canonical category list
// the browser previews against. The mock fixture now re-exports this module,
// so productMasterRepository.ts / firestoreProductMasterRepository.ts keep
// working unchanged.
//
// Categories are static predefined reference data, not a Firestore
// collection — `getCategories()` reads this list even in Firestore mode
// (documented in DATABASE_SCHEMA.md's live `products` section). PI-3 adds no
// category CRUD; a category that a spreadsheet names but this list doesn't
// contain is a warning, never a blocking error.
//
// Runtime-neutral by construction: type-only import, no import.meta.env, no
// firebase/React/DOM. Every relative import carries an explicit .ts
// extension, matching src/services/serviceReport.ts — the established shape
// for a module the Worker imports for its *values*, not just its types.
export const productCategories: ProductCategory[] = [
  { id: 'hot-plate', name: 'Hot Plate' },
  { id: 'blender', name: 'Blender' },
  { id: 'toaster', name: 'Toaster' },
  { id: 'kettle', name: 'Kettle' },
  { id: 'fan', name: 'Fan' },
  { id: 'rice-cooker', name: 'Rice Cooker' },
  // Legacy categories — only referenced by the 8 Legacy Apple products in
  // the mock catalog.
  { id: 'smartphone', name: 'Smartphone' },
  { id: 'laptop', name: 'Laptop' },
  { id: 'tablet', name: 'Tablet' },
  { id: 'smartwatch', name: 'Smartwatch' },
  { id: 'headphones', name: 'Headphones' },
];

// Matches a spreadsheet's free-text category against either a canonical
// category id or its display name, trimmed and case-insensitively — the
// exact semantics productNormalizer.ts already used, lifted here so the
// Worker resolves a category identically rather than by a parallel copy.
export function resolveProductCategoryId(
  raw: string | null | undefined,
  categories: readonly ProductCategory[] = productCategories
): string | null {
  if (raw === null || raw === undefined) return null;
  const target = raw.trim().toLowerCase();
  if (target.length === 0) return null;
  const match = categories.find(
    (category) =>
      category.id.toLowerCase() === target || category.name.toLowerCase() === target
  );
  return match ? match.id : null;
}

export function isKnownProductCategoryId(
  value: string | null | undefined,
  categories: readonly ProductCategory[] = productCategories
): boolean {
  return (
    value !== null &&
    value !== undefined &&
    categories.some((category) => category.id === value)
  );
}
