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
