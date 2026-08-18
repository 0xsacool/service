import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
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
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

const projectId = 'f5d26-rules';
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8085').split(':');
const testEnvironment = await initializeTestEnvironment({
  projectId,
  firestore: { host, port: Number(port), rules },
});

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
      setDoc(doc(db, 'staffProfiles', brunoUid), { brandId: 'bruno-thailand' }),
      setDoc(doc(db, 'staffProfiles', joinLuxUid), { brandId: 'join-lux-club' }),
      setDoc(doc(db, 'staffProfiles', 'staff-malformed'), { brandId: 'BRN' }),
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
    ]);
  });
}

beforeEach(async () => {
  await testEnvironment.clearFirestore();
  await seed();
});

after(async () => {
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

test('authorized same-brand ServiceReport get, list query, and draft edit succeed', async () => {
  const brunoDb = staffDb(brunoUid);
  await assertSucceeds(getDoc(doc(brunoDb, 'serviceReports', 'report-bruno-draft')));
  await assertSucceeds(
    getDocs(
      query(collection(brunoDb, 'serviceReports'), where('serviceJobId', '==', 'job-bruno'))
    )
  );
  await assertSucceeds(
    updateDoc(doc(brunoDb, 'serviceReports', 'report-bruno-draft'), {
      technicianRemark: 'Updated remark',
      updatedAt: Timestamp.fromDate(new Date('2026-08-17T01:00:00.000Z')),
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
