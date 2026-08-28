import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import assert from 'node:assert/strict';
import { after, beforeEach, test as nodeTest } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  or,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

const projectId = 'f5d26-rules';
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

// PI-4R correction — this suite requires a live Firestore emulator
// (`npm run test:firestore-rules`, which starts one via `firebase
// emulators:exec` before running this file, which also sets
// FIRESTORE_EMULATOR_HOST for the child process automatically). Run under
// the plain root harness (`node --test test/*.test.mjs`, no emulator), the
// original unconditional `initializeTestEnvironment` call attempted a dead
// connection and made root validation nondeterministic.
//
// PI-4 fixed that by skipping unreachable-emulator runs — but PI-4R proved
// that fix created a FALSE-GREEN hole: setting FIRESTORE_EMULATOR_HOST to a
// deliberately unused port made all 26 Rules tests skip cleanly and the
// process exit 0, indistinguishable from "no emulator configured at all."
// A caller who explicitly configured an emulator host asked for real Rules
// coverage; silently skipping when that specific host is unreachable is
// exactly the false-green PI-4R flagged, not a safe degradation.
//
// Two genuinely different situations, told apart by whether
// FIRESTORE_EMULATOR_HOST was SET at all, not merely by reachability:
//   - MODE A: not set. The caller made no claim about an emulator (this is
//     the plain `node --test test/*.test.mjs` root harness). Unreachable
//     here is expected and safe — every test is registered via node:test's
//     own `skip` option (visible in TAP output, never silently "passed").
//   - MODE B: explicitly set. The caller asked for a specific emulator.
//     Reachable — every test runs for real, exactly as before, and a
//     genuine Rules failure still fails the process normally. Unreachable
//     — this is a validation FAILURE, never a skip: every test is
//     registered as an unconditional failure explaining why, so the
//     process exits nonzero and nothing is misreported as passing or as an
//     ordinary optional skip.
const emulatorHostConfigured = process.env.FIRESTORE_EMULATOR_HOST !== undefined;
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8085').split(':');

// One short, bounded TCP reachability probe against the emulator's own
// host/port before attempting to use it at all — no dead-connection hang
// in either mode.
function isEmulatorReachable(hostName, portNumber, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = connect({ host: hostName, port: portNumber, timeout: timeoutMs });
    const settle = (reachable) => {
      socket.destroy();
      resolve(reachable);
    };
    socket.once('connect', () => settle(true));
    socket.once('timeout', () => settle(false));
    socket.once('error', () => settle(false));
  });
}

const reachable = await isEmulatorReachable(host, Number(port));
const emulatorAvailable = reachable;
const configuredButUnreachable = emulatorHostConfigured && !reachable;

const skipReason = `Firestore emulator not reachable at ${host}:${port} and FIRESTORE_EMULATOR_HOST was not set — this suite requires a live emulator; run \`npm run test:firestore-rules\`, not a bare \`node --test\``;
const failureReason =
  `FIRESTORE_EMULATOR_HOST=${host}:${port} was explicitly configured but is not reachable. ` +
  'A configured-but-unreachable emulator is a validation FAILURE, never a skip — start the ' +
  'emulator this host:port points at, or unset FIRESTORE_EMULATOR_HOST to use the deterministic ' +
  'no-emulator skip path instead.';

// Shadows the node:test import so every existing `test(name, fn)` call site
// below is unchanged syntactically.
const test = emulatorAvailable
  ? nodeTest
  : configuredButUnreachable
    ? // MODE B, unreachable: every test is registered as an unconditional
      // failure (never the original body — it would only try to reach the
      // same dead socket) so each is reported FAILED, not skipped, and the
      // process exits nonzero.
      (name) =>
        nodeTest(name, () => {
          throw new Error(failureReason);
        })
    : (name, fn) => nodeTest(name, { skip: skipReason }, fn);

const testEnvironment = emulatorAvailable
  ? await initializeTestEnvironment({
      projectId,
      firestore: { host, port: Number(port), rules },
    })
  : null;

const brunoUid = 'staff-bruno';
const joinLuxUid = 'staff-join-lux';

function staffDb(uid) {
  return testEnvironment.authenticatedContext(uid).firestore();
}

function unauthenticatedDb() {
  return testEnvironment.unauthenticatedContext().firestore();
}

function serviceJob(brandId, status = 'Received') {
  return {
    brandId,
    status,
    closedAt: null,
    customerName: 'Synthetic test record',
    publicTrackingTokenHash: null,
  };
}

function serviceReport(serviceJobId, status = 'draft', overrides = {}) {
  return {
    serviceJobId,
    reportNo: 'FR-2026-000001',
    status,
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
    finalizedAt: status === 'final' ? '2026-08-17T00:00:00.000Z' : null,
    technician: 'QA Tech',
    customerReportedProblem: 'Fault reported',
    inspectionFindings: 'Fault reproduced',
    serviceActions: ['repair'],
    parts: [],
    technicianRemark: '',
    resultStatus: 'repaired',
    resultDetail: '',
    evidenceAttachmentIds: [],
    claimNo: null,
    factoryReference: null,
    snapshot:
      status === 'final'
        ? {
            trackingReference: serviceJobId,
            customerName: 'Synthetic test record',
            customerPhone: '0000000000',
            customerEmail: '',
            brandCode: 'BRN',
            brandName: 'Bruno Thailand',
            productName: 'QA Product',
            modelOrSku: null,
            serialNumber: 'SERIAL-1',
            customerReportedProblem: 'Fault reported',
          }
        : null,
    ...overrides,
  };
}

// A schemaVersion 2 draft, the only shape the accepted V2 draft-CAS contract
// lets a client edit directly. V1 reports are edited through the Worker's
// saveLegacyServiceReportDraft route instead, never by a client write.
function serviceReportV2(serviceJobId, brandId, overrides = {}) {
  return {
    schemaVersion: 2,
    reportId: 'report-bruno-v2-draft',
    serviceJobId,
    reportNo: 'FR-2026-000002',
    brandId,
    status: 'draft',
    activeDraftGeneration: 1,
    createdAt: '2026-08-17T00:00:00.000Z',
    createdByUid: 'rules-test',
    createdByRoleSnapshot: 'technician',
    createdByDisplayNameSnapshot: 'QA Tech',
    contentRevision: 3,
    updatedAt: '2026-08-17T00:00:00.000Z',
    predecessorReportId: null,
    technician: 'QA Tech',
    customerReportedProblem: 'Fault reported',
    inspectionFindings: 'Fault reproduced',
    serviceActions: ['repair'],
    parts: [],
    technicianRemark: '',
    resultStatus: 'repaired',
    resultDetail: '',
    evidenceAttachmentIds: [],
    claimNo: null,
    factoryReference: null,
    warrantyOutcome: 'covered',
    snapshot: null,
    finalizedAt: null,
    finalizedByUid: null,
    finalizedByRoleSnapshot: null,
    finalizedByDisplayNameSnapshot: null,
    finalizedFromRevision: null,
    finalContentDigest: null,
    approvalState: 'not-submitted',
    currentApprovalEventId: null,
    approvalDecidedAt: null,
    ...overrides,
  };
}

function attachment(jobId, deletedAt = null) {
  return {
    jobId,
    category: 'documents',
    name: 'qa.pdf',
    path: `service-jobs/${jobId}/documents/qa.pdf`,
    contentType: 'application/pdf',
    size: 1,
    uploadedAt: '2026-08-09T00:00:00.000Z',
    uploadedBy: 'rules-test',
    deleteAfter: null,
    retentionStatus: 'active',
    retentionExtensions: [],
    deletedAt,
  };
}

async function seed() {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, 'staffProfiles', brunoUid), {
        brandId: 'bruno-thailand',
        role: 'technician',
      }),
      setDoc(doc(db, 'staffProfiles', joinLuxUid), {
        brandId: 'join-lux-club',
        role: 'technician',
      }),
      setDoc(doc(db, 'staffProfiles', 'staff-malformed'), { brandId: 'BRN' }),
      setDoc(doc(db, 'staffProfiles', 'staff-no-role'), { brandId: 'bruno-thailand' }),
      setDoc(doc(db, 'staffProfiles', 'staff-approver'), {
        brandId: 'bruno-thailand',
        role: 'approver',
      }),
      setDoc(doc(db, 'staffProfiles', 'staff-admin'), {
        brandId: 'bruno-thailand',
        role: 'admin',
      }),
      setDoc(doc(db, 'serviceJobs', 'job-bruno'), serviceJob('bruno-thailand')),
      setDoc(doc(db, 'serviceJobs', 'job-join-lux'), serviceJob('join-lux-club')),
      setDoc(doc(db, 'serviceJobs', 'job-legacy'), serviceJob(null)),
      // F5d-69 — brand-owned but seeded WITHOUT any F5d-69 metadata field,
      // and deliberately never mutated by another test, so the legacy
      // missing-field case stays genuinely untouched.
      setDoc(doc(db, 'serviceJobs', 'job-legacy-bruno'), serviceJob('bruno-thailand')),
      // F5d-69 Phase 2A-FIX — a second, otherwise-identical legacy fixture
      // reserved for the order/verification truth-table cases, so those
      // writes never share state with job-legacy-bruno's own assertions.
      setDoc(doc(db, 'serviceJobs', 'job-legacy-bruno-2'), serviceJob('bruno-thailand')),
      setDoc(
        doc(db, 'serviceJobAttachments', 'attachment-bruno'),
        attachment('job-bruno')
      ),
      setDoc(
        doc(db, 'serviceJobAttachments', 'attachment-deleted'),
        attachment('job-bruno', Timestamp.fromDate(new Date('2026-08-09T00:00:00.000Z')))
      ),
      setDoc(doc(db, 'products', 'product-1'), { brand: 'BRUNO' }),
      setDoc(doc(db, 'customers', 'customer-bruno'), {
        name: 'Bruno customer',
        brandIds: ['bruno-thailand'],
      }),
      setDoc(doc(db, 'customers', 'customer-join-lux'), {
        name: 'Join Lux customer',
        brandIds: ['join-lux-club'],
      }),
      setDoc(doc(db, 'customers', 'customer-multi-brand'), {
        name: 'Multi-brand customer',
        brandIds: ['bruno-thailand', 'join-lux-club'],
      }),
      setDoc(doc(db, 'customers', 'customer-legacy'), { name: 'Legacy customer' }),
      setDoc(
        doc(db, 'serviceReports', 'report-bruno-draft'),
        serviceReport('job-bruno', 'draft')
      ),
      setDoc(
        doc(db, 'serviceReports', 'report-join-lux-draft'),
        serviceReport('job-join-lux', 'draft')
      ),
      setDoc(
        doc(db, 'serviceReports', 'report-bruno-final'),
        serviceReport('job-bruno', 'final')
      ),
      setDoc(
        doc(db, 'serviceReports', 'report-bruno-v2-draft'),
        serviceReportV2('job-bruno', 'bruno-thailand')
      ),
    ]);
  });
}

beforeEach(async () => {
  if (!emulatorAvailable) return;
  await testEnvironment.clearFirestore();
  await seed();
});

after(async () => {
  if (!emulatorAvailable) return;
  await testEnvironment.cleanup();
});

test('unauthenticated and generic public ServiceJob reads are denied', async () => {
  const db = unauthenticatedDb();
  await assertFails(getDoc(doc(db, 'serviceJobs', 'job-bruno')));
  await assertFails(getDocs(collection(db, 'serviceJobs')));
});

test('staff profiles are readable only by their owner and never client-writable', async () => {
  const brunoDb = staffDb(brunoUid);
  await assertSucceeds(getDoc(doc(brunoDb, 'staffProfiles', brunoUid)));
  await assertFails(getDoc(doc(brunoDb, 'staffProfiles', joinLuxUid)));
  await assertFails(
    setDoc(doc(brunoDb, 'staffProfiles', brunoUid), { brandId: 'join-lux-club' })
  );
});

test('authenticated staff without a profile or with a non-canonical brand are denied', async () => {
  const noProfileDb = staffDb('staff-no-profile');
  await assertFails(getDoc(doc(noProfileDb, 'serviceJobs', 'job-bruno')));
  await assertFails(getDoc(doc(noProfileDb, 'customers', 'customer-bruno')));
  await assertFails(getDoc(doc(noProfileDb, 'products', 'product-1')));

  const malformedDb = staffDb('staff-malformed');
  await assertFails(getDoc(doc(malformedDb, 'serviceJobs', 'job-bruno')));
  await assertFails(getDoc(doc(malformedDb, 'customers', 'customer-bruno')));
  await assertFails(getDoc(doc(malformedDb, 'products', 'product-1')));
});

test('same-brand ServiceJob get and scoped list are allowed', async () => {
  const brunoDb = staffDb(brunoUid);
  await assertSucceeds(getDoc(doc(brunoDb, 'serviceJobs', 'job-bruno')));
  await assertSucceeds(
    getDocs(
      query(collection(brunoDb, 'serviceJobs'), where('brandId', '==', 'bruno-thailand'))
    )
  );
});

test('cross-brand and legacy ServiceJobs are denied', async () => {
  const brunoDb = staffDb(brunoUid);
  await assertFails(getDoc(doc(brunoDb, 'serviceJobs', 'job-join-lux')));
  await assertFails(getDoc(doc(brunoDb, 'serviceJobs', 'job-legacy')));
});

test('browser ServiceJob creates and private allocator collections are denied', async () => {
  const brunoDb = staffDb(brunoUid);
  await assertFails(
    setDoc(doc(brunoDb, 'serviceJobs', 'job-new'), serviceJob('bruno-thailand'))
  );
  await assertFails(getDoc(doc(brunoDb, 'serviceJobs', 'not-a-real-service-job')));
  await assertFails(
    getDoc(doc(brunoDb, 'numberSequences', 'bruno-thailand__tracking_number__2026'))
  );
  await assertFails(
    setDoc(doc(brunoDb, 'numberSequences', 'bruno-thailand__tracking_number__2026'), {
      currentValue: 1,
    })
  );
  await assertFails(getDoc(doc(brunoDb, 'serviceJobIntakeKeys', 'key')));
  await assertFails(
    setDoc(doc(brunoDb, 'serviceJobIntakeKeys', 'key'), { serviceJobId: 'job-new' })
  );
});

test('existing authorized ServiceJob updates preserve privileged fields and deny delete', async () => {
  const brunoDb = staffDb(brunoUid);
  await assertSucceeds(
    updateDoc(doc(brunoDb, 'serviceJobs', 'job-bruno'), { status: 'Diagnosing' })
  );
  await assertFails(
    updateDoc(doc(brunoDb, 'serviceJobs', 'job-bruno'), { brandId: 'join-lux-club' })
  );
  await assertFails(
    updateDoc(doc(brunoDb, 'serviceJobs', 'job-bruno'), { brandId: 'join-lux-club' })
  );
  await assertFails(
    updateDoc(doc(brunoDb, 'serviceJobs', 'job-bruno'), {
      publicTrackingCodeHash: 'forged',
    })
  );
  await assertFails(
    updateDoc(doc(brunoDb, 'serviceJobs', 'job-bruno'), {
      publicTrackingTokenHash: 'arbitrary-client-issued-token-hash',
    })
  );
  await assertFails(
    setDoc(doc(brunoDb, 'serviceJobs', 'job-token-set-on-create'), {
      ...serviceJob('bruno-thailand'),
      publicTrackingTokenHash: 'arbitrary-client-issued-token-hash',
    })
  );
  await assertFails(deleteDoc(doc(brunoDb, 'serviceJobs', 'job-bruno')));
});

// F5d-69 / DECISIONS.md #041 — Service Jobs are updated directly from the
// browser, so these rules are the only enforcement on later staff edits of
// the contact/order/external-evidence metadata (the Worker validates the
// same contract at creation, where it bypasses Rules with privileged
// credentials).

test('F5d-69 authorized staff can set, correct, and clear all service-event metadata', async () => {
  const brunoDb = staffDb(brunoUid);
  const jobRef = doc(brunoDb, 'serviceJobs', 'job-bruno');

  await assertSucceeds(
    updateDoc(jobRef, {
      contactChannel: 'shopee',
      contactChannelIdentity: 'customer_123',
      orderNumber: '250731SHP04821',
      orderVerification: 'unverified',
      purchaseDate: '2026-07-31',
      orderDeliveredDate: '2026-08-02',
      externalEvidenceUrl: 'https://drive.google.com/file/d/abc/view',
      externalEvidenceNote: 'เครื่องดับหลังเปิดประมาณ 5 นาที',
    })
  );
  // Correcting a typo on this event's own snapshot is explicitly allowed.
  await assertSucceeds(updateDoc(jobRef, { contactChannelIdentity: 'customer_1234' }));
  await assertSucceeds(updateDoc(jobRef, { orderVerification: 'verified' }));
  await assertSucceeds(updateDoc(jobRef, { orderVerification: 'not_found' }));
  await assertSucceeds(updateDoc(jobRef, { purchaseDate: '2026-01-01' }));
  // Every approved channel is accepted.
  for (const channel of ['lazada', 'line', 'store', 'website', 'other']) {
    await assertSucceeds(updateDoc(jobRef, { contactChannel: channel }));
  }
  // Clearing to null is how the UI removes a value.
  await assertSucceeds(
    updateDoc(jobRef, {
      externalEvidenceUrl: null,
      externalEvidenceNote: null,
      purchaseDate: null,
      orderDeliveredDate: null,
    })
  );
  await assertSucceeds(
    updateDoc(jobRef, { orderNumber: null, orderVerification: null })
  );
  await assertSucceeds(
    updateDoc(jobRef, { contactChannel: null, contactChannelIdentity: null })
  );
  // 'phone' carries no separate identity — the canonical phone is the identity.
  await assertSucceeds(updateDoc(jobRef, { contactChannel: 'phone' }));
});

test('F5d-69 invalid service-event metadata is denied', async () => {
  const brunoDb = staffDb(brunoUid);
  const jobRef = doc(brunoDb, 'serviceJobs', 'job-bruno');

  await assertFails(updateDoc(jobRef, { contactChannel: 'tiktok_shop' }));
  await assertFails(updateDoc(jobRef, { contactChannel: 42 }));
  await assertFails(
    updateDoc(jobRef, { contactChannel: 'line', contactChannelIdentity: 'a'.repeat(121) })
  );
  await assertFails(updateDoc(jobRef, { orderNumber: 'a'.repeat(65) }));
  await assertFails(
    updateDoc(jobRef, { orderNumber: 'ABC-1', orderVerification: 'approved' })
  );
  for (const badDate of ['18-08-2026', '2026/08/18', '2026-8-1', '2026-13-01', '2026-08-32']) {
    await assertFails(updateDoc(jobRef, { purchaseDate: badDate }));
    await assertFails(updateDoc(jobRef, { orderDeliveredDate: badDate }));
  }
  await assertFails(updateDoc(jobRef, { externalEvidenceUrl: 'http://example.com/a' }));
  await assertFails(updateDoc(jobRef, { externalEvidenceUrl: 'javascript:alert(1)' }));
  await assertFails(updateDoc(jobRef, { externalEvidenceUrl: 'data:text/html,x' }));
  // F5d-69 Phase 2A-FIX section 3: an embedded newline stays denied even
  // though RE2's '.' never matches one is the reason it fails, not an
  // explicit control-character screen — externalEvidenceUrl keeps zero
  // tolerance here, unlike the plain string fields below.
  await assertFails(updateDoc(jobRef, { externalEvidenceUrl: 'https://example.com/a\nb' }));
  await assertFails(
    updateDoc(jobRef, { externalEvidenceUrl: `https://example.com/${'a'.repeat(2048)}` })
  );
  await assertFails(updateDoc(jobRef, { externalEvidenceNote: 'a'.repeat(1001) }));
});

// F5d-69 Phase 2A-FIX section 1/6: Rules never had a control-character
// screen for the plain string fields (validOptionalString checks only type
// and length), so the Worker's relaxed policy for contactChannelIdentity/
// orderNumber/externalEvidenceNote is symmetric with what was already true
// here — proven explicitly rather than left implicit.
test('F5d-69 plain string fields tolerate embedded control characters, matching the relaxed Worker policy', async () => {
  const brunoDb = staffDb(brunoUid);
  const jobRef = doc(brunoDb, 'serviceJobs', 'job-bruno');

  await assertSucceeds(
    updateDoc(jobRef, { contactChannel: 'line', contactChannelIdentity: 'a\nb' })
  );
  await assertSucceeds(updateDoc(jobRef, { orderNumber: 'ABC\t1', orderVerification: 'verified' }));
  await assertSucceeds(updateDoc(jobRef, { externalEvidenceNote: 'line one\r\nline two' }));
});

test('F5d-69 cross-field invariants are enforced on the resulting document', async () => {
  const brunoDb = staffDb(brunoUid);
  const jobRef = doc(brunoDb, 'serviceJobs', 'job-bruno');

  // Reset to a known clean state first.
  await assertSucceeds(
    updateDoc(jobRef, {
      contactChannel: null,
      contactChannelIdentity: null,
      orderNumber: null,
      orderVerification: null,
    })
  );
  // Verification cannot exist without an order number.
  await assertFails(updateDoc(jobRef, { orderVerification: 'verified' }));
  // An identity cannot exist without a channel.
  await assertFails(updateDoc(jobRef, { contactChannelIdentity: 'orphan' }));
  // 'phone' cannot carry its own identity.
  await assertFails(
    updateDoc(jobRef, { contactChannel: 'phone', contactChannelIdentity: '0812345678' })
  );
  // The same pairs are accepted when set together consistently.
  await assertSucceeds(
    updateDoc(jobRef, { orderNumber: 'ABC-1', orderVerification: 'verified' })
  );
  await assertSucceeds(
    updateDoc(jobRef, { contactChannel: 'shopee', contactChannelIdentity: 'shop_user' })
  );
  // Clearing the parent while leaving the child behind is denied.
  await assertFails(updateDoc(jobRef, { orderNumber: null }));
  await assertFails(updateDoc(jobRef, { contactChannel: null }));

  // F5d-69 Phase 2A-FIX section 4: the reverse direction — an order number
  // set while leaving verification null/missing — is now also denied. The
  // pre-fix invariant only checked the direction above (verification
  // without an order number); this closes the asymmetry the Phase 2A-R
  // audit found. Reset to a clean (null, null) pair first so the write
  // under test is the only thing touching either field.
  await assertSucceeds(
    updateDoc(jobRef, { orderNumber: null, orderVerification: null })
  );
  await assertFails(updateDoc(jobRef, { orderNumber: 'NEW-1' }));
  // The valid transition — both set together in the same write — remains
  // allowed.
  await assertSucceeds(
    updateDoc(jobRef, { orderNumber: 'NEW-1', orderVerification: 'unverified' })
  );
});

test('F5d-69 a legacy Service Job missing every new field remains editable', async () => {
  const brunoDb = staffDb(brunoUid);
  // job-legacy-bruno is seeded without any F5d-69 field. An ordinary,
  // unrelated update must not be denied by a missing-field dereference —
  // the exact F5d-33/F5d-34 B-2 defect class this rule block guards against.
  await assertSucceeds(
    updateDoc(doc(brunoDb, 'serviceJobs', 'job-legacy-bruno'), { status: 'Diagnosing' })
  );
  await assertSucceeds(
    updateDoc(doc(brunoDb, 'serviceJobs', 'job-legacy-bruno'), { technician: 'Somsak' })
  );
  // And it can still receive valid new metadata for the first time.
  await assertSucceeds(
    updateDoc(doc(brunoDb, 'serviceJobs', 'job-legacy-bruno'), {
      contactChannel: 'store',
      contactChannelIdentity: 'CentralWorld',
    })
  );

  // F5d-69 Phase 2A-FIX section 4 — explicit LEGACY vs F5d-69-state truth
  // table for the order/verification pair, on a second legacy document so
  // this test's own prior writes above don't influence it:
  //   legacy (both absent) + unrelated edit         -> ALLOW (already above)
  //   legacy (both absent) + orderNumber alone       -> DENY (new state,
  //                                                      missing its pair)
  //   legacy (both absent) + both set together       -> ALLOW
  await assertFails(
    updateDoc(doc(brunoDb, 'serviceJobs', 'job-legacy-bruno-2'), { orderNumber: 'FIRST-1' })
  );
  await assertSucceeds(
    updateDoc(doc(brunoDb, 'serviceJobs', 'job-legacy-bruno-2'), {
      orderNumber: 'FIRST-1',
      orderVerification: 'unverified',
    })
  );
});

test('attachments authorize through the parent ServiceJob and reject destructive metadata changes', async () => {
  const brunoDb = staffDb(brunoUid);
  const joinLuxDb = staffDb(joinLuxUid);
  await assertSucceeds(getDoc(doc(brunoDb, 'serviceJobAttachments', 'attachment-bruno')));
  await assertFails(getDoc(doc(joinLuxDb, 'serviceJobAttachments', 'attachment-bruno')));
  await assertFails(deleteDoc(doc(brunoDb, 'serviceJobAttachments', 'attachment-bruno')));
  await assertFails(
    updateDoc(doc(brunoDb, 'serviceJobAttachments', 'attachment-deleted'), {
      deletedAt: null,
    })
  );
});

test('valid staff can read the global product catalog but cannot write it', async () => {
  const brunoDb = staffDb(brunoUid);
  await assertSucceeds(getDoc(doc(brunoDb, 'products', 'product-1')));
  await assertSucceeds(getDocs(collection(brunoDb, 'products')));
  await assertFails(updateDoc(doc(brunoDb, 'products', 'product-1'), { brand: 'JLC' }));
});

test('customer reads require an explicit brand membership and scoped query', async () => {
  const brunoDb = staffDb(brunoUid);
  const joinLuxDb = staffDb(joinLuxUid);
  await assertSucceeds(getDoc(doc(brunoDb, 'customers', 'customer-bruno')));
  await assertSucceeds(getDoc(doc(brunoDb, 'customers', 'customer-multi-brand')));
  await assertSucceeds(getDoc(doc(joinLuxDb, 'customers', 'customer-multi-brand')));
  await assertFails(getDoc(doc(brunoDb, 'customers', 'customer-join-lux')));
  await assertFails(getDoc(doc(brunoDb, 'customers', 'customer-legacy')));
  await assertSucceeds(
    getDocs(
      query(
        collection(brunoDb, 'customers'),
        where('brandIds', 'array-contains', 'bruno-thailand')
      )
    )
  );
  await assertFails(getDocs(collection(brunoDb, 'customers')));
  await assertFails(
    updateDoc(doc(brunoDb, 'customers', 'customer-bruno'), {
      brandIds: ['join-lux-club'],
    })
  );
});

test('public Firestore reads remain denied', async () => {
  const db = unauthenticatedDb();
  await assertFails(getDoc(doc(db, 'serviceJobs', 'job-bruno')));
  await assertFails(getDoc(doc(db, 'customers', 'customer-bruno')));
  await assertFails(getDoc(doc(db, 'products', 'product-1')));
});

// F5d-66 / DECISIONS.md #040 — Service Report live persistence.

// D24/D25 close the former list ambiguity: ordinary history and Approval
// Console reads are Worker-mediated, so every browser list now fails closed.
test('every browser serviceReports list is denied after D24/D25 activation', async () => {
  const callers = [
    unauthenticatedDb(),
    staffDb('staff-no-role'),
    staffDb(brunoUid),
    staffDb('staff-approver'),
    staffDb('staff-admin'),
  ];

  for (const db of callers) {
    await assertFails(getDocs(collection(db, 'serviceReports')));
    await assertFails(
      getDocs(
        query(
          collection(db, 'serviceReports'),
          where('brandId', '==', 'bruno-thailand'),
          where('schemaVersion', '==', 2),
          where('approvalState', '==', 'pending'),
          limit(50)
        )
      )
    );
  }

  const approverDb = staffDb('staff-approver');
  const reports = collection(approverDb, 'serviceReports');
  await assertFails(
    getDocs(
      query(
        reports,
        where('brandId', '==', 'bruno-thailand'),
        where('schemaVersion', '==', 2),
        where('approvalState', '==', 'pending'),
        where('reportNo', '==', 'FR-2026-000001'),
        limit(50)
      )
    )
  );
  await assertFails(
    getDocs(
      query(
        reports,
        where('brandId', '==', 'bruno-thailand'),
        where('schemaVersion', '==', 2),
        where('approvalState', '==', 'pending'),
        where('snapshot.trackingReference', '==', 'job-bruno'),
        limit(50)
      )
    )
  );
  await assertFails(getDocs(query(reports, where('serviceJobId', '==', 'job-bruno'))));
  await assertFails(
    getDocs(query(reports, where('brandId', 'in', ['bruno-thailand', 'join-lux-club'])))
  );
  await assertFails(
    getDocs(
      query(
        reports,
        or(
          where('serviceJobId', '==', 'job-bruno'),
          where('reportNo', '==', 'FR-2026-000001')
        )
      )
    )
  );
  await assertFails(getDocs(query(reports, limit(51))));
});

test('authorized same-brand ServiceReport get and V2 draft edit succeed', async () => {
  const brunoDb = staffDb(brunoUid);
  await assertSucceeds(getDoc(doc(brunoDb, 'serviceReports', 'report-bruno-draft')));
  // Phase 3R/4R.3: a client draft edit is a V2 compare-and-set. A V1 report is
  // no longer directly client-editable — that path is now the Worker's
  // saveLegacyServiceReportDraft route — so the V1 shape must be denied here.
  await assertFails(
    updateDoc(doc(brunoDb, 'serviceReports', 'report-bruno-draft'), {
      technicianRemark: 'Updated remark',
      updatedAt: Timestamp.fromDate(new Date('2026-08-17T01:00:00.000Z')),
    })
  );
  await assertSucceeds(
    updateDoc(doc(brunoDb, 'serviceReports', 'report-bruno-v2-draft'), {
      technicianRemark: 'Updated remark',
      contentRevision: 4,
      updatedAt: serverTimestamp(),
    })
  );
});

test('a V2 draft edit must advance contentRevision by exactly one', async () => {
  const brunoDb = staffDb(brunoUid);
  for (const contentRevision of [3, 5, 2]) {
    await assertFails(
      updateDoc(doc(brunoDb, 'serviceReports', 'report-bruno-v2-draft'), {
        technicianRemark: 'Updated remark',
        contentRevision,
        updatedAt: serverTimestamp(),
      })
    );
  }
  await assertFails(
    updateDoc(doc(brunoDb, 'serviceReports', 'report-bruno-v2-draft'), {
      technicianRemark: 'Updated remark',
      updatedAt: serverTimestamp(),
    })
  );
});

test('a staff member without a Repair Report role cannot edit a V2 draft', async () => {
  const roCleDb = staffDb('staff-no-role');
  await assertFails(
    updateDoc(doc(roCleDb, 'serviceReports', 'report-bruno-v2-draft'), {
      technicianRemark: 'Updated remark',
      contentRevision: 4,
      updatedAt: serverTimestamp(),
    })
  );
});

test('cross-brand ServiceReport read and write are denied', async () => {
  const brunoDb = staffDb(brunoUid);
  await assertFails(getDoc(doc(brunoDb, 'serviceReports', 'report-join-lux-draft')));
  await assertFails(
    getDocs(
      query(collection(brunoDb, 'serviceReports'), where('serviceJobId', '==', 'job-join-lux'))
    )
  );
  await assertFails(
    updateDoc(doc(brunoDb, 'serviceReports', 'report-join-lux-draft'), {
      technicianRemark: 'Should be denied',
    })
  );
});

test('browser ServiceReport creation is denied', async () => {
  const brunoDb = staffDb(brunoUid);
  await assertFails(
    setDoc(doc(brunoDb, 'serviceReports', 'report-new'), serviceReport('job-bruno', 'draft'))
  );
});

test('browser cannot flip status/finalizedAt/snapshot or any identity field on a draft', async () => {
  const brunoDb = staffDb(brunoUid);
  await assertFails(
    updateDoc(doc(brunoDb, 'serviceReports', 'report-bruno-draft'), { status: 'final' })
  );
  await assertFails(
    updateDoc(doc(brunoDb, 'serviceReports', 'report-bruno-draft'), {
      finalizedAt: Timestamp.fromDate(new Date()),
    })
  );
  await assertFails(
    updateDoc(doc(brunoDb, 'serviceReports', 'report-bruno-draft'), {
      snapshot: { trackingReference: 'forged' },
    })
  );
  await assertFails(
    updateDoc(doc(brunoDb, 'serviceReports', 'report-bruno-draft'), {
      serviceJobId: 'job-join-lux',
    })
  );
  await assertFails(
    updateDoc(doc(brunoDb, 'serviceReports', 'report-bruno-draft'), {
      reportNo: 'FR-2026-999999',
    })
  );
  await assertFails(
    updateDoc(doc(brunoDb, 'serviceReports', 'report-bruno-draft'), {
      createdAt: '2020-01-01T00:00:00.000Z',
    })
  );
});

test('an unknown/new field can never become client-writable by omission (explicit allowlist, not a blacklist)', async () => {
  const brunoDb = staffDb(brunoUid);
  await assertFails(
    updateDoc(doc(brunoDb, 'serviceReports', 'report-bruno-draft'), {
      someBrandNewField: 'should never be allowed just because it is unrecognized',
    })
  );
});

test('a final ServiceReport is fully immutable to the browser, and deletion is always denied', async () => {
  const brunoDb = staffDb(brunoUid);
  await assertFails(
    updateDoc(doc(brunoDb, 'serviceReports', 'report-bruno-final'), {
      technicianRemark: 'Late edit attempt',
    })
  );
  await assertFails(
    updateDoc(doc(brunoDb, 'serviceReports', 'report-bruno-final'), { status: 'draft' })
  );
  await assertFails(deleteDoc(doc(brunoDb, 'serviceReports', 'report-bruno-draft')));
  await assertFails(deleteDoc(doc(brunoDb, 'serviceReports', 'report-bruno-final')));
});

test('the Worker-only ServiceReport allocator collections are fully denied to the browser', async () => {
  const brunoDb = staffDb(brunoUid);
  await assertFails(getDoc(doc(brunoDb, 'serviceReportActiveDrafts', 'job-bruno')));
  await assertFails(
    setDoc(doc(brunoDb, 'serviceReportActiveDrafts', 'job-bruno'), {
      draftReportId: 'report-bruno-draft',
    })
  );
  await assertFails(
    deleteDoc(doc(brunoDb, 'serviceReportActiveDrafts', 'job-bruno'))
  );
  await assertFails(getDoc(doc(brunoDb, 'serviceReportDraftKeys', 'some-key')));
  await assertFails(
    setDoc(doc(brunoDb, 'serviceReportDraftKeys', 'some-key'), {
      reportId: 'report-bruno-draft',
    })
  );
});

// PI-3 — the privileged Product Master import writes two Worker-only
// collections. Neither has (or needs) a match block in firestore.rules:
// Firestore's implicit default-deny already denies every operation on a
// collection no rule matches, and PI-3 adds no Rules change at all. This
// test pins that behavior so a future Rules edit cannot silently open them —
// it proves the denial, rather than proving the presence of a block.
test('the Worker-only Product Import collections are denied to the browser by default-deny', async () => {
  const brunoDb = staffDb(brunoUid);

  await assertFails(getDoc(doc(brunoDb, 'productImports', 'some-import-key')));
  await assertFails(
    setDoc(doc(brunoDb, 'productImports', 'some-import-key'), { status: 'completed' })
  );
  await assertFails(deleteDoc(doc(brunoDb, 'productImports', 'some-import-key')));

  await assertFails(getDoc(doc(brunoDb, 'productCatalogState', 'current')));
  await assertFails(setDoc(doc(brunoDb, 'productCatalogState', 'current'), { revision: 99 }));
  await assertFails(deleteDoc(doc(brunoDb, 'productCatalogState', 'current')));
});

// PI-3 — the import feature must not have loosened the catalog itself. The
// privileged Worker bypasses Rules via its service-account credential, so
// enabling import required no client-write grant whatsoever.
test('Product Import did not loosen the products collection — client writes stay denied', async () => {
  const brunoDb = staffDb(brunoUid);
  await assertSucceeds(getDoc(doc(brunoDb, 'products', 'product-1')));
  await assertFails(updateDoc(doc(brunoDb, 'products', 'product-1'), { brand: 'JLC' }));
  await assertFails(setDoc(doc(brunoDb, 'products', 'product-new'), { brand: 'BRN' }));
  await assertFails(deleteDoc(doc(brunoDb, 'products', 'product-1')));
});

test('browser access to numberSequences remains fully denied, including repair_report', async () => {
  const brunoDb = staffDb(brunoUid);
  await assertFails(
    getDoc(doc(brunoDb, 'numberSequences', 'bruno-thailand__repair_report__2026'))
  );
  await assertFails(
    setDoc(doc(brunoDb, 'numberSequences', 'bruno-thailand__repair_report__2026'), {
      currentValue: 1,
    })
  );
  // Re-proving the pre-existing tracking_number/service_request denial is
  // unchanged by this rollout, not just repair_report's new value.
  await assertFails(
    getDoc(doc(brunoDb, 'numberSequences', 'bruno-thailand__tracking_number__2026'))
  );
  await assertFails(
    getDoc(doc(brunoDb, 'numberSequences', 'bruno-thailand__service_request__2026'))
  );
});

// ---------------------------------------------------------------------------
// Phase 6R-A.1 — Rules coverage completion (Phase 4R.5 Finding 5)
// ---------------------------------------------------------------------------

// The complete frozen Worker-only matrix. Every one of these must be totally
// closed to any browser client, authenticated or not.
const TRUSTED_WORKER_COLLECTIONS = [
  'numberSequences',
  'serviceJobIntakeKeys',
  'serviceReportDraftKeys',
  'serviceReportActiveDrafts',
  'serviceReportApprovals',
  'brandApprovalPolicies',
  'serviceReportIdempotency',
  'serviceReportSuccessorClaims',
  'attachmentRetentionHolds',
  'attachmentDeletionClaims',
  'attachmentDeletionOperations',
];

test('every authoritative trusted collection denies browser reads and writes', async () => {
  const brunoDb = staffDb(brunoUid);
  const anonDb = unauthenticatedDb();
  for (const collection of TRUSTED_WORKER_COLLECTIONS) {
    await assertFails(getDoc(doc(brunoDb, collection, 'any-id')));
    await assertFails(setDoc(doc(brunoDb, collection, 'any-id'), { forged: true }));
    await assertFails(updateDoc(doc(brunoDb, collection, 'any-id'), { forged: true }));
    await assertFails(deleteDoc(doc(brunoDb, collection, 'any-id')));
    await assertFails(getDoc(doc(anonDb, collection, 'any-id')));
    await assertFails(setDoc(doc(anonDb, collection, 'any-id'), { forged: true }));
  }
});

test('same-brand direct GET is allowed for V1 and for every V2 lifecycle state', async () => {
  const brunoDb = staffDb(brunoUid);
  // V1 and the V2 draft are already seeded; add the three terminal V2 states.
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(
        doc(db, 'serviceReports', 'report-v2-pending'),
        serviceReportV2('job-bruno', 'bruno-thailand', {
          reportId: 'report-v2-pending',
          status: 'final',
          approvalState: 'pending',
        })
      ),
      setDoc(
        doc(db, 'serviceReports', 'report-v2-approved'),
        serviceReportV2('job-bruno', 'bruno-thailand', {
          reportId: 'report-v2-approved',
          status: 'final',
          approvalState: 'approved',
        })
      ),
      setDoc(
        doc(db, 'serviceReports', 'report-v2-rejected'),
        serviceReportV2('job-bruno', 'bruno-thailand', {
          reportId: 'report-v2-rejected',
          status: 'final',
          approvalState: 'rejected',
        })
      ),
    ]);
  });
  for (const reportId of [
    'report-bruno-draft',
    'report-bruno-final',
    'report-bruno-v2-draft',
    'report-v2-pending',
    'report-v2-approved',
    'report-v2-rejected',
  ]) {
    await assertSucceeds(getDoc(doc(brunoDb, 'serviceReports', reportId)));
  }
});

test('a report whose authoritative Service Job is missing or malformed is denied', async () => {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(
        doc(db, 'serviceReports', 'report-orphan'),
        serviceReportV2('job-does-not-exist', 'bruno-thailand', {
          reportId: 'report-orphan',
        })
      ),
      setDoc(doc(db, 'serviceJobs', 'job-no-brand'), { customerName: 'Legacy' }),
      setDoc(
        doc(db, 'serviceReports', 'report-malformed-owner'),
        serviceReportV2('job-no-brand', 'bruno-thailand', {
          reportId: 'report-malformed-owner',
        })
      ),
    ]);
  });
  const brunoDb = staffDb(brunoUid);
  // Ownership is resolved through the authoritative Service Job, never through
  // the report's own projected brandId, so neither of these can be read.
  await assertFails(getDoc(doc(brunoDb, 'serviceReports', 'report-orphan')));
  await assertFails(getDoc(doc(brunoDb, 'serviceReports', 'report-malformed-owner')));
});

test('anonymous direct ServiceReport GET is denied', async () => {
  const anonDb = unauthenticatedDb();
  for (const reportId of ['report-bruno-draft', 'report-bruno-v2-draft', 'report-bruno-final']) {
    await assertFails(getDoc(doc(anonDb, 'serviceReports', reportId)));
  }
});

test('Public Tracking clients get no credentialed Service Report or console access', async () => {
  // A public tracking visitor is unauthenticated: it holds a tracking code, not
  // a Firestore credential, so D24/D25 data is unreachable by construction.
  const anonDb = unauthenticatedDb();
  await assertFails(getDoc(doc(anonDb, 'serviceJobs', 'job-bruno')));
  await assertFails(getDoc(doc(anonDb, 'staffProfiles', brunoUid)));
  await assertFails(getDoc(doc(anonDb, 'serviceReports', 'report-bruno-v2-draft')));
  await assertFails(
    getDocs(query(collection(anonDb, 'serviceReports'), where('serviceJobId', '==', 'job-bruno')))
  );
  await assertFails(getDoc(doc(anonDb, 'products', 'product-1')));
});
