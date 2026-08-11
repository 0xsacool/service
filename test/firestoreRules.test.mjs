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
