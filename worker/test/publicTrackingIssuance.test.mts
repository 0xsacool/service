import {
  buildPublicTrackingShareLink,
  issuePublicTrackingLink,
  revokePublicTrackingLink,
  rotatePublicTrackingLink,
  type PublicTrackingTokenHashStore,
} from '../src/publicTrackingIssuance.ts';
import { verifyPublicTrackingToken } from '../src/publicTrackingToken.ts';

class FakeTokenHashStore implements PublicTrackingTokenHashStore {
  readonly hashes = new Map<string, string | null>();
  readonly writes: Array<{ trackingReference: string; tokenHash: string | null }> = [];

  async writeExistingPublicTrackingTokenHash(
    trackingReference: string,
    tokenHash: string | null
  ): Promise<void> {
    this.hashes.set(trackingReference, tokenHash);
    this.writes.push({ trackingReference, tokenHash });
  }
}

let failures = 0;

function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}`);
  }
}

function tokenFromLink(link: string): string {
  return new URL(link).hash.slice(1);
}

console.log('Running public tracking issuance boundary regression test');

const store = new FakeTokenHashStore();
const reference = 'BRN-2026-000123';
const issued = await issuePublicTrackingLink(store, 'https://app.example', reference);
const issuedToken = tokenFromLink(issued.shareLink);
const issuedHash = store.hashes.get(reference) ?? null;
check('issuance writes only a hash for the exact existing reference',
  store.writes.length === 1 && store.writes[0]?.trackingReference === reference &&
    issuedHash !== null && issuedHash !== issuedToken
);
check('issuance returns a share link with the raw token only in its fragment',
  new URL(issued.shareLink).pathname === `/track/${reference}` &&
    new URL(issued.shareLink).search === '' &&
    issuedToken.length === 43
);
check('issued raw token verifies against the stored hash', await verifyPublicTrackingToken(issuedToken, issuedHash));

const rotated = await rotatePublicTrackingLink(store, 'https://app.example', reference);
const rotatedToken = tokenFromLink(rotated.shareLink);
const rotatedHash = store.hashes.get(reference) ?? null;
check('rotation replaces the stored hash with a new token/hash pair',
  rotatedToken !== issuedToken && rotatedHash !== issuedHash &&
    await verifyPublicTrackingToken(rotatedToken, rotatedHash)
);
check('rotation invalidates the previous token', !(await verifyPublicTrackingToken(issuedToken, rotatedHash)));

await revokePublicTrackingLink(store, reference);
check('revocation clears the stored hash and invalidates the current token',
  store.hashes.get(reference) === null && !(await verifyPublicTrackingToken(rotatedToken, null))
);

let invalidReferenceRejected = false;
try {
  await issuePublicTrackingLink(store, 'https://app.example', '../other');
} catch {
  invalidReferenceRejected = true;
}
check('invalid references fail before a store write', invalidReferenceRejected && store.writes.length === 3);
check('share-link builder rejects query-string token placement',
  new URL(buildPublicTrackingShareLink('https://app.example', reference, issuedToken)).search === ''
);

if (failures > 0) {
  process.exitCode = 1;
  console.error(`public tracking issuance regression test failed: ${failures} failure(s)`);
} else {
  console.log('public tracking issuance regression test passed');
}
