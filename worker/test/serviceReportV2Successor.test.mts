import { createServiceReportSuccessorV2 } from '../src/serviceReportV2Operations.ts';
import {
  ServiceReportV2Error,
  parseSuccessorRequest,
  successorRequestFingerprint,
} from '../src/serviceReportV2Contracts.ts';
import {
  canonicalizeEvidenceKeys,
  compareCanonicalAttachmentKeys,
  parseConfirmedOmissionSet,
} from '../../src/services/evidenceOmission.ts';
import { attachmentMetadataDocId } from '../../src/services/attachmentIdentity.ts';
import {
  MemoryObjectStore,
  MemoryV2Store,
  SERVICE_JOB_ID,
  evidenceKey,
  putEvidence,
  seedFinalReport,
  seedServiceJob,
  seedStaffProfile,
  setDeletionClaimState,
} from './serviceReportV2StoreHarness.mts';

let failures = 0;
function check(name: string, value: boolean) {
  if (value) console.log(`  PASS  ${name}`);
  else {
    failures += 1;
    console.error(`  FAIL  ${name}`);
  }
}

console.log('Running Service Report V2 successor omission regression test');

const KEY_A = evidenceKey('1');
const KEY_B = evidenceKey('2');
const KEY_C = evidenceKey('3');
const ACTOR = { uid: 'tech-uid-0001' };
const KEY_UUID = '11111111-1111-4111-8111-111111111111';

const DIGEST_PLACEHOLDER = `sha256:v1:${'0'.repeat(64)}`;

function successorBody(omissions: string[]) {
  return {
    contractVersion: 2,
    expectedPredecessorDigest: DIGEST_PLACEHOLDER,
    confirmedOmittedEvidenceAttachmentIds: omissions,
  };
}

async function fingerprintFor(omissions: string[]) {
  return successorRequestFingerprint(
    SERVICE_JOB_ID,
    'predecessor-1',
    parseSuccessorRequest(successorBody(omissions))
  );
}

function expectV2Error(operation: () => unknown): ServiceReportV2Error | null {
  try {
    operation();
    return null;
  } catch (error) {
    return error instanceof ServiceReportV2Error ? error : null;
  }
}

async function expectAsyncV2Error(
  operation: () => Promise<unknown>
): Promise<ServiceReportV2Error | null> {
  try {
    await operation();
    return null;
  } catch (error) {
    return error instanceof ServiceReportV2Error ? error : null;
  }
}

// 1-3, 14: set semantics of the request identity
{
  check('1. [] and [] share one canonical fingerprint', (await fingerprintFor([])) === (await fingerprintFor([])));
  check('2. [A] and [A] share one canonical fingerprint', (await fingerprintFor([KEY_A])) === (await fingerprintFor([KEY_A])));
  check(
    '3. [A,B] and [B,A] produce an identical canonical fingerprint',
    (await fingerprintFor([KEY_A, KEY_B])) === (await fingerprintFor([KEY_B, KEY_A]))
  );
  check(
    '3b. [A] and [A,B] remain different request identities',
    (await fingerprintFor([KEY_A])) !== (await fingerprintFor([KEY_A, KEY_B]))
  );
}

// 4: duplicates are rejected, never silently deduplicated
{
  const error = expectV2Error(() => parseSuccessorRequest(successorBody([KEY_A, KEY_A])));
  check(
    '4. a duplicated omission is rejected 400 validation_failed',
    error?.status === 400 && error.code === 'validation_failed'
  );
  const parsed = parseConfirmedOmissionSet([KEY_A, KEY_A]);
  check('4b. the shared parser reports duplicate-key rather than collapsing', !parsed.ok && parsed.reason === 'duplicate-key');
}

// 5: canonical ordering is ascending unsigned ASCII-byte, not localeCompare
{
  const ordered = canonicalizeEvidenceKeys([KEY_C, KEY_A, KEY_B]);
  check('5. canonical order is ascending byte order', ordered[0] === KEY_A && ordered[1] === KEY_B && ordered[2] === KEY_C);
  check('5b. uppercase sorts before lowercase (byte order, not locale)', compareCanonicalAttachmentKeys('Z', 'a') < 0);
  check('5c. localeCompare would disagree, proving the rule is byte-based', 'Z'.localeCompare('a') > 0);
  check('5d. a prefix sorts before its extension', compareCanonicalAttachmentKeys('ab', 'abc') < 0);
  const request = parseSuccessorRequest(successorBody([KEY_C, KEY_A]));
  check(
    '5e. the parser returns the omission set already canonically sorted',
    request.confirmedOmittedEvidenceAttachmentIds[0] === KEY_A &&
      request.confirmedOmittedEvidenceAttachmentIds[1] === KEY_C
  );
}

// 13: a metadata document ID is not a canonical omission key
{
  const metadataId = await attachmentMetadataDocId(KEY_A as never);
  const error = expectV2Error(() => parseSuccessorRequest(successorBody([metadataId])));
  check(
    '13. a metadata document ID is rejected as an omission key',
    error?.status === 400 && error.code === 'validation_failed'
  );
}

async function buildSuccessorFixture(options: {
  evidence: string[];
  available: string[];
  crossBrandKeys?: string[];
} = { evidence: [KEY_A], available: [KEY_A] }) {
  const store = new MemoryV2Store();
  const objects = new MemoryObjectStore();
  seedServiceJob(store);
  seedStaffProfile(store, ACTOR.uid, { role: 'technician', displayName: 'QA Technician' });
  for (const key of options.evidence) {
    const crossBrand = options.crossBrandKeys?.includes(key) ?? false;
    if (options.available.includes(key) || crossBrand) {
      await putEvidence(store, objects, key, crossBrand ? { jobId: 'BRN-2026-000999' } : {});
    }
  }
  const predecessor = await seedFinalReport(store, {
    reportId: 'predecessor-1',
    approvalState: 'rejected',
    evidenceAttachmentIds: options.evidence,
  });
  return { store, objects, predecessor };
}

function runSuccessor(
  fixture: Awaited<ReturnType<typeof buildSuccessorFixture>>,
  omissions: string[],
  idempotencyKey = KEY_UUID
) {
  return createServiceReportSuccessorV2({
    store: fixture.store,
    objects: fixture.objects,
    actor: ACTOR,
    serviceJobId: SERVICE_JOB_ID,
    predecessorReportId: 'predecessor-1',
    idempotencyKey,
    request: {
      contractVersion: 2,
      expectedPredecessorDigest: fixture.predecessor.finalContentDigest as never,
      confirmedOmittedEvidenceAttachmentIds: canonicalizeEvidenceKeys(omissions) as never,
    },
    now: '2026-03-01T00:00:00.000Z',
  });
}

// 6, 7: extra and missing omissions both fail confirmation
{
  const fixture = await buildSuccessorFixture({ evidence: [KEY_A, KEY_B], available: [KEY_A] });
  const extra = await expectAsyncV2Error(() => runSuccessor(fixture, [KEY_A, KEY_B]));
  check(
    '6. an extra omission fails successor_evidence_confirmation_required',
    extra?.status === 409 && extra.code === 'successor_evidence_confirmation_required'
  );
  const missing = await expectAsyncV2Error(() => runSuccessor(fixture, []));
  check(
    '7. a missing omission fails successor_evidence_confirmation_required',
    missing?.status === 409 && missing.code === 'successor_evidence_confirmation_required'
  );
  check(
    '7b. the confirmation error returns the eligible set in canonical order',
    Array.isArray(missing?.safeData?.eligibleEvidenceAttachmentIds) &&
      (missing.safeData.eligibleEvidenceAttachmentIds as string[])[0] === KEY_B
  );
  check('7c. no successor and no idempotency record were written', fixture.store.committedWrites.length === 0);
}

// 8: evidence that is valid again must no longer be omitted
{
  const fixture = await buildSuccessorFixture({ evidence: [KEY_A, KEY_B], available: [KEY_A, KEY_B] });
  const error = await expectAsyncV2Error(() => runSuccessor(fixture, [KEY_B]));
  check(
    '8. now-valid evidence cannot still be confirmed as omitted',
    error?.status === 409 && error.code === 'successor_evidence_confirmation_required'
  );
}

// 9: evidence that disappears between pre-check and commit must be re-confirmed
{
  const fixture = await buildSuccessorFixture({ evidence: [KEY_A, KEY_B], available: [KEY_A, KEY_B] });
  // serviceReportIdempotency is the first read inside the transaction, so
  // dropping KEY_B's bytes here lands strictly between the pre-transaction
  // classification (which saw it as available) and the in-transaction
  // re-derivation — the only thing that can catch the drift.
  const originalGet = fixture.store.get.bind(fixture.store);
  fixture.store.get = async (collection, id) => {
    if (collection === 'serviceReportIdempotency') fixture.objects.remove(KEY_B);
    return originalGet(collection, id);
  };
  const error = await expectAsyncV2Error(() => runSuccessor(fixture, []));
  check(
    '9. newly-unavailable evidence forces re-confirmation before commit',
    error?.status === 409 && error.code === 'successor_evidence_confirmation_required'
  );
  check('9b. nothing was committed when the set drifted', fixture.store.committedWrites.length === 0);
}

// 10, 11: temporary and ambiguous deletion states are never omittable
for (const [label, state] of [['10. temporary', 'claimed'], ['11. ambiguous', 'failed']] as const) {
  const fixture = await buildSuccessorFixture({ evidence: [KEY_A], available: [KEY_A] });
  await setDeletionClaimState(fixture.store, KEY_A, state);
  const error = await expectAsyncV2Error(() => runSuccessor(fixture, [KEY_A]));
  check(
    `${label} deletion state (${state}) is not an omission candidate`,
    error?.status === 409 && error.code === 'evidence_deletion_in_progress'
  );
  check(`${label} deletion state wrote nothing`, fixture.store.committedWrites.length === 0);
}

// 12: cross-brand evidence is an integrity failure, never an eligible omission
{
  const fixture = await buildSuccessorFixture({
    evidence: [KEY_A],
    available: [],
    crossBrandKeys: [KEY_A],
  });
  const error = await expectAsyncV2Error(() => runSuccessor(fixture, [KEY_A]));
  check(
    '12. cross-brand evidence raises forbidden rather than becoming eligible',
    error?.status === 403 && error.code === 'forbidden'
  );
  check('12b. cross-brand evidence is not returned as an eligible omission', error?.safeData === null);
}

// 16, 17, 18: successor content
{
  const fixture = await buildSuccessorFixture({
    evidence: [KEY_C, KEY_A, KEY_B],
    available: [KEY_C, KEY_A],
  });
  const result = await runSuccessor(fixture, [KEY_B]);
  check(
    '16. successor evidence preserves predecessor documentary order, unsorted',
    result.data.evidenceAttachmentIds[0] === KEY_C && result.data.evidenceAttachmentIds[1] === KEY_A
  );
  check('17. the omitted key is absent from the successor', !result.data.evidenceAttachmentIds.includes(KEY_B as never));
  check(
    '18. no R2 object was copied or deleted creating the successor',
    fixture.objects.copied.length === 0 && fixture.objects.deleted.length === 0
  );
  check('18b. the successor references its predecessor', result.data.predecessorReportId === 'predecessor-1');
}

// 14, 15: replay under a reordered set, mismatch under a changed set
{
  const fixture = await buildSuccessorFixture({ evidence: [KEY_A, KEY_B], available: [KEY_A] });
  const first = await runSuccessor(fixture, [KEY_B]);
  check('14a. the first successor request commits', first.replayed === false);
  const replay = await runSuccessor(fixture, [KEY_B]);
  check(
    '14. the same key with a reordered/equal set replays the same successor',
    replay.replayed === true && replay.data.reportId === first.data.reportId
  );

  const changed = await buildSuccessorFixture({ evidence: [KEY_A, KEY_B], available: [] });
  changed.store.set(
    'serviceReportIdempotency',
    [...fixture.store.docs.keys()]
      .filter((address) => address.startsWith('serviceReportIdempotency/'))
      .map((address) => address.slice('serviceReportIdempotency/'.length))[0]!,
    fixture.store.read(
      'serviceReportIdempotency',
      [...fixture.store.docs.keys()]
        .filter((address) => address.startsWith('serviceReportIdempotency/'))
        .map((address) => address.slice('serviceReportIdempotency/'.length))[0]!
    )!
  );
  const mismatch = await expectAsyncV2Error(() => runSuccessor(changed, [KEY_A, KEY_B]));
  check(
    '15. the same key with a genuinely changed set is an idempotency_mismatch',
    mismatch?.status === 409 && mismatch.code === 'idempotency_mismatch'
  );
}

// 19: no completed idempotency record survives a precommit failure
{
  const fixture = await buildSuccessorFixture({ evidence: [KEY_A, KEY_B], available: [KEY_A] });
  await expectAsyncV2Error(() => runSuccessor(fixture, []));
  const records = [...fixture.store.docs.keys()].filter((address) =>
    address.startsWith('serviceReportIdempotency/')
  );
  check('19. a precommit confirmation failure writes no completed idempotency record', records.length === 0);

  const staleDigest = await buildSuccessorFixture({ evidence: [KEY_A], available: [KEY_A] });
  const stale = await expectAsyncV2Error(() =>
    createServiceReportSuccessorV2({
      store: staleDigest.store,
      objects: staleDigest.objects,
      actor: ACTOR,
      serviceJobId: SERVICE_JOB_ID,
      predecessorReportId: 'predecessor-1',
      idempotencyKey: KEY_UUID,
      request: {
        contractVersion: 2,
        expectedPredecessorDigest: DIGEST_PLACEHOLDER as never,
        confirmedOmittedEvidenceAttachmentIds: [],
      },
      now: '2026-03-01T00:00:00.000Z',
    })
  );
  check('19b. a stale predecessor digest fails 412', stale?.status === 412 && stale.code === 'stale_digest');
  check(
    '19c. the stale-digest failure wrote no idempotency record',
    [...staleDigest.store.docs.keys()].every((address) => !address.startsWith('serviceReportIdempotency/'))
  );
}

if (failures) process.exitCode = 1;
