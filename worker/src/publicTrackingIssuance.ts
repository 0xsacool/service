import {
  issuePublicTrackingToken,
  revokePublicTrackingToken,
  rotatePublicTrackingToken,
} from './publicTrackingToken.ts';

const SAFE_TRACKING_REFERENCE = /^[a-zA-Z0-9_-]+$/;

export interface PublicTrackingTokenHashStore {
  writeExistingPublicTrackingTokenHash(
    trackingReference: string,
    tokenHash: string | null
  ): Promise<void>;
}

export interface IssuedPublicTrackingLink {
  trackingReference: string;
  shareLink: string;
}

function assertTrackingReference(trackingReference: string): void {
  if (!SAFE_TRACKING_REFERENCE.test(trackingReference)) {
    throw new Error('Invalid tracking reference');
  }
}

export function buildPublicTrackingShareLink(
  appOrigin: string,
  trackingReference: string,
  rawToken: string
): string {
  assertTrackingReference(trackingReference);
  const url = new URL(`/track/${encodeURIComponent(trackingReference)}`, appOrigin);
  url.hash = rawToken;
  return url.toString();
}

async function writeIssuedLink(
  store: PublicTrackingTokenHashStore,
  appOrigin: string,
  trackingReference: string,
  issued: { token: string; tokenHash: string }
): Promise<IssuedPublicTrackingLink> {
  await store.writeExistingPublicTrackingTokenHash(trackingReference, issued.tokenHash);
  return {
    trackingReference,
    shareLink: buildPublicTrackingShareLink(appOrigin, trackingReference, issued.token),
  };
}

// This module is deliberately not reachable from Worker fetch/scheduled
// handlers. A future privileged administrative boundary must authorize the
// staff member before explicitly calling one of these operations.
export async function issuePublicTrackingLink(
  store: PublicTrackingTokenHashStore,
  appOrigin: string,
  trackingReference: string
): Promise<IssuedPublicTrackingLink> {
  assertTrackingReference(trackingReference);
  return await writeIssuedLink(
    store,
    appOrigin,
    trackingReference,
    await issuePublicTrackingToken()
  );
}

export async function rotatePublicTrackingLink(
  store: PublicTrackingTokenHashStore,
  appOrigin: string,
  trackingReference: string
): Promise<IssuedPublicTrackingLink> {
  assertTrackingReference(trackingReference);
  return await writeIssuedLink(
    store,
    appOrigin,
    trackingReference,
    await rotatePublicTrackingToken()
  );
}

export async function revokePublicTrackingLink(
  store: PublicTrackingTokenHashStore,
  trackingReference: string
): Promise<void> {
  assertTrackingReference(trackingReference);
  await store.writeExistingPublicTrackingTokenHash(
    trackingReference,
    revokePublicTrackingToken()
  );
}
