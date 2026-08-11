import type { DocumentData } from 'firebase/firestore';
import type { ProductMasterEntry, ProductStatus } from '../../types';

// Single source of truth for the collection name — previously duplicated as
// a separate literal in firestoreProductMasterRepository.ts and
// seedProductMasterFromMock.ts (Sprint F2.1 hardening).
export const PRODUCTS_COLLECTION = 'products';

// Sprint F2's explicit Firestore field contract for the 'products'
// collection. Deliberately narrower than ProductMasterEntry: `id` is the
// document id (not a field), and `variant` isn't in the contract at all —
// it's dropped on write and always undefined on read from Firestore. `name`
// on the TS type maps to `productName` in the document, per spec.
export interface ProductMasterFirestoreFields {
  brand: string;
  categoryId: string;
  model: string;
  sku: string | null;
  productName: string;
  status: ProductStatus;
  warrantyMonths: number;
  accessoryIds: string[];
  commonProblemIds: string[];
}

export function toFirestoreFields(
  entry: ProductMasterEntry
): ProductMasterFirestoreFields {
  return {
    brand: entry.brand,
    categoryId: entry.categoryId,
    model: entry.model,
    sku: entry.sku ?? null,
    productName: entry.name,
    status: entry.status,
    warrantyMonths: entry.warrantyMonths,
    accessoryIds: entry.accessoryIds,
    commonProblemIds: entry.commonProblemIds,
  };
}

export function fromFirestoreData(id: string, data: DocumentData): ProductMasterEntry {
  return {
    id,
    brand: data.brand,
    categoryId: data.categoryId,
    model: data.model,
    sku: data.sku ?? undefined,
    name: data.productName,
    status: data.status,
    warrantyMonths: data.warrantyMonths,
    accessoryIds: data.accessoryIds ?? [],
    commonProblemIds: data.commonProblemIds ?? [],
  };
}
