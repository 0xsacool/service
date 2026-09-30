import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  EVIDENCE_ARCHIVE_MAX_UPLOAD_BYTES,
  EVIDENCE_ARCHIVE_SKIP_COMPRESSION_BYTES,
  evidenceArchiveDeleteAfter,
  parseEvidenceArchiveSessionRequest,
} from '../src/services/evidenceArchive.ts';
import { uploadPreparedEvidenceArchiveFile } from '../src/services/evidenceArchiveUpload.ts';

test('session parser accepts bounded archive metadata and rejects oversized prepared files', () => {
  const valid = parseEvidenceArchiveSessionRequest({
    version: 1,
    fileName: 'claim.mp4',
    mimeType: 'video/mp4',
    sizeBytes: 42 * 1024 * 1024,
    sourceSizeBytes: 240 * 1024 * 1024,
    compressed: true,
  });
  assert.equal(valid?.fileName, 'claim.mp4');
  assert.equal(valid?.compressed, true);

  assert.equal(
    parseEvidenceArchiveSessionRequest({
      version: 1,
      fileName: 'claim.mp4',
      mimeType: 'video/mp4',
      sizeBytes: EVIDENCE_ARCHIVE_MAX_UPLOAD_BYTES + 1,
      sourceSizeBytes: EVIDENCE_ARCHIVE_MAX_UPLOAD_BYTES + 1,
      compressed: false,
    }),
    null
  );
});

test('archive retention is one year expressed as a deterministic 365-day timestamp', () => {
  assert.equal(
    evidenceArchiveDeleteAfter(new Date('2026-09-30T05:00:00.000Z')),
    '2027-09-30T05:00:00.000Z'
  );
});

test('compression source is WebCodecs/Mediabunny-first, bounded, and skips video at or below 50 MiB', async () => {
  const source = await readFile(
    new URL('../src/services/evidenceArchiveCompression.ts', import.meta.url),
    'utf8'
  );

  assert.match(source, /file\.size <= EVIDENCE_ARCHIVE_SKIP_COMPRESSION_BYTES/);
  assert.match(source, /await import\('mediabunny'\)/);
  assert.match(source, /canEncodeVideo\('avc'\)/);
  assert.match(source, /canEncodeAudio\('aac'\)/);
  assert.match(source, /new media\.Mp4OutputFormat/);
  assert.match(source, /height: targetHeight/);
  assert.match(source, /EVIDENCE_ARCHIVE_TARGET_BYTES/);
  assert.match(source, /blob\.size > EVIDENCE_ARCHIVE_MAX_UPLOAD_BYTES/);
  assert.match(source, /รองรับเฉพาะวิดีโอ รูปภาพ และ PDF/);
});

test('prepared bytes upload directly to the Drive resumable URL, not through Worker', async () => {
  let sessionRequest = null;
  let opened = null;
  let sentBlob = null;
  const headers = new Map();

  const repository = {
    async createUploadSession(jobId, request) {
      assert.equal(jobId, 'BRN-2026-000001');
      sessionRequest = request;
      return {
        archiveId: 'archive-1',
        uploadUrl: 'https://drive-upload.test/session-1',
        expiresAt: '2026-10-06T05:00:00.000Z',
      };
    },
  };

  const xhr = {
    upload: {},
    status: 0,
    open(method, url, async) {
      opened = { method, url, async };
    },
    setRequestHeader(name, value) {
      headers.set(name, value);
    },
    send(blob) {
      sentBlob = blob;
      this.upload.onprogress?.({
        lengthComputable: true,
        loaded: blob.size,
        total: blob.size,
      });
      this.status = 200;
      this.onload?.();
    },
  };

  const blob = new Blob(['drive-bytes'], { type: 'video/mp4' });
  const progress = [];
  const archiveId = await uploadPreparedEvidenceArchiveFile({
    jobId: 'BRN-2026-000001',
    file: {
      blob,
      name: 'claim.mp4',
      mimeType: 'video/mp4',
      sourceSizeBytes: 100,
      preparedSizeBytes: blob.size,
      compressed: true,
      durationSeconds: 10,
    },
    repository,
    onProgress: (value) => progress.push(value),
    xhrFactory: () => xhr,
  });

  assert.equal(archiveId, 'archive-1');
  assert.deepEqual(opened, {
    method: 'PUT',
    url: 'https://drive-upload.test/session-1',
    async: true,
  });
  assert.equal(headers.get('Content-Type'), 'video/mp4');
  assert.equal(sentBlob, blob);
  assert.equal(sessionRequest?.sizeBytes, blob.size);
  assert.equal(progress.at(-1)?.ratio, 1);
});

test('Service Job UI exposes Drive archive after a durable job exists while legacy URL remains', async () => {
  const [newJob, details, section, legacy] = await Promise.all([
    readFile(
      new URL('../src/features/service-jobs/pages/NewServiceJob.tsx', import.meta.url),
      'utf8'
    ),
    readFile(
      new URL(
        '../src/features/service-jobs/pages/ServiceJobDetails.tsx',
        import.meta.url
      ),
      'utf8'
    ),
    readFile(
      new URL(
        '../src/features/service-jobs/components/EvidenceArchiveSection.tsx',
        import.meta.url
      ),
      'utf8'
    ),
    readFile(
      new URL(
        '../src/features/service-jobs/components/ExternalEvidenceSection.tsx',
        import.meta.url
      ),
      'utf8'
    ),
  ]);

  assert.match(newJob, /<EvidenceArchiveSection jobId=\{savedJob\.id\}/);
  assert.match(details, /<EvidenceArchiveSection jobId=\{claim\.id\}/);
  assert.match(section, /คลังหลักฐาน Google Drive/);
  assert.match(section, /วิดีโอเกิน 50 MB จะบีบอัดบนเครื่องก่อนอัปโหลด/);
  assert.match(section, /เก็บถึง/);
  assert.match(section, /ดาวน์โหลด/);
  assert.match(legacy, /ลิงก์หลักฐานเพิ่มเติม/);
});

test('OAuth production support pages are public Service Tech routes', async () => {
  const [app, routes, about, privacy, terms] = await Promise.all([
    readFile(new URL('../src/app/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/constants/routes.ts', import.meta.url), 'utf8'),
    readFile(
      new URL('../src/features/legal/pages/EvidenceArchiveAbout.tsx', import.meta.url),
      'utf8'
    ),
    readFile(
      new URL('../src/features/legal/pages/PrivacyPolicy.tsx', import.meta.url),
      'utf8'
    ),
    readFile(
      new URL('../src/features/legal/pages/TermsOfService.tsx', import.meta.url),
      'utf8'
    ),
  ]);

  assert.match(routes, /about: '\/about'/);
  assert.match(routes, /privacy: '\/privacy'/);
  assert.match(routes, /terms: '\/terms'/);
  assert.match(app, /ROUTE_PATTERNS\.about/);
  assert.match(app, /ROUTE_PATTERNS\.privacy/);
  assert.match(about, /Service Tech Evidence Archive/);
  assert.match(about, /Google Drive/);
  assert.match(app, /ROUTE_PATTERNS\.terms/);
  assert.match(privacy, /Google Drive Evidence Archive/);
  assert.match(privacy, /365 วัน/);
  assert.match(terms, /Google Drive/);
  assert.match(terms, /ประมาณ 365 วัน/);
});
