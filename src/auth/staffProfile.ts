import { doc, getDoc } from 'firebase/firestore';
import { isCanonicalBrandId, type BrandId } from '../types';
import { getFirestoreDb } from '../lib/firebase/firebase';

export interface StaffProfile {
  uid: string;
  brandId: BrandId;
}

export interface StaffProfileReader {
  getOwnProfile(uid: string): Promise<StaffProfile | null>;
}

export function parseStaffProfile(
  requestedUid: string,
  documentUid: string,
  brandId: unknown
): StaffProfile | null {
  if (
    requestedUid.length === 0 ||
    requestedUid !== documentUid ||
    !isCanonicalBrandId(brandId)
  ) {
    return null;
  }
  return { uid: requestedUid, brandId };
}

export function createFirestoreStaffProfileReader(): StaffProfileReader {
  return {
    async getOwnProfile(uid) {
      const snapshot = await getDoc(doc(getFirestoreDb(), 'staffProfiles', uid));
      if (!snapshot.exists()) {
        return null;
      }
      return parseStaffProfile(uid, snapshot.id, snapshot.data().brandId);
    },
  };
}
