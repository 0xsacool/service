// PI-3 — the single definition of Product Master identity, shared verbatim
// between the browser preview and the privileged Worker commit. Both
// runtimes import THIS module rather than each maintaining a parallel copy,
// because a divergence here would mean the preview classifies a row one way
// and the server writes it another — the exact failure a stale-catalog abort
// exists to prevent, but arriving through drift instead of concurrency.
//
// Runtime-neutral: no imports at all, no import.meta.env, no firebase, no
// React, no DOM.

// A product as the catalog holds it, reduced to the fields identity and
// classification actually depend on. Both the browser (from
// ProductMasterEntry) and the Worker (from a Firestore document) project
// into this shape before matching, so neither side's storage quirks leak
// into the matching rules.
export interface CatalogProduct {
  id: string;
  sku: string | null;
  brand: string;
  model: string;
  productName: string;
  categoryId: string | null;
}

// The import-owned fields of one incoming row, already display-normalized.
// Deliberately narrower than CatalogProduct: an import never carries an id
// (the server allocates it) and never carries status/warranty/associations.
export interface ImportIdentityFields {
  sku: string | null;
  brand: string;
  model: string;
  productName: string;
  categoryId: string | null;
}

// DISPLAY normalization — what actually gets stored and shown. NFC (the
// canonical composed form) so visually identical Thai/accented text has one
// byte representation; trimmed at the edges; interior whitespace and the
// user's own casing preserved exactly, because this is the value a human
// will read back in the catalog.
export function normalizeDisplayValue(value: string): string {
  return value.normalize('NFC').trim();
}

// IDENTITY normalization — what "the same product" means. NFKC (compatibility
// composed) so full-width/half-width and other compatibility variants of the
// same characters collapse together; trimmed; lowercased with toLowerCase()
// rather than toLocaleLowerCase(), which is deliberate: a locale-sensitive
// fold would make the same CSV match differently depending on where the
// staff member's browser or the Worker happens to be running.
export function normalizeIdentityValue(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}

// A SKU that is absent, null, or blank-after-trim is "no SKU at all" — the
// three are one state, not three. Everything downstream branches on this
// single predicate so a `''` from a spreadsheet cell and a `null` from
// Firestore can never be treated differently.
export function hasSku(sku: string | null | undefined): sku is string {
  return typeof sku === 'string' && sku.trim().length > 0;
}

export type ProductMatchOutcome =
  | { kind: 'matched'; product: CatalogProduct }
  | { kind: 'new' }
  | { kind: 'conflict'; candidates: CatalogProduct[] };

// Resolve one incoming row against the authoritative catalog.
//
// SKU PRESENT:
//   1. Exact normalized match against a product's real SKU.
//   2. If none, the legacy fallback: a product that has NO SKU at all, whose
//      normalized Model equals the incoming normalized SKU. This exists
//      because products seeded or hand-added before SKUs existed are keyed
//      by their model code, and re-importing them with that code as the SKU
//      must adopt the existing row rather than duplicate it.
//   3. Exactly one candidate is required; two or more is a conflict, never
//      an arbitrary pick.
//
// SKU ABSENT:
//   Match ONLY products that themselves have no SKU, by normalized Model. A
//   blank-SKU row must never attach itself to a SKU-bearing product just
//   because the model happens to match — that product is a different,
//   more-specifically-identified thing, and silently patching it would let
//   an under-specified spreadsheet row overwrite a precisely identified one.
export function matchCatalogProduct(
  row: ImportIdentityFields,
  catalog: readonly CatalogProduct[]
): ProductMatchOutcome {
  if (hasSku(row.sku)) {
    const target = normalizeIdentityValue(row.sku);

    const skuMatches = catalog.filter(
      (product) => hasSku(product.sku) && normalizeIdentityValue(product.sku) === target
    );
    if (skuMatches.length === 1) return { kind: 'matched', product: skuMatches[0]! };
    if (skuMatches.length > 1) return { kind: 'conflict', candidates: skuMatches };

    const legacyMatches = catalog.filter(
      (product) => !hasSku(product.sku) && normalizeIdentityValue(product.model) === target
    );
    if (legacyMatches.length === 1) return { kind: 'matched', product: legacyMatches[0]! };
    if (legacyMatches.length > 1) return { kind: 'conflict', candidates: legacyMatches };

    return { kind: 'new' };
  }

  const modelTarget = normalizeIdentityValue(row.model);
  if (modelTarget.length === 0) return { kind: 'new' };

  const modelMatches = catalog.filter(
    (product) => !hasSku(product.sku) && normalizeIdentityValue(product.model) === modelTarget
  );
  if (modelMatches.length === 1) return { kind: 'matched', product: modelMatches[0]! };
  if (modelMatches.length > 1) return { kind: 'conflict', candidates: modelMatches };
  return { kind: 'new' };
}

// The key two rows in the SAME request collide on. Rows carrying a real SKU
// collide by SKU; SKU-less rows collide by model, in a separate namespace so
// a SKU-bearing row and a SKU-less row that happen to share a model string
// are not reported as duplicates of each other (they resolve against
// different halves of the catalog and are genuinely different identities).
export function requestIdentityKey(row: ImportIdentityFields): string | null {
  if (hasSku(row.sku)) return `sku:${normalizeIdentityValue(row.sku)}`;
  const model = normalizeIdentityValue(row.model);
  return model.length > 0 ? `model:${model}` : null;
}

// Which import-owned fields differ between an incoming row and the product
// it matched. Empty means the row is a genuine no-op (SKIP); non-empty means
// UPDATE, and is also exactly the write mask the Worker applies.
//
// Two deliberate asymmetries:
//  - `sku` is compared by IDENTITY, so a case-only SKU difference does not
//    by itself produce an UPDATE and the stored spelling is preserved.
//  - `categoryId` counts only when the row resolved to a recognized
//    category; an unrecognized or blank category never clears an existing
//    one, it just warns.
export const IMPORT_OWNED_FIELDS = [
  'brand',
  'model',
  'productName',
  'sku',
  'categoryId',
] as const;

export type ImportOwnedField = (typeof IMPORT_OWNED_FIELDS)[number];

export function changedImportOwnedFields(
  row: ImportIdentityFields,
  existing: CatalogProduct
): ImportOwnedField[] {
  const changed: ImportOwnedField[] = [];

  if (normalizeDisplayValue(row.brand) !== normalizeDisplayValue(existing.brand)) {
    changed.push('brand');
  }
  if (normalizeDisplayValue(row.model) !== normalizeDisplayValue(existing.model)) {
    changed.push('model');
  }
  if (
    normalizeDisplayValue(row.productName) !== normalizeDisplayValue(existing.productName)
  ) {
    changed.push('productName');
  }

  const incomingSku = hasSku(row.sku) ? normalizeIdentityValue(row.sku) : null;
  const existingSku = hasSku(existing.sku) ? normalizeIdentityValue(existing.sku) : null;
  if (incomingSku !== existingSku) changed.push('sku');

  if (row.categoryId !== null && row.categoryId !== existing.categoryId) {
    changed.push('categoryId');
  }

  return changed;
}
