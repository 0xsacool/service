import type { DocumentData } from 'firebase/firestore';
import { isCanonicalBrandId, type BrandId, type Customer } from '../../types';

// Collection name, mirroring PRODUCTS_COLLECTION's role in
// productMasterMapping.ts (Sprint F3, reusing the F2 pattern).
export const CUSTOMERS_COLLECTION = 'customers';

// Firestore field contract for the 'customers' collection. Deliberately
// matches the current Customer type exactly (id, name, phone, email) — id
// becomes the document ID rather than a field, same as ProductMasterEntry.id
// in productMasterMapping.ts. No firstName/lastName/fullName/address fields:
// the current Customer type has none of those, and this migration's scope is
// backend-only — it doesn't extend the business type.
export interface CustomerFirestoreFields {
  name: string;
  phone: string;
  email: string;
  brandIds: BrandId[];
}

export function toFirestoreFields(entry: Customer): CustomerFirestoreFields {
  return {
    name: entry.name,
    phone: entry.phone,
    email: entry.email,
    brandIds: entry.brandIds,
  };
}

function parseBrandIds(value: unknown): BrandId[] | null {
  if (!Array.isArray(value) || value.length === 0 || !value.every(isCanonicalBrandId)) {
    return null;
  }
  return value;
}

// Legacy customer documents without explicit canonical memberships are not
// exposed to a staff session. A migration must make their ownership explicit.
export function fromFirestoreData(id: string, data: DocumentData): Customer | null {
  const brandIds = parseBrandIds(data.brandIds);
  if (!brandIds) return null;
  return {
    id,
    name: data.name,
    phone: data.phone,
    email: data.email,
    brandIds,
  };
}
