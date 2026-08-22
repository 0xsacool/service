import { doc, getDoc } from 'firebase/firestore';
import { isCanonicalBrandId, type BrandId } from '../types';
import { getFirestoreDb } from '../lib/firebase/firebase';

export interface StaffProfile {
  uid: string;
  brandId: BrandId;
  canImportProducts: boolean;
}

export interface StaffProfileReader {
  getOwnProfile(uid: string): Promise<StaffProfile | null>;
}

// PI-3 Slice 2 — mirrors worker/src/staffAuthorization.ts's
// parseCanImportProducts exactly: fails closed to false on anything but a
// literal boolean true, so an absent or malformed field is never silently
// treated as granted. Kept as a separate implementation (not imported) since
// this runs in the browser and that one runs in the Worker.
export function parseCanImportProducts(value: unknown): boolean {
  return value === true;
}

export function parseStaffProfile(
  requestedUid: string,
  documentUid: string,
  brandId: unknown,
  canImportProducts: unknown
): StaffProfile | null {
  if (
    requestedUid.length === 0 ||
    requestedUid !== documentUid ||
    !isCanonicalBrandId(brandId)
  ) {
    return null;
  }
  return { uid: requestedUid, brandId, canImportProducts: parseCanImportProducts(canImportProducts) };
}

export function createFirestoreStaffProfileReader(): StaffProfileReader {
  return {
    async getOwnProfile(uid) {
      const snapshot = await getDoc(doc(getFirestoreDb(), 'staffProfiles', uid));
      if (!snapshot.exists()) {
        return null;
      }
      const data = snapshot.data();
      return parseStaffProfile(uid, snapshot.id, data.brandId, data.canImportProducts);
    },
  };
}
