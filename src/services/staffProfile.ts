import { isCanonicalBrandId, type BrandId } from '../types/brand.ts';
import { STAFF_ROLES, type StaffRole } from '../types/serviceReportV2.ts';

const encoder = new TextEncoder();

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

export interface CoreStaffProfile {
  uid: string;
  brandId: BrandId;
  canImportProducts: boolean;
}

export interface RepairReportActorProfile extends CoreStaffProfile {
  role: StaffRole;
  displayName: string | null;
}

export function parseCanImportProducts(value: unknown): boolean {
  return value === true;
}

export function parseCoreStaffProfile(
  requestedUid: string,
  documentUid: string,
  brandId: unknown,
  canImportProducts?: unknown
): CoreStaffProfile | null {
  if (
    requestedUid.length === 0 ||
    requestedUid !== documentUid ||
    !isCanonicalBrandId(brandId)
  ) {
    return null;
  }
  return {
    uid: requestedUid,
    brandId,
    canImportProducts: parseCanImportProducts(canImportProducts),
  };
}

export function parseStaffRole(value: unknown): StaffRole | null {
  return typeof value === 'string' && (STAFF_ROLES as readonly string[]).includes(value)
    ? (value as StaffRole)
    : null;
}

export function parseStaffDisplayName(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || hasControlCharacter(value)) return undefined;
  const normalized = value.normalize('NFC').trim();
  const byteLength = encoder.encode(normalized).byteLength;
  return byteLength >= 1 && byteLength <= 200 ? normalized : undefined;
}

export function parseRepairReportActorProfile(
  coreProfile: CoreStaffProfile,
  roleValue: unknown,
  displayNameValue: unknown
): RepairReportActorProfile | null {
  const role = parseStaffRole(roleValue);
  const displayName = parseStaffDisplayName(displayNameValue);
  if (!role || displayName === undefined) return null;
  return { ...coreProfile, role, displayName };
}
