import { isCanonicalBrandId, type BrandId } from './brands.ts';

export interface StaffProfile {
  uid: string;
  brandId: BrandId;
}

export interface ServiceJobAuthorizationRecord {
  id: string;
  brandId: BrandId | null;
}

export interface StaffAuthorizationDataAccess {
  getStaffProfile(uid: string): Promise<StaffProfile | null>;
  getServiceJobAuthorization(jobId: string): Promise<ServiceJobAuthorizationRecord | null>;
}

export function parseStaffProfile(
  requestedUid: string,
  documentUid: string,
  brandId: unknown
): StaffProfile | null {
  if (requestedUid !== documentUid || requestedUid.length === 0 || !isCanonicalBrandId(brandId)) {
    return null;
  }
  return { uid: requestedUid, brandId };
}

export function parseServiceJobAuthorizationRecord(
  documentId: string,
  brandId: unknown
): ServiceJobAuthorizationRecord {
  return { id: documentId, brandId: isCanonicalBrandId(brandId) ? brandId : null };
}

export async function isStaffAuthorizedForServiceJob(
  uid: string,
  jobId: string,
  dataAccess: StaffAuthorizationDataAccess
): Promise<boolean> {
  const profile = await dataAccess.getStaffProfile(uid);
  if (!profile || profile.uid !== uid || !isCanonicalBrandId(profile.brandId)) {
    return false;
  }
  const serviceJob = await dataAccess.getServiceJobAuthorization(jobId);
  return Boolean(
    serviceJob &&
      serviceJob.id === jobId &&
      isCanonicalBrandId(serviceJob.brandId) &&
      serviceJob.brandId === profile.brandId
  );
}

export async function getAuthorizedStaffProfile(
  uid: string,
  dataAccess: StaffAuthorizationDataAccess
): Promise<StaffProfile | null> {
  const profile = await dataAccess.getStaffProfile(uid);
  return profile && profile.uid === uid && isCanonicalBrandId(profile.brandId) ? profile : null;
}
