// F5d-11 regression test — no test framework, matching this repo's
// existing convention (see scripts/smoke.mjs,
// test/googleAuthEmailNormalization.test.mts). Proves the exact retention
// boundary conditions F5d-11's dry run is required to demonstrate, using
// the REAL deriveRetentionStatus() from src/attachmentRetention.ts — the
// same function runRetentionSweep() and runRetentionSweepDryRun() both
// call per attachment. Runs entirely offline — no network call, no real
// credential, no GCP/Cloudflare access, no production data involved.
//
// Usage: node test/retentionDryRun.test.mts

import {
  deriveRetentionStatus,
  EXPIRING_SOON_WINDOW_DAYS,
} from '../src/attachmentRetention.ts';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-08-09T00:00:00.000Z');

function daysFromNow(days: number): string {
  return new Date(NOW.getTime() + days * MS_PER_DAY).toISOString();
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

console.log('Running retention dry-run boundary regression test');

check(
  'open-job attachment (deleteAfter === null) stays active',
  deriveRetentionStatus(null, NOW) === 'active'
);

check(
  `more than ${EXPIRING_SOON_WINDOW_DAYS} days remaining -> active`,
  deriveRetentionStatus(daysFromNow(EXPIRING_SOON_WINDOW_DAYS + 1), NOW) === 'active'
);

check(
  `exactly ${EXPIRING_SOON_WINDOW_DAYS} days remaining -> expiring-soon`,
  deriveRetentionStatus(daysFromNow(EXPIRING_SOON_WINDOW_DAYS), NOW) === 'expiring-soon'
);

check(
  'fewer than 30 days remaining (10 days) -> expiring-soon',
  deriveRetentionStatus(daysFromNow(10), NOW) === 'expiring-soon'
);

check(
  'overdue (deleteAfter already in the past) -> expiring-soon',
  deriveRetentionStatus(daysFromNow(-5), NOW) === 'expiring-soon'
);

check(
  'one day past the 30-day boundary (31 days remaining) -> active',
  deriveRetentionStatus(daysFromNow(EXPIRING_SOON_WINDOW_DAYS + 1), NOW) === 'active'
);

check(
  'one day inside the 30-day boundary (29 days remaining) -> expiring-soon',
  deriveRetentionStatus(daysFromNow(EXPIRING_SOON_WINDOW_DAYS - 1), NOW) ===
    'expiring-soon'
);

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll checks passed.');
