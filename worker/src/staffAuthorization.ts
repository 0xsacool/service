import { isCanonicalBrandId, type BrandId } from './brands.ts';

export interface StaffProfile {
  uid: string;
  brandId: BrandId;
  // PI-3 — a dedicated per-staff permission for privileged Product Master
  // import. Deliberately a single boolean capability, not a role or a
  // permission framework: Product Master is a global reference catalog
  // (DECISIONS.md #030), so this grants one specific ability and implies
  // nothing else.
  canImportProducts: boolean;
}

export interface ServiceJobAuthorizationRecord {
  id: string;
  brandId: BrandId | null;
}

export interface StaffAuthorizationDataAccess {
  getStaffProfile(uid: string): Promise<StaffProfile | null>;
  getServiceJobAuthorization(jobId: string): Promise<ServiceJobAuthorizationRecord | null>;
}

// PI-3 — `canImportProducts` fails closed to `false` rather than
// invalidating the whole profile.
//
// This is deliberate and load-bearing. Every staff profile document that
// exists today predates this field, so requiring a boolean the way brandId
// requires a canonical value would make parseStaffProfile return null for
// every existing staff member — 403-ing them out of Service Job creation,
// Service Report drafts, and file upload, none of which have anything to do
// with product import. Absent (and any non-boolean value) therefore means
// "does not have this permission", which is the fail-closed answer for the
// permission itself without taking any unrelated capability away.
export function parseCanImportProducts(value: unknown): boolean {
  return value === true;
}

export function parseStaffProfile(
  requestedUid: string,
  documentUid: string,
  brandId: unknown,
  canImportProducts?: unknown
): StaffProfile | null {
  if (requestedUid !== documentUid || requestedUid.length === 0 || !isCanonicalBrandId(brandId)) {
    return null;
  }
  return {
    uid: requestedUid,
    brandId,
    canImportProducts: parseCanImportProducts(canImportProducts),
  };
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

// F5d-66 — the Service Report create-draft/finalize routes already resolve
// an authorized StaffProfile via authorizeStaffCreation() before this runs,
// so re-verifying the staff profile the way isStaffAuthorizedForServiceJob()
// does would be a redundant Firestore read. This checks only the other
// half: does the given jobId genuinely belong to the caller's own brand.
export async function isServiceJobInBrand(
  jobId: string,
  brandId: BrandId,
  dataAccess: StaffAuthorizationDataAccess
): Promise<boolean> {
  const serviceJob = await dataAccess.getServiceJobAuthorization(jobId);
  return Boolean(
    serviceJob &&
      serviceJob.id === jobId &&
      isCanonicalBrandId(serviceJob.brandId) &&
      serviceJob.brandId === brandId
  );
}
