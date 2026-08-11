import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', server: { middlewareMode: true } });
after(() => vite.close());

const {
  computeAttachmentRetention,
  EXPIRING_SOON_WINDOW_DAYS,
  RETENTION_PERIOD_DAYS,
  resolveParentAttachmentRetention,
} = await vite.ssrLoadModule('/src/services/attachmentRetention.ts');
const { deleteAttachmentWithRetainedMetadata } = await vite.ssrLoadModule(
  '/src/services/attachmentDeletion.ts'
);
const { attachmentsRepository, getMockAttachmentsForJobIncludingDeleted } =
  await vite.ssrLoadModule('/src/repositories/attachmentsRepository.ts');
const { serviceJobsRepository } = await vite.ssrLoadModule(
  '/src/repositories/serviceJobsRepository.ts'
);

const openParent = { id: 'BRN-2026-OPEN', closedAt: null };
const closedAt = '2025-01-01T00:00:00.000Z';
const closedParent = { id: 'BRN-2026-CLOSED', closedAt };
const expectedDeleteAfter = '2026-01-01T00:00:00.000Z';

function attachmentFixture(id = 'service-jobs/BRN-2026-000001/documents/test.pdf') {
  return {
    id,
    jobId: 'BRN-2026-000001',
    category: 'documents',
    name: 'test.pdf',
    path: id,
    contentType: 'application/pdf',
    size: 1,
    uploadedAt: '2026-01-01T00:00:00.000Z',
    uploadedBy: 'qa',
    deleteAfter: null,
    retentionStatus: 'active',
    retentionExtensions: [],
    deletedAt: null,
  };
}

test('an open parent creates an active attachment with no deletion deadline', () => {
  assert.deepEqual(
    resolveParentAttachmentRetention(openParent, new Date('2025-01-01T00:00:00.000Z')),
    { deleteAfter: null, retentionStatus: 'active' }
  );
});

test('a closed parent derives the exact 365-day deadline and status', () => {
  const retention = resolveParentAttachmentRetention(
    closedParent,
    new Date('2025-01-01T00:00:00.000Z')
  );

  assert.equal(RETENTION_PERIOD_DAYS, 365);
  assert.equal(retention.deleteAfter, expectedDeleteAfter);
  assert.equal(retention.retentionStatus, 'active');
  assert.equal(
    computeAttachmentRetention(closedAt, new Date('2025-12-02T00:00:00.000Z'))
      .retentionStatus,
    'expiring-soon'
  );
  assert.equal(EXPIRING_SOON_WINDOW_DAYS, 30);
});

test('missing, malformed, and historical terminal closure anchors fail safe', () => {
  assert.deepEqual(
    resolveParentAttachmentRetention({ id: 'historical-terminal', closedAt: null }),
    { deleteAfter: null, retentionStatus: 'active' }
  );
  assert.deepEqual(computeAttachmentRetention('not-a-date'), {
    deleteAfter: null,
    retentionStatus: 'active',
  });
});

test('retention uses only parent closedAt, never uploadedAt', () => {
  const retention = resolveParentAttachmentRetention(
    closedParent,
    new Date('2025-02-01T00:00:00.000Z')
  );

  assert.equal(retention.deleteAfter, expectedDeleteAfter);
});

test('manual deletion retains metadata after a successful R2 delete', async () => {
  const attachment = attachmentFixture();
  let deleted = false;
  let deletedAt = null;
  const metadata = {
    getById: () => attachment,
    markDeleted: async (_id, value) => {
      deletedAt = value;
    },
  };

  await deleteAttachmentWithRetainedMetadata(
    attachment.id,
    metadata,
    async () => {
      deleted = true;
    },
    new Date('2026-08-09T00:00:00.000Z')
  );

  assert.equal(deleted, true);
  assert.equal(deletedAt, '2026-08-09T00:00:00.000Z');
});

test('a successful idempotent R2 delete self-heals metadata when the object is absent', async () => {
  const attachment = attachmentFixture(
    'service-jobs/BRN-2026-000001/documents/absent.pdf'
  );
  let deletedAt = null;
  const metadata = {
    getById: () => attachment,
    markDeleted: async (_id, value) => {
      deletedAt = value;
    },
  };

  await deleteAttachmentWithRetainedMetadata(
    attachment.id,
    metadata,
    async () => {},
    new Date('2026-08-09T01:00:00.000Z')
  );

  assert.equal(deletedAt, '2026-08-09T01:00:00.000Z');
});

test('an R2 failure never writes deletedAt', async () => {
  const attachment = attachmentFixture(
    'service-jobs/BRN-2026-000001/documents/failure.pdf'
  );
  let marked = false;
  const metadata = {
    getById: () => attachment,
    markDeleted: async () => {
      marked = true;
    },
  };

  await assert.rejects(
    () =>
      deleteAttachmentWithRetainedMetadata(attachment.id, metadata, async () => {
        throw new Error('R2 unavailable');
      }),
    /R2 unavailable/
  );

  assert.equal(marked, false);
});

test('a metadata mark failure propagates after the R2 operation', async () => {
  const attachment = attachmentFixture(
    'service-jobs/BRN-2026-000001/documents/metadata.pdf'
  );
  const metadata = {
    getById: () => attachment,
    markDeleted: async () => {
      throw new Error('Firestore unavailable');
    },
  };

  await assert.rejects(
    () => deleteAttachmentWithRetainedMetadata(attachment.id, metadata, async () => {}),
    /Firestore unavailable/
  );
});

test('Mock attachment reads hide deleted records while the internal audit path retains them', async () => {
  const parent = serviceJobsRepository.getAll().find((job) => job.closedAt !== null);
  assert.ok(parent);
  const attachment = await attachmentsRepository.upload({
    jobId: parent.id,
    category: 'documents',
    file: new Blob(['qa'], { type: 'application/pdf' }),
    fileName: 'qa.pdf',
    contentType: 'application/pdf',
    uploadedBy: 'qa',
  });

  assert.equal(
    attachmentsRepository.getForJob(parent.id).some((item) => item.id === attachment.id),
    true
  );
  await attachmentsRepository.deleteAttachment(attachment.id);

  assert.equal(
    attachmentsRepository.getForJob(parent.id).some((item) => item.id === attachment.id),
    false
  );
  assert.equal(
    getMockAttachmentsForJobIncludingDeleted(parent.id).find(
      (item) => item.id === attachment.id
    )?.deletedAt !== null,
    true
  );
});

test('Mock upload rejects a missing parent before storing an attachment', async () => {
  await assert.rejects(
    () =>
      attachmentsRepository.upload({
        jobId: 'BRN-2026-MISSING',
        category: 'documents',
        file: new Blob(['qa'], { type: 'application/pdf' }),
        fileName: 'missing.pdf',
        contentType: 'application/pdf',
        uploadedBy: 'qa',
      }),
    /parent Service Job does not exist/
  );
});
