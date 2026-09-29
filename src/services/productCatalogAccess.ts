import { backendKind } from '../config/backend';

export const PRODUCT_CATALOG_READ_ONLY_MESSAGE =
  'บัญชีนี้ไม่มีสิทธิ์จัดการข้อมูลหลักสินค้า';

export function canMutateProductCatalogForBackend(
  kind: 'mock' | 'firestore' | null
): boolean {
  return kind === 'mock';
}

export function canMutateProductCatalog(): boolean {
  return canMutateProductCatalogForBackend(backendKind);
}

export function canManageProductCatalogForBackend(
  kind: 'mock' | 'firestore' | null,
  canManageProducts: boolean
): boolean {
  if (kind === 'mock') return true;
  return kind === 'firestore' && canManageProducts;
}

export function canManageProductCatalog(canManageProducts: boolean): boolean {
  return canManageProductCatalogForBackend(backendKind, canManageProducts);
}

// Product Import and Product Management remain independently gated.
// canMutateProductCatalog() is intentionally still mock-only because it means
// direct client/local mutation (used by Product Knowledge and legacy mock
// paths). Production Product create/edit/status/delete instead use the
// Worker-mediated canManageProductCatalog() boundary above; import uses its
// separate canImportProducts capability here.
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
