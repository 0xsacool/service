import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', server: { middlewareMode: true, hmr: false } });
after(() => vite.close());

const attachmentIdentity = await vite.ssrLoadModule('/src/services/attachmentIdentity.ts');
const reportContract = await vite.ssrLoadModule('/src/services/serviceReportV2.ts');
const paths = await vite.ssrLoadModule('/worker/src/paths.ts');
const evidenceOmission = await vite.ssrLoadModule('/src/services/evidenceOmission.ts');

const rulesSource = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

// Every collection the Worker writes with its own privileged credentials. The
// Worker's string literals are the authority; Rules must name the same ones,
// or a block silently guards a collection that does not exist.
const TRUSTED_COLLECTIONS = [
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

const keyA =
  'service-jobs/BRN-2026-000002/report/00000000-0000-4000-8000-000000000001-evidence-a.jpg';
const keyB =
  'service-jobs/BRN-2026-000002/report/00000000-0000-4000-8000-000000000002-evidence-b.jpg';

test('canonical attachment key validation is byte-exact and enforces the R2 boundary', () => {
  assert.equal(attachmentIdentity.isCanonicalAttachmentKey(keyA), true);
  assert.equal(attachmentIdentity.isCanonicalAttachmentKey(`${keyA}%2fescape`), false);
  assert.equal(attachmentIdentity.isCanonicalAttachmentKey(keyA.replace('evidence', 'หลักฐาน')), false);
  assert.equal(attachmentIdentity.isCanonicalAttachmentKey('service-jobs/BRN-2026-000002/report/.'), false);
  assert.equal(paths.sanitizeFileName(' หลักฐาน 01%.jpg '), '_01_.jpg');

  const prefix = 'service-jobs/a/report/';
  const atLimit = `${prefix}${'a'.repeat(1024 - new TextEncoder().encode(prefix).byteLength)}`;
  const overLimit = `${atLimit}a`;
  assert.equal(attachmentIdentity.canonicalAttachmentKeyByteLength(atLimit), 1024);
  assert.equal(attachmentIdentity.isCanonicalAttachmentKey(atLimit), true);
  assert.equal(attachmentIdentity.isCanonicalAttachmentKey(overLimit), false);
});

test('legacy slash encoding has a real accepted-grammar collision', () => {
  const first = 'service-jobs/a__before/report/x';
  const second = 'service-jobs/a/before/report__x';
  assert.equal(attachmentIdentity.isCanonicalAttachmentKey(first), true);
  assert.equal(attachmentIdentity.isCanonicalAttachmentKey(second), true);
  assert.notEqual(first, second);
  assert.equal(
    attachmentIdentity.legacyAttachmentMetadataDocId(first),
    attachmentIdentity.legacyAttachmentMetadataDocId(second)
  );
});

test('metadata, deletion-claim, and retention-hold framing matches frozen vectors', async () => {
  assert.equal(
    await attachmentIdentity.attachmentMetadataDocId(keyA),
    'ak2_fe77b469144106e0b58ac4eda2971760b150b6ff26ea710700fd5effe9801e6c'
  );
  assert.equal(
    await attachmentIdentity.attachmentDeletionClaimDocId(keyA),
    'dc1_a4c619543b2ab9d93d5e317fa153bf3e0d45e2c2532431556b6e12adca9f20aa'
  );
  assert.equal(
    await attachmentIdentity.attachmentRetentionHoldDocId('r-2', keyA),
    'ah1_e67e144461c6b6327ca276f6265686a1c39aa431f6813ecf6b64cc3608663615'
  );
});

function finalReport(evidenceAttachmentIds) {
  return {
    schemaVersion: 2,
    reportId: 'r-2',
    id: 'r-2',
    serviceJobId: 'BRN-2026-000002',
    reportNo: 'FR-2026-000002',
    brandId: 'bruno-thailand',
    status: 'final',
    activeDraftGeneration: 1,
    createdAt: '2026-08-21T02:03:04.005Z',
    createdByUid: 'u-2',
    createdByRoleSnapshot: 'technician',
    createdByDisplayNameSnapshot: 'ช่าง ก',
    contentRevision: 7,
    updatedAt: '2026-08-21T03:04:05.006Z',
    predecessorReportId: null,
    technician: 'ช่าง ก',
    customerReportedProblem: 'เปิดไม่ติด',
    inspectionFindings: 'ฟิวส์ขาด\nตรวจพบความร้อนสูง',
    serviceActions: ['repair', 'replace-part'],
    parts: [
      { description: 'ฟิวส์', partNo: 'F-01', quantity: 1, remark: 'เปลี่ยนใหม่' },
      { description: 'สายไฟ', partNo: null, quantity: 2, remark: 'ตรวจสอบแล้ว' },
    ],
    technicianRemark: 'Café\nทดสอบแล้ว',
    resultStatus: 'repaired',
    resultDetail: 'ส่งคืนได้',
    evidenceAttachmentIds,
    claimNo: null,
    factoryReference: 'โรงงาน-๑',
    warrantyOutcome: 'covered',
    snapshot: {
      trackingReference: 'BRN-2026-000002',
      customerName: 'อารยา',
      customerPhone: '0812345678',
      customerEmail: '',
      brandCode: 'BRN',
      brandName: 'Bruno Thailand',
      productName: 'เครื่องปิ้งขนมปัง',
      modelOrSku: null,
      serialNumber: 'S-๒',
      customerReportedProblem: 'เครื่องไม่ทำงาน',
    },
    finalizedAt: '2026-08-21T03:04:05.006Z',
    finalizedByUid: 'u-2',
    finalizedByRoleSnapshot: 'technician',
    finalizedByDisplayNameSnapshot: 'ช่าง ก',
    finalizedFromRevision: 7,
    finalContentDigest: `sha256:v1:${'0'.repeat(64)}`,
    approvalState: 'pending',
    currentApprovalEventId: null,
    approvalDecidedAt: null,
  };
}

test('corrected digest vectors bind canonical raw evidence keys and preserve order', async () => {
  const reportB = finalReport([keyA, keyB]);
  const reportC = finalReport([keyB, keyA]);
  assert.equal(reportContract.serializeServiceReportFinalDigest(reportB).byteLength, 1738);
  assert.equal(
    await reportContract.computeServiceReportFinalDigest(reportB),
    'sha256:v1:f1752e0deb08e828e4a3d156383ff3744ccf0d158936f17c9205fec989dc3b63'
  );
  assert.equal(reportContract.serializeServiceReportFinalDigest(reportC).byteLength, 1738);
  assert.equal(
    await reportContract.computeServiceReportFinalDigest(reportC),
    'sha256:v1:d82f3eca2d9726c85412c33530be652aab1420c86d9207961e5e40155197e684'
  );
});

test('content normalization rejects duplicates, unknown fields, and invalid evidence aliases', () => {
  const content = {
    technician: ' ช่าง ก ',
    customerReportedProblem: 'เปิดไม่ติด',
    inspectionFindings: 'ตรวจแล้ว',
    serviceActions: ['replace-part', 'repair'],
    parts: [],
    technicianRemark: '',
    resultStatus: 'repaired',
    resultDetail: '',
    evidenceAttachmentIds: [keyA],
    claimNo: null,
    factoryReference: null,
    warrantyOutcome: 'covered',
  };
  const normalized = reportContract.normalizeServiceReportV2Content(content);
  assert.deepEqual(normalized.serviceActions, ['repair', 'replace-part']);
  assert.equal(normalized.technician, 'ช่าง ก');
  assert.equal(
    reportContract.normalizeServiceReportV2Content({ ...content, evidenceAttachmentIds: [keyA, keyA] }),
    null
  );
  assert.equal(
    reportContract.normalizeServiceReportV2Content({ ...content, unexpected: true }),
    null
  );
  assert.equal(
    reportContract.normalizeServiceReportV2Content({ ...content, evidenceAttachmentIds: ['ak2_deadbeef'] }),
    null
  );
});

test('firestore.rules names every authoritative Worker-only collection', () => {
  for (const collection of TRUSTED_COLLECTIONS) {
    assert.ok(
      new RegExp(`match /${collection}/\{`).test(rulesSource),
      `firestore.rules is missing a match block for ${collection}`
    );
  }
});

test('firestore.rules carries no stale pre-4R.3 collection names', () => {
  assert.equal(rulesSource.includes('serviceReportApprovalEvents'), false);
  assert.equal(rulesSource.includes('serviceReportSuccessors/'), false);
  assert.equal(/match \/serviceReportSuccessors\b/.test(rulesSource), false);
});

test('every trusted collection denies all client access', () => {
  // Each trusted block is the text from its own `match /` up to the next
  // `match /`, so an `allow` belonging to a later collection can never be
  // mistaken for this one's.
  const blocks = rulesSource.split('match /').slice(1);
  for (const collection of TRUSTED_COLLECTIONS) {
    const block = blocks.find((candidate) => candidate.startsWith(`${collection}/`));
    assert.ok(block, `${collection} has no match block`);
    const allows = block.match(/allow [^;]*;/g) ?? [];
    assert.deepEqual(
      allows,
      ['allow read, write: if false;'],
      `${collection} must deny all client reads and writes with exactly one rule`
    );
  }
});

test('canonical omission ordering is byte-based and set-valued', () => {
  const { canonicalizeEvidenceKeys, compareCanonicalAttachmentKeys, evidenceKeySetsEqual } =
    evidenceOmission;
  assert.deepEqual(canonicalizeEvidenceKeys([keyB, keyA]), [keyA, keyB]);
  assert.deepEqual(canonicalizeEvidenceKeys([keyA, keyB]), [keyA, keyB]);
  assert.ok(compareCanonicalAttachmentKeys('Z', 'a') < 0);
  assert.ok('Z'.localeCompare('a') > 0);
  assert.equal(evidenceKeySetsEqual([keyA, keyB], [keyB, keyA]), true);
  assert.equal(evidenceKeySetsEqual([keyA], [keyA, keyB]), false);

  const source = readFileSync(
    new URL('../src/services/evidenceOmission.ts', import.meta.url),
    'utf8'
  );
  assert.equal(source.includes('.localeCompare('), false);

  const input = [keyB, keyA];
  canonicalizeEvidenceKeys(input);
  assert.deepEqual(input, [keyB, keyA], 'canonicalization must not mutate its argument');
});

test('the omission parser rejects duplicates and over-cap sets without deduplicating', () => {
  const { parseConfirmedOmissionSet, MAX_EVIDENCE_ATTACHMENTS } = evidenceOmission;
  assert.equal(parseConfirmedOmissionSet([keyA, keyA]).reason, 'duplicate-key');
  assert.equal(parseConfirmedOmissionSet('nope').reason, 'not-an-array');
  assert.equal(parseConfirmedOmissionSet(['ak2_deadbeef']).reason, 'invalid-key');
  assert.equal(
    parseConfirmedOmissionSet(new Array(MAX_EVIDENCE_ATTACHMENTS + 1).fill(keyA)).reason,
    'too-many'
  );
  assert.deepEqual(parseConfirmedOmissionSet([keyB, keyA]).keys, [keyA, keyB]);
  assert.equal(MAX_EVIDENCE_ATTACHMENTS, 50);
});

test('a metadata document id is never accepted where a raw evidence key is required', async () => {
  const metadataId = await attachmentIdentity.attachmentMetadataDocId(keyA);
  assert.ok(metadataId.startsWith('ak2_'));
  assert.equal(attachmentIdentity.isCanonicalAttachmentKey(metadataId), false);
  assert.equal(evidenceOmission.parseConfirmedOmissionSet([metadataId]).reason, 'invalid-key');
  assert.equal(metadataId.includes('/'), false, 'a document id must never contain a path separator');
});

test('derived identities are addressable while the raw key stays the evidence identity', async () => {
  assert.ok(keyA.includes('/'));
  const metadataId = await attachmentIdentity.attachmentMetadataDocId(keyA);
  const claimId = await attachmentIdentity.attachmentDeletionClaimDocId(keyA);
  const holdId = await attachmentIdentity.attachmentRetentionHoldDocId('event-1', keyA);
  for (const [label, id] of [['ak2_', metadataId], ['dc1_', claimId], ['ah1_', holdId]]) {
    assert.ok(id.startsWith(label), `${id} must carry the ${label} prefix`);
    assert.equal(id.includes('/'), false);
  }
  assert.equal(await attachmentIdentity.verifyAttachmentMetadataAddress(metadataId, keyA), true);
  assert.equal(await attachmentIdentity.verifyAttachmentMetadataAddress(metadataId, keyB), false);
  assert.equal(
    await attachmentIdentity.verifyAttachmentDeletionClaimAddress(claimId, keyA),
    true
  );
  assert.equal(
    await attachmentIdentity.verifyAttachmentDeletionClaimAddress(claimId, keyB),
    false
  );
});
