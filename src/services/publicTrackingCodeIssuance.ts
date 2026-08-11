import {
  generateAvailablePublicTrackingCode,
  hashPublicTrackingCode,
  type PublicTrackingCodeExistenceStore,
  type SecureRandomBytes,
} from './publicTrackingCode';

export interface PreparedPublicTrackingCodeIssuance {
  serviceJobId: string;
  code: string;
  codeHash: string;
}

export async function preparePublicTrackingCodeIssuance({
  serviceJobId,
  createdAt,
  store,
  randomBytes,
}: {
  serviceJobId: string;
  createdAt: Date;
  store: PublicTrackingCodeExistenceStore;
  randomBytes?: SecureRandomBytes;
}): Promise<PreparedPublicTrackingCodeIssuance> {
  const code = await generateAvailablePublicTrackingCode(createdAt, store, randomBytes);
  return { serviceJobId, code, codeHash: await hashPublicTrackingCode(code) };
}
