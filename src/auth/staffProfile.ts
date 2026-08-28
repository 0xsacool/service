import { doc, getDoc } from 'firebase/firestore';
import { getFirestoreDb } from '../lib/firebase/firebase';
import {
  parseCanImportProducts,
  parseCoreStaffProfile,
  parseRepairReportActorProfile,
  type CoreStaffProfile,
  type RepairReportActorProfile,
} from '../services/staffProfile';

export interface StaffProfile extends CoreStaffProfile {
  repairReportActor?: RepairReportActorProfile | null;
}
export type { CoreStaffProfile, RepairReportActorProfile };
export { parseCanImportProducts, parseRepairReportActorProfile };

export interface StaffProfileReader {
  getOwnProfile(uid: string): Promise<StaffProfile | null>;
}

// PI-3 Slice 2 — mirrors worker/src/staffAuthorization.ts's
// parseCanImportProducts exactly: fails closed to false on anything but a
// literal boolean true, so an absent or malformed field is never silently
// treated as granted. Kept as a separate implementation (not imported) since
// this runs in the browser and that one runs in the Worker.
export function parseStaffProfile(
  requestedUid: string,
  documentUid: string,
  brandId: unknown,
  canImportProducts?: unknown,
  role?: unknown,
  displayName?: unknown
): StaffProfile | null {
  const core = parseCoreStaffProfile(requestedUid, documentUid, brandId, canImportProducts);
  return core
    ? {
        ...core,
        repairReportActor: parseRepairReportActorProfile(core, role, displayName),
      }
    : null;
}

export function createFirestoreStaffProfileReader(): StaffProfileReader {
  return {
    async getOwnProfile(uid) {
      const snapshot = await getDoc(doc(getFirestoreDb(), 'staffProfiles', uid));
      if (!snapshot.exists()) {
        return null;
      }
      const data = snapshot.data();
      return parseStaffProfile(
        uid,
        snapshot.id,
        data.brandId,
        data.canImportProducts,
        data.role,
        data.displayName
      );
    },
  };
}
