// F5d-13 regression test — no test framework, matching this repo's
// existing convention. Proves the deletion-safety helpers' correctness
// entirely offline: fail-closed eligibility, the 30-day-warning-window
// vs. actually-past-deleteAfter distinction, key-namespace validation
// reuse, required (non-defaulted) policy parameters, and the circuit
// breaker. No network call, no real credential, no GCP/Cloudflare
// access, no production data involved, and no deletion is ever performed
// anywhere in this file — these are pure functions.
//
// Usage: node test/deletionSafety.test.mts

import {
  isEligibleForDeletion,
  recheckEligibilityBeforeDelete,
  isDeletionCandidateKeyValid,
  selectDeletionCandidates,
  shouldHaltRun,
  buildDeletionAuditEntry,
} from '../src/deletionSafety.ts';
import type { AttachmentRetentionRecord } from '../src/firestoreClient.ts';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-08-09T00:00:00.000Z');

function daysFromNow(days: number): string {
  return new Date(NOW.getTime() + days * MS_PER_DAY).toISOString();
}

function record(
  overrides: Partial<AttachmentRetentionRecord> = {}
): AttachmentRetentionRecord {
  return {
    docId: 'doc-1',
    path: 'service-jobs/BRN-2026-000001/documents/uuid-file.pdf',
    deleteAfter: null,
    retentionStatus: 'active',
    deletedAt: null,
    ...overrides,
  };
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

console.log('Running deletion safety regression test');

// --- isEligibleForDeletion: fail-closed cases ---
check(
  'null deleteAfter (open job) is never eligible',
  isEligibleForDeletion(record({ deleteAfter: null }), NOW).eligible === false
);
check(
  'unparseable deleteAfter is never eligible',
  isEligibleForDeletion(record({ deleteAfter: 'not-a-date' }), NOW).eligible === false
);

// --- isEligibleForDeletion: the retentionStatus trap ---
// 'expiring-soon' covers BOTH "within the 30-day warning window" AND
// "already overdue" — eligibility must NOT be based on status alone.
check(
  '10 days before deleteAfter (status would already read expiring-soon) is NOT eligible',
  isEligibleForDeletion(
    record({ deleteAfter: daysFromNow(10), retentionStatus: 'expiring-soon' }),
    NOW
  ).eligible === false
);
check(
  '1 day before deleteAfter is NOT eligible',
  isEligibleForDeletion(record({ deleteAfter: daysFromNow(1) }), NOW).eligible === false
);
check(
  'exactly at deleteAfter (now === deleteAfter) IS eligible',
  isEligibleForDeletion(record({ deleteAfter: NOW.toISOString() }), NOW).eligible === true
);
check(
  '1 day past deleteAfter IS eligible',
  isEligibleForDeletion(record({ deleteAfter: daysFromNow(-1) }), NOW).eligible === true
);

// --- isEligibleForDeletion: F5d-17 (DECISIONS.md #025) — deletedAt fail-closed ---
check(
  'a record already marked deletedAt is never eligible again, even though deleteAfter is past due',
  isEligibleForDeletion(
    record({ deleteAfter: daysFromNow(-1), deletedAt: NOW.toISOString() }),
    NOW
  ).eligible === false
);
check(
  'recheckEligibilityBeforeDelete also refuses when the fresh record already has deletedAt set',
  recheckEligibilityBeforeDelete(
    record({ deleteAfter: daysFromNow(-1) }),
    record({ deleteAfter: daysFromNow(-1), deletedAt: NOW.toISOString() }),
    NOW
  ).eligible === false
);

// --- recheckEligibilityBeforeDelete: extension-during-window scenario ---
check(
  'recheck detects deleteAfter changed since selection (e.g. retention extended) and refuses',
  recheckEligibilityBeforeDelete(
    record({ deleteAfter: daysFromNow(-1) }),
    record({ deleteAfter: daysFromNow(300) }),
    NOW
  ).eligible === false
);
check(
  'recheck passes when deleteAfter is unchanged and still past due',
  recheckEligibilityBeforeDelete(
    record({ deleteAfter: daysFromNow(-1) }),
    record({ deleteAfter: daysFromNow(-1) }),
    NOW
  ).eligible === true
);

// --- isDeletionCandidateKeyValid: reuses the real Worker key pattern ---
check(
  'a real-shaped attachment key is valid',
  isDeletionCandidateKeyValid('service-jobs/BRN-2026-000001/documents/uuid-file.pdf') ===
    true
);
check(
  'a key outside the attachment namespace is invalid',
  isDeletionCandidateKeyValid('../../etc/passwd') === false
);
check(
  'a key with an unrecognized category is invalid',
  isDeletionCandidateKeyValid(
    'service-jobs/BRN-2026-000001/not-a-category/uuid-file.pdf'
  ) === false
);

// --- selectDeletionCandidates: requires an explicit, non-defaulted cap ---
let threwOnMissingCap = false;
try {
  // @ts-expect-error — intentionally omitting the required parameter to prove there is no implicit default
  selectDeletionCandidates([], NOW);
} catch {
  threwOnMissingCap = true;
}
check(
  'selectDeletionCandidates has no implicit default cap (call without one throws/fails)',
  threwOnMissingCap
);

check(
  'selectDeletionCandidates rejects a negative cap rather than silently clamping',
  (() => {
    try {
      selectDeletionCandidates([], NOW, -1);
      return false;
    } catch {
      return true;
    }
  })()
);

const mixedAttachments: AttachmentRetentionRecord[] = [
  record({ docId: 'eligible-1', deleteAfter: daysFromNow(-5) }),
  record({ docId: 'eligible-2', deleteAfter: daysFromNow(-1) }),
  record({ docId: 'not-yet-due', deleteAfter: daysFromNow(10) }),
  record({ docId: 'open-job', deleteAfter: null }),
  record({
    docId: 'bad-key',
    path: '../not/an/attachment/key',
    deleteAfter: daysFromNow(-1),
  }),
  record({
    docId: 'already-processed',
    deleteAfter: daysFromNow(-30),
    deletedAt: daysFromNow(-1),
  }),
];

const selection = selectDeletionCandidates(mixedAttachments, NOW, 10);
check(
  'selectDeletionCandidates picks exactly the 2 genuinely eligible+valid records',
  selection.candidates.length === 2 &&
    selection.candidates.every(
      (c) => c.docId === 'eligible-1' || c.docId === 'eligible-2'
    )
);
check(
  'selectDeletionCandidates records skip reasons for the other 4 (including the already-processed one)',
  selection.skipped.length === 4
);
check(
  'selectDeletionCandidates never re-selects a record that already has deletedAt set',
  !selection.candidates.some((c) => c.docId === 'already-processed') &&
    selection.skipped.some((s) => s.docId === 'already-processed')
);

const cappedSelection = selectDeletionCandidates(mixedAttachments, NOW, 1);
check(
  'selectDeletionCandidates truncates to the supplied cap, not silently ignoring it',
  cappedSelection.candidates.length === 1
);

// --- shouldHaltRun: requires an explicit, non-defaulted threshold ---
let threwOnMissingThreshold = false;
try {
  shouldHaltRun(5, 0);
} catch {
  threwOnMissingThreshold = true;
}
check(
  'shouldHaltRun rejects a non-positive threshold rather than accepting 0 as "always halt"',
  threwOnMissingThreshold
);
check(
  'shouldHaltRun halts once failures reach the threshold',
  shouldHaltRun(3, 3) === true
);
check('shouldHaltRun does not halt before the threshold', shouldHaltRun(2, 3) === false);

// --- buildDeletionAuditEntry: shape only, no secret material possible ---
const audit = buildDeletionAuditEntry(
  'att-1',
  'service-jobs/x/documents/y.pdf',
  'past deleteAfter',
  'deleted',
  NOW
);
check(
  'audit entry carries exactly the expected fields',
  audit.attachmentId === 'att-1' &&
    audit.objectKey === 'service-jobs/x/documents/y.pdf' &&
    audit.outcome === 'deleted' &&
    audit.timestamp === NOW.toISOString()
);

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll checks passed.');
