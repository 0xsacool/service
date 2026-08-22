import { backendKind } from '../config/backend';

export const PRODUCT_CATALOG_READ_ONLY_MESSAGE =
  'การแก้ไขข้อมูลสินค้าในระบบจริงยังไม่พร้อมใช้งาน ต้องดำเนินการผ่านขั้นตอนที่ได้รับสิทธิ์เท่านั้น';

export function canMutateProductCatalogForBackend(
  kind: 'mock' | 'firestore' | null
): boolean {
  return kind === 'mock';
}

export function canMutateProductCatalog(): boolean {
  return canMutateProductCatalogForBackend(backendKind);
}

// PI-3 Slice 2 — deliberately separate from canMutateProductCatalogForBackend
// above, not a reuse of it: Production Import (this predicate) and direct
// Add/Edit (that one) are two independently-gated capabilities. Mock mode
// has no per-staff capability to check, so it is always import-capable, same
// as it is always edit-capable; Firestore/production mode instead reflects
// the signed-in staff's own canImportProducts flag, while direct Add/Edit
// stays unconditionally unavailable there. Nothing in this function can make
// canMutateProductCatalog() return true in Firestore mode.
export function canImportProductCatalogForBackend(
  kind: 'mock' | 'firestore' | null,
  canImportProducts: boolean
): boolean {
  if (kind === 'mock') return true;
  if (kind === 'firestore') return canImportProducts;
  return false;
}

export function canImportProductCatalog(canImportProducts: boolean): boolean {
  return canImportProductCatalogForBackend(backendKind, canImportProducts);
}
