// F5d-10.3 regression test — no test framework, matching this repo's
// existing convention (see test/smoke.mjs). Confirms
// normalizeServiceAccountEmail() strips exactly the kind of stray
// whitespace that F5d-10.2 found in the real GOOGLE_SERVICE_ACCOUNT_EMAIL
// Cloudflare secret, so this class of bug can't silently reoccur if a
// future secret installation reintroduces it. Runs entirely offline — no
// network call, no real credential, no GCP/Cloudflare access.
//
// Usage: node test/googleAuthEmailNormalization.test.mts

import { normalizeServiceAccountEmail } from '../src/googleAuth.ts';

const EXPECTED = 'firestore-retention-sweeper@luxace-service.iam.gserviceaccount.com';

let failures = 0;

function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}`);
  }
}

console.log('Running googleAuth email normalization regression test');

check(
  'leading whitespace is stripped (the exact F5d-10.2 contamination)',
  normalizeServiceAccountEmail(` ${EXPECTED}`) === EXPECTED
);
check(
  'trailing whitespace is stripped',
  normalizeServiceAccountEmail(`${EXPECTED} `) === EXPECTED
);
check(
  'leading + trailing whitespace is stripped',
  normalizeServiceAccountEmail(`  ${EXPECTED}\n`) === EXPECTED
);
check(
  'a tab character is stripped',
  normalizeServiceAccountEmail(`\t${EXPECTED}`) === EXPECTED
);
check(
  'an already-clean value is returned unchanged',
  normalizeServiceAccountEmail(EXPECTED) === EXPECTED
);
check(
  "internal whitespace (not leading/trailing) is left alone — not this function's job",
  normalizeServiceAccountEmail('a b') === 'a b'
);

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll checks passed.');
