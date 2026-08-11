// F5d-15 regression test — no test framework, matching this repo's
// existing convention. Exercises the real deletion executor
// (worker/src/deletionExecutor.ts) entirely offline against fakes for
// Firestore and R2 — no network call, no real credential, no
// GCP/Cloudflare access, and no production infrastructure is touched by
// any test in this file. Covers all 18 scenarios required by F5d-15's
// brief.
//
// Usage: node test/deletionExecutor.test.mts

import { runDeletionExecutor } from '../src/deletionExecutor.ts';
import type {
  DeletionExecutorDeps,
  DeletionExecutorR2Bucket,
} from '../src/deletionExecutor.ts';
import type { DeletionCandidate } from '../src/deletionSafety.ts';
import type {
  AttachmentRetentionRecord,
  FirestoreClient,
} from '../src/firestoreClient.ts';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-08-09T00:00:00.000Z');

function daysFromNow(days: number): string {
  return new Date(NOW.getTime() + days * MS_PER_DAY).toISOString();
}

function candidate(overrides: Partial<DeletionCandidate> = {}): DeletionCandidate {
  return {
    docId: 'service-jobs__BRN-2026-000001__documents__uuid-file.pdf',
    path: 'service-jobs/BRN-2026-000001/documents/uuid-file.pdf',
    deleteAfter: daysFromNow(-1),
    ...overrides,
  };
}

function record(
  overrides: Partial<AttachmentRetentionRecord> = {}
): AttachmentRetentionRecord {
  return {
    docId: 'service-jobs__BRN-2026-000001__documents__uuid-file.pdf',
    path: 'service-jobs/BRN-2026-000001/documents/uuid-file.pdf',
    deleteAfter: daysFromNow(-1),
    retentionStatus: 'expiring-soon',
    deletedAt: null,
    ...overrides,
  };
}

// A fake FirestoreClient implementing both methods the executor uses
// (Pick<FirestoreClient, 'getAttachment' | 'markAttachmentDeleted'>).
// markAttachmentDeleted actually writes deletedAt back into the fake
// store (not a no-op stub) so idempotency/self-healing scenarios can be
// verified against real before/after state, not just call counts.
// `throwOnMarkDeleted` simulates a genuine, unrelated Firestore write
// failure — distinct from a successful mark — for the F5d-17
// R2-success-but-Firestore-write-failure scenario.
class FakeFirestoreClient implements Pick<
  FirestoreClient,
  'getAttachment' | 'markAttachmentDeleted'
> {
  private store: Map<string, AttachmentRetentionRecord>;
  private failNext = false;
  throwOnMarkDeleted = false;

  constructor(seed: AttachmentRetentionRecord[] = []) {
    this.store = new Map(seed.map((r) => [r.docId, r]));
  }

  failOnNextRead(): void {
    this.failNext = true;
  }

  async getAttachment(docId: string): Promise<AttachmentRetentionRecord | null> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('simulated Firestore read failure');
    }
    return this.store.get(docId) ?? null;
  }

  async markAttachmentDeleted(docId: string, deletedAt: string): Promise<void> {
    if (this.throwOnMarkDeleted) {
      throw new Error('simulated Firestore write failure (markAttachmentDeleted)');
    }
    const existing = this.store.get(docId);
    if (existing) {
      this.store.set(docId, { ...existing, deletedAt });
    }
  }

  deletedAtFor(docId: string): string | null | undefined {
    return this.store.get(docId)?.deletedAt;
  }
}

// A fake, in-memory R2 bucket — object presence is just a Set membership
// check. `throwOnDelete`/`throwOnHead` simulate a genuine, unrelated R2
// failure (a thrown exception), distinct from "not found" (a clean null
// return from head()).
class FakeR2Bucket implements DeletionExecutorR2Bucket {
  private objects: Set<string>;
  throwOnHead = false;
  throwOnDelete = false;

  constructor(seed: string[] = []) {
    this.objects = new Set(seed);
  }

  async head(key: string): Promise<{ key: string } | null> {
    if (this.throwOnHead) {
      throw new Error('simulated unrelated R2 error (head)');
    }
    return this.objects.has(key) ? { key } : null;
  }

  async delete(key: string): Promise<void> {
    if (this.throwOnDelete) {
      throw new Error('simulated unrelated R2 error (delete)');
    }
    this.objects.delete(key);
  }

  has(key: string): boolean {
    return this.objects.has(key);
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

function deps(
  firestore: FakeFirestoreClient,
  bucket: FakeR2Bucket
): DeletionExecutorDeps {
  return { firestoreClient: firestore, bucket, now: NOW };
}

console.log('Running deletion executor regression test');

// --- 1. valid eligible candidate -> deleted ---
{
  const path = candidate().path;
  const firestore = new FakeFirestoreClient([record()]);
  const bucket = new FakeR2Bucket([path]);
  const run = await runDeletionExecutor([candidate()], deps(firestore, bucket), 50, 3);
  check('1. valid eligible candidate is deleted', run.results[0]?.result === 'deleted');
  check('1. R2 object is actually gone afterward', !bucket.has(path));
}

// --- 2. missing metadata (Firestore has no matching doc) -> skipped ---
{
  const firestore = new FakeFirestoreClient([]); // empty — no doc for this id
  const bucket = new FakeR2Bucket([candidate().path]);
  const run = await runDeletionExecutor([candidate()], deps(firestore, bucket), 50, 3);
  check(
    '2. missing metadata is skipped, not deleted',
    run.results[0]?.result === 'skipped'
  );
  check('2. R2 object untouched when metadata is missing', bucket.has(candidate().path));
}

// --- 3. invalid attachment ID (contains a raw "/") -> skipped ---
{
  const bad = candidate({ docId: 'has/a/slash' });
  const firestore = new FakeFirestoreClient([record({ docId: 'has/a/slash' })]);
  const bucket = new FakeR2Bucket([bad.path]);
  const run = await runDeletionExecutor([bad], deps(firestore, bucket), 50, 3);
  check('3. malformed attachment ID is skipped', run.results[0]?.result === 'skipped');
}

// --- 4. invalid object key (outside the attachment namespace) -> skipped ---
{
  const bad = candidate({ path: '../not/an/attachment/key' });
  const firestore = new FakeFirestoreClient([
    record({ path: '../not/an/attachment/key' }),
  ]);
  const bucket = new FakeR2Bucket([]);
  const run = await runDeletionExecutor([bad], deps(firestore, bucket), 50, 3);
  check('4. invalid object key is skipped', run.results[0]?.result === 'skipped');
}

// --- 5. missing deleteAfter (fresh record has null) -> skipped ---
{
  const firestore = new FakeFirestoreClient([record({ deleteAfter: null })]);
  const bucket = new FakeR2Bucket([candidate().path]);
  const run = await runDeletionExecutor([candidate()], deps(firestore, bucket), 50, 3);
  check(
    '5. missing deleteAfter on fresh read is skipped',
    run.results[0]?.result === 'skipped'
  );
}

// --- 6. invalid deleteAfter (unparseable) -> skipped ---
{
  const firestore = new FakeFirestoreClient([record({ deleteAfter: 'not-a-date' })]);
  const bucket = new FakeR2Bucket([candidate().path]);
  const run = await runDeletionExecutor(
    [candidate({ deleteAfter: 'not-a-date' })],
    deps(firestore, bucket),
    50,
    3
  );
  check('6. unparseable deleteAfter is skipped', run.results[0]?.result === 'skipped');
}

// --- 7. not actually expired (deleteAfter in the future) -> skipped ---
{
  const future = daysFromNow(10);
  const firestore = new FakeFirestoreClient([record({ deleteAfter: future })]);
  const bucket = new FakeR2Bucket([candidate().path]);
  const run = await runDeletionExecutor(
    [candidate({ deleteAfter: future })],
    deps(firestore, bucket),
    50,
    3
  );
  check('7. not-yet-expired candidate is skipped', run.results[0]?.result === 'skipped');
}

// --- 8. metadata changed during re-check (retention extended) -> skipped ---
{
  const staleCandidate = candidate({ deleteAfter: daysFromNow(-1) });
  const firestore = new FakeFirestoreClient([record({ deleteAfter: daysFromNow(300) })]);
  const bucket = new FakeR2Bucket([candidate().path]);
  const run = await runDeletionExecutor([staleCandidate], deps(firestore, bucket), 50, 3);
  check(
    '8. deleteAfter changed since selection is skipped, not deleted',
    run.results[0]?.result === 'skipped'
  );
  check(
    '8. R2 object survives when retention was extended',
    bucket.has(candidate().path)
  );
}

// --- 9. R2 deletion succeeds -> deleted (covered by #1, repeated for clarity) ---
{
  const path = candidate().path;
  const firestore = new FakeFirestoreClient([record()]);
  const bucket = new FakeR2Bucket([path]);
  const run = await runDeletionExecutor([candidate()], deps(firestore, bucket), 50, 3);
  check(
    '9. R2 deletion succeeds and is reported as deleted',
    run.results[0]?.result === 'deleted'
  );
}

// --- 10. R2 object already missing -> already-deleted, run does not fail ---
{
  const firestore = new FakeFirestoreClient([record()]);
  const bucket = new FakeR2Bucket([]); // object not present
  const run = await runDeletionExecutor([candidate()], deps(firestore, bucket), 50, 3);
  check(
    '10. already-absent R2 object reports already-deleted',
    run.results[0]?.result === 'already-deleted'
  );
  check('10. already-deleted does not count as a failure', run.failedCount === 0);
  check(
    '10. already-deleted self-heals Firestore deletedAt (was still null)',
    firestore.deletedAtFor(record().docId) === NOW.toISOString()
  );
}

// --- 11. unrelated R2 error -> failed, never conflated with already-deleted ---
{
  const firestore = new FakeFirestoreClient([record()]);
  const bucket = new FakeR2Bucket([candidate().path]);
  bucket.throwOnDelete = true;
  const run = await runDeletionExecutor([candidate()], deps(firestore, bucket), 50, 3);
  check(
    '11. unrelated R2 error is reported as failed',
    run.results[0]?.result === 'failed'
  );
  check(
    '11. failed result carries an error classification',
    typeof run.results[0]?.errorClassification === 'string'
  );
}
{
  const firestore = new FakeFirestoreClient([record()]);
  const bucket = new FakeR2Bucket([candidate().path]);
  bucket.throwOnHead = true;
  const run = await runDeletionExecutor([candidate()], deps(firestore, bucket), 50, 3);
  check(
    '11b. an unrelated head() error is failed, not already-deleted',
    run.results[0]?.result === 'failed'
  );
}

// --- F5d-17 (DECISIONS.md #025): R2 delete succeeds, Firestore mark-deleted write fails ---
{
  const path = candidate().path;
  const firestore = new FakeFirestoreClient([record()]);
  firestore.throwOnMarkDeleted = true;
  const bucket = new FakeR2Bucket([path]);
  const run = await runDeletionExecutor([candidate()], deps(firestore, bucket), 50, 3);
  check(
    'F5d-17a. R2-success + Firestore-write-failure reports deleted-metadata-write-failed',
    run.results[0]?.result === 'deleted-metadata-write-failed'
  );
  check(
    'F5d-17a. the R2 object is genuinely gone despite the metadata write failing',
    !bucket.has(path)
  );
  check(
    'F5d-17a. Firestore metadata is left stale (deletedAt still null), not silently lost',
    firestore.deletedAtFor(record().docId) === null
  );
  check(
    'F5d-17a. counts toward deletedCount (the destructive action happened)',
    run.deletedCount === 1
  );
  check(
    'F5d-17a. does NOT count toward failedCount/the circuit breaker (not an R2 failure)',
    run.failedCount === 0
  );
  check(
    'F5d-17a. the result carries an error classification for the failed write',
    typeof run.results[0]?.errorClassification === 'string'
  );
}

// --- F5d-17b: already-absent R2 object whose self-heal Firestore write also fails ---
{
  const firestore = new FakeFirestoreClient([record()]);
  firestore.throwOnMarkDeleted = true;
  const bucket = new FakeR2Bucket([]); // object not present
  const run = await runDeletionExecutor([candidate()], deps(firestore, bucket), 50, 3);
  check(
    'F5d-17b. still reported as already-deleted (no destructive action, so not escalated)',
    run.results[0]?.result === 'already-deleted'
  );
  check(
    'F5d-17b. does not count toward deletedCount or failedCount',
    run.deletedCount === 0 && run.failedCount === 0
  );
  check(
    'F5d-17b. Firestore metadata remains unmarked, eligible for a future self-heal attempt',
    firestore.deletedAtFor(record().docId) === null
  );
}

// --- F5d-17c: an attachment already marked deletedAt is never re-selected/re-processed ---
{
  const alreadyDone = record({ deletedAt: daysFromNow(-1) });
  const firestore = new FakeFirestoreClient([alreadyDone]);
  const bucket = new FakeR2Bucket([]); // R2 object genuinely already gone too
  const run = await runDeletionExecutor([candidate()], deps(firestore, bucket), 50, 3);
  check(
    'F5d-17c. a candidate whose fresh record already has deletedAt set is skipped, not reprocessed',
    run.results[0]?.result === 'skipped'
  );
  check(
    'F5d-17c. skipped reason names the fail-closed reprocessing guard',
    !!run.results[0]?.reason.includes('fail closed against reprocessing')
  );
}

// --- 12. max 50 limit ---
{
  const many: DeletionCandidate[] = Array.from({ length: 55 }, (_, i) => ({
    docId: `doc-${i}`,
    path: `service-jobs/job-${i}/documents/file-${i}.pdf`,
    deleteAfter: daysFromNow(-1),
  }));
  const firestore = new FakeFirestoreClient(
    many.map((c) => record({ docId: c.docId, path: c.path, deleteAfter: c.deleteAfter }))
  );
  const bucket = new FakeR2Bucket(many.map((c) => c.path));
  const run = await runDeletionExecutor(many, deps(firestore, bucket), 50, 3);
  check('12. exactly 50 deletions are performed, not 55', run.deletedCount === 50);
  check(
    '12. the remaining 5 are reported skipped, not silently dropped',
    run.results.filter(
      (r) => r.result === 'skipped' && r.reason.includes('maximum deletions')
    ).length === 5
  );
}

// --- 13. failure threshold = 3 halts the run ---
{
  const many: DeletionCandidate[] = Array.from({ length: 10 }, (_, i) => ({
    docId: `fail-doc-${i}`,
    path: `service-jobs/job-${i}/documents/file-${i}.pdf`,
    deleteAfter: daysFromNow(-1),
  }));
  const firestore = new FakeFirestoreClient(
    many.map((c) => record({ docId: c.docId, path: c.path, deleteAfter: c.deleteAfter }))
  );
  const bucket = new FakeR2Bucket(many.map((c) => c.path));
  bucket.throwOnDelete = true; // every delete fails
  const run = await runDeletionExecutor(many, deps(firestore, bucket), 50, 3);
  check(
    '13. run halts after exactly 3 failures',
    run.halted === true && run.failedCount === 3
  );
}

// --- 14. halted run preserves previously-obtained results ---
{
  const many: DeletionCandidate[] = Array.from({ length: 6 }, (_, i) => ({
    docId: `mix-doc-${i}`,
    path: `service-jobs/job-${i}/documents/file-${i}.pdf`,
    deleteAfter: i < 3 ? daysFromNow(-1) : daysFromNow(-1), // all eligible; failures come from R2
  }));
  const firestore = new FakeFirestoreClient(
    many.map((c) => record({ docId: c.docId, path: c.path, deleteAfter: c.deleteAfter }))
  );
  const bucket = new FakeR2Bucket(many.map((c) => c.path));
  bucket.throwOnDelete = true;
  const run = await runDeletionExecutor(many, deps(firestore, bucket), 50, 3);
  const preHaltFailures = run.results.filter((r) => r.result === 'failed');
  check(
    '14. the 3 real failure results are preserved in the output',
    preHaltFailures.length === 3
  );
}

// --- 15. no processing after halt (remaining candidates marked halted, not attempted) ---
{
  const many: DeletionCandidate[] = Array.from({ length: 6 }, (_, i) => ({
    docId: `halt-doc-${i}`,
    path: `service-jobs/job-${i}/documents/file-${i}.pdf`,
    deleteAfter: daysFromNow(-1),
  }));
  const firestore = new FakeFirestoreClient(
    many.map((c) => record({ docId: c.docId, path: c.path, deleteAfter: c.deleteAfter }))
  );
  const bucket = new FakeR2Bucket(many.map((c) => c.path));
  bucket.throwOnDelete = true;
  const run = await runDeletionExecutor(many, deps(firestore, bucket), 50, 3);
  const haltedResults = run.results.filter((r) => r.result === 'halted');
  check(
    '15. candidates after the halt point are marked halted, not processed',
    haltedResults.length === 3
  );
  check(
    '15. total results still account for every candidate (6)',
    run.results.length === 6
  );
}

// --- 16. malformed policy values are rejected, not silently defaulted ---
{
  const firestore = new FakeFirestoreClient([record()]);
  const bucket = new FakeR2Bucket([candidate().path]);
  let threwOnBadMax = false;
  try {
    await runDeletionExecutor([candidate()], deps(firestore, bucket), -1, 3);
  } catch {
    threwOnBadMax = true;
  }
  check('16. a negative maxDeletionsPerRun is rejected', threwOnBadMax);

  let threwOnBadThreshold = false;
  try {
    await runDeletionExecutor([candidate()], deps(firestore, bucket), 50, 0);
  } catch {
    threwOnBadThreshold = true;
  }
  check('16. a non-positive failureThreshold is rejected', threwOnBadThreshold);
}

// --- 17. idempotent repeated execution ---
{
  const path = candidate().path;
  const firestore = new FakeFirestoreClient([record()]);
  const bucket = new FakeR2Bucket([path]);
  const firstRun = await runDeletionExecutor(
    [candidate()],
    deps(firestore, bucket),
    50,
    3
  );
  const secondRun = await runDeletionExecutor(
    [candidate()],
    deps(firestore, bucket),
    50,
    3
  );
  check('17. first run deletes the object', firstRun.results[0]?.result === 'deleted');
  check(
    '17. first run marks Firestore deletedAt',
    firestore.deletedAtFor(candidate().docId) === NOW.toISOString()
  );
  check(
    '17. second run on the same candidate is skipped (deletedAt already set) — never reprocessed',
    secondRun.results[0]?.result === 'skipped'
  );
  check(
    '17. repeated execution never throws or corrupts state',
    secondRun.failedCount === 0
  );
}

// --- 18. audit result structure ---
{
  const path = candidate().path;
  const firestore = new FakeFirestoreClient([record()]);
  const bucket = new FakeR2Bucket([path]);
  const run = await runDeletionExecutor([candidate()], deps(firestore, bucket), 50, 3);
  const entry = run.results[0];
  check(
    '18. audit entry has exactly the required fields',
    !!entry &&
      typeof entry.attachmentId === 'string' &&
      typeof entry.objectKey === 'string' &&
      typeof entry.result === 'string' &&
      typeof entry.reason === 'string' &&
      typeof entry.timestamp === 'string'
  );
  check(
    '18. the deleted reason explicitly confirms Firestore was marked, not deleted (F5d-17, DECISIONS.md #025)',
    !!entry && entry.reason.includes('never hard-deleted')
  );
  check(
    '18. audit entry contains no secret-shaped content',
    !!entry &&
      !JSON.stringify(entry).toLowerCase().includes('private_key') &&
      !JSON.stringify(entry).toLowerCase().includes('authorization')
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll checks passed.');
