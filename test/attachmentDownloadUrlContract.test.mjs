import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

// Phase 6R-B.3 (Phase 4R.6R finding R6R-SF2) — the AttachmentsRepository
// contract for getDownloadUrl() used to be a bare `Promise<string>` whose
// comment claimed the call was synchronous and that the Worker-backed
// implementation returned a directly-constructed provider string. Neither was
// true, and nothing anywhere stated the thing the callers actually depend on:
// the returned URL is a caller-owned disposable object URL that the caller must
// revoke. src/repositories/types.ts now states that contract; this suite proves
// every concrete implementation obeys it, so the correction is not just a
// comment.
//
// Both real implementations run here, unmodified. Only two things are doubled:
// the Firestore metadata store (aliased by repositoryRuntimeServer.mjs —
// bookkeeping that plays no part in this contract) and global fetch/URL, which
// Node does not provide with browser semantics. Everything the contract is
// about — where the bytes come from, what is handed back, who owns it — is the
// production code path.

// Worker mode is selected for THIS test process only. node --test runs each
// test file in its own child process, so nothing else's backend mode is
// affected.
process.env.VITE_FILES_BACKEND = 'worker';
process.env.VITE_FILES_WORKER_URL = 'https://files-worker.test.invalid';

const WORKER_BASE_URL = 'https://files-worker.test.invalid';
const MOCK_JOB_ID = 'SRV-2026-0481';
const WORKER_JOB_ID = 'SRV-2026-0479';
const ID_TOKEN = 'test-id-token';

// --- browser globals the repositories legitimately expect ------------------

const created = [];
const revoked = [];
let objectUrlSequence = 0;

const originalCreateObjectURL = globalThis.URL.createObjectURL;
const originalRevokeObjectURL = globalThis.URL.revokeObjectURL;
const originalFetch = globalThis.fetch;

const fetchCalls = [];
let nextFetchResponse = null;

// Installed BEFORE any module loads: workerTokenProvider.ts binds
// globalThis.fetch at import time (F5d-55), so a later swap would not be seen.
globalThis.URL.createObjectURL = (blob) => {
  objectUrlSequence += 1;
  const url = `blob:test-object-url/${objectUrlSequence}`;
  created.push({ url, blob });
  return url;
};
globalThis.URL.revokeObjectURL = (url) => {
  revoked.push(url);
};
globalThis.fetch = async (input, init) => {
  fetchCalls.push({ url: String(input), init });
  if (nextFetchResponse === null) throw new Error('no stubbed response queued');
  const response = nextFetchResponse;
  nextFetchResponse = null;
  return response;
};

after(() => {
  globalThis.URL.createObjectURL = originalCreateObjectURL;
  globalThis.URL.revokeObjectURL = originalRevokeObjectURL;
  globalThis.fetch = originalFetch;
});

const { createRepositoryRuntimeServer } = await import('./support/repositoryRuntimeServer.mjs');
const vite = await createRepositoryRuntimeServer('attachment-contract');
after(() => vite.close());

const { attachmentsRepository } = await vite.ssrLoadModule(
  '/src/repositories/attachmentsRepository.ts'
);
const { createWorkerAttachmentsRepository } = await vite.ssrLoadModule(
  '/src/repositories/workerAttachmentsRepository.ts'
);

const tokenProvider = { async getIdToken() { return ID_TOKEN; } };
const serviceJobsStub = { getById: (id) => ({ id, closedAt: null }) };

let workerRepository;
before(async () => {
  workerRepository = await createWorkerAttachmentsRepository(serviceJobsStub, tokenProvider);
});

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    async json() { return body; },
  };
}

function blobResponse(blob) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    async blob() { return blob; },
  };
}

function authorizationOf(call) {
  return call.init?.headers?.Authorization ?? null;
}

// --- Mock implementation ---------------------------------------------------

test('mock: getDownloadUrl resolves the stored Blob into an object URL created via URL.createObjectURL', async () => {
  const bytes = new Blob(['mock evidence bytes'], { type: 'image/jpeg' });
  const attachment = await attachmentsRepository.upload({
    jobId: MOCK_JOB_ID,
    category: 'before',
    file: bytes,
    fileName: 'evidence.jpg',
    contentType: 'image/jpeg',
    uploadedBy: 'tester',
  });

  const before = created.length;
  const url = await attachmentsRepository.getDownloadUrl(attachment.id);

  assert.equal(created.length, before + 1, 'exactly one object URL was created');
  const record = created[created.length - 1];
  assert.equal(url, record.url, 'the returned string IS the created object URL');
  assert.equal(record.blob, bytes, 'it was created from the Blob the repository holds');
  assert.match(url, /^blob:/, 'callers receive a disposable object URL, not a location');
});

test('mock: the returned URL is never the raw R2 key, path, or any provider URL', async () => {
  const attachment = await attachmentsRepository.upload({
    jobId: MOCK_JOB_ID,
    category: 'after',
    file: new Blob(['x'], { type: 'image/png' }),
    fileName: 'after.png',
    contentType: 'image/png',
    uploadedBy: 'tester',
  });
  const url = await attachmentsRepository.getDownloadUrl(attachment.id);

  assert.notEqual(url, attachment.id);
  assert.notEqual(url, attachment.path);
  assert.ok(!url.includes(attachment.path), 'the R2 key is not embedded in the URL');
  assert.ok(!url.includes('service-jobs/'), 'no key-shaped path escapes');
  assert.ok(!url.startsWith('http:') && !url.startsWith('https:'), 'no provider/public URL');
});

test('mock: every call mints a fresh caller-owned URL — the repository retains and revokes nothing', async () => {
  const attachment = await attachmentsRepository.upload({
    jobId: MOCK_JOB_ID,
    category: 'before',
    file: new Blob(['y'], { type: 'image/png' }),
    fileName: 'twice.png',
    contentType: 'image/png',
    uploadedBy: 'tester',
  });

  const revokedBefore = revoked.length;
  const first = await attachmentsRepository.getDownloadUrl(attachment.id);
  const second = await attachmentsRepository.getDownloadUrl(attachment.id);

  assert.notEqual(first, second, 'ownership is per call, not shared');
  assert.equal(revoked.length, revokedBefore, 'the repository revokes nothing itself');

  // The obligation the contract places on the caller is dischargeable.
  URL.revokeObjectURL(first);
  URL.revokeObjectURL(second);
  assert.deepEqual(revoked.slice(revokedBefore), [first, second]);
});

// --- Worker-backed implementation ------------------------------------------

async function uploadThroughWorker(fileName, category = 'before') {
  const path = `service-jobs/${WORKER_JOB_ID}/${category}/${fileName}`;
  nextFetchResponse = jsonResponse({
    path,
    contentType: 'image/jpeg',
    size: 3,
    uploadedAt: '2026-02-01T00:00:00.000Z',
  });
  return await workerRepository.upload({
    jobId: WORKER_JOB_ID,
    category,
    file: new Blob(['abc'], { type: 'image/jpeg' }),
    fileName,
    contentType: 'image/jpeg',
    uploadedBy: 'tester',
  });
}

test('worker: getDownloadUrl fetches the bytes over the authenticated Worker transport, never a bare provider URL', async () => {
  const attachment = await uploadThroughWorker('worker-evidence.jpg');
  const bytes = new Blob(['worker evidence bytes'], { type: 'image/jpeg' });
  nextFetchResponse = blobResponse(bytes);

  const callsBefore = fetchCalls.length;
  const created0 = created.length;
  const url = await workerRepository.getDownloadUrl(attachment.id);

  assert.equal(fetchCalls.length, callsBefore + 1, 'a real round-trip happened');
  const call = fetchCalls[fetchCalls.length - 1];
  assert.equal(call.url, `${WORKER_BASE_URL}/files/${attachment.id}`);
  assert.equal(call.init.method, 'GET');
  assert.equal(
    authorizationOf(call),
    `Bearer ${ID_TOKEN}`,
    'the bytes are obtained with the Worker token, so nothing here is publicly reachable'
  );

  assert.equal(created.length, created0 + 1, 'exactly one object URL was created');
  const record = created[created.length - 1];
  assert.equal(url, record.url, 'the returned string IS the created object URL');
  assert.equal(record.blob, bytes, 'it was created from the authenticated response Blob');
  assert.match(url, /^blob:/);
});

test('worker: the returned URL is never the R2 key or the Worker/provider URL the bytes came from', async () => {
  const attachment = await uploadThroughWorker('worker-privacy.jpg', 'after');
  nextFetchResponse = blobResponse(new Blob(['z'], { type: 'image/jpeg' }));
  const url = await workerRepository.getDownloadUrl(attachment.id);

  assert.notEqual(url, attachment.id);
  assert.notEqual(url, `${WORKER_BASE_URL}/files/${attachment.id}`);
  assert.ok(!url.includes(attachment.id), 'the R2 key is not embedded in the URL');
  assert.ok(!url.includes(WORKER_BASE_URL), 'the Worker origin is not embedded in the URL');
  assert.ok(!url.includes('service-jobs/'), 'no key-shaped path escapes');
  assert.ok(!url.startsWith('http:') && !url.startsWith('https:'), 'no signed/public URL');
});

test('worker: every call mints a fresh caller-owned URL — the repository retains and revokes nothing', async () => {
  const attachment = await uploadThroughWorker('worker-twice.jpg');

  nextFetchResponse = blobResponse(new Blob(['1'], { type: 'image/jpeg' }));
  const revokedBefore = revoked.length;
  const first = await workerRepository.getDownloadUrl(attachment.id);
  nextFetchResponse = blobResponse(new Blob(['2'], { type: 'image/jpeg' }));
  const second = await workerRepository.getDownloadUrl(attachment.id);

  assert.notEqual(first, second, 'ownership is per call, not shared');
  assert.equal(revoked.length, revokedBefore, 'the repository revokes nothing itself');

  URL.revokeObjectURL(first);
  URL.revokeObjectURL(second);
  assert.deepEqual(revoked.slice(revokedBefore), [first, second]);
});

// --- the contract holds across implementations -----------------------------

test('both implementations satisfy the same caller-owned disposable-object-URL contract', async () => {
  const mockAttachment = await attachmentsRepository.upload({
    jobId: MOCK_JOB_ID,
    category: 'before',
    file: new Blob(['m'], { type: 'image/png' }),
    fileName: 'parity-mock.png',
    contentType: 'image/png',
    uploadedBy: 'tester',
  });
  const workerAttachment = await uploadThroughWorker('parity-worker.jpg');
  nextFetchResponse = blobResponse(new Blob(['w'], { type: 'image/jpeg' }));

  const urls = [
    await attachmentsRepository.getDownloadUrl(mockAttachment.id),
    await workerRepository.getDownloadUrl(workerAttachment.id),
  ];

  for (const url of urls) {
    assert.match(url, /^blob:/, 'disposable object URL in every backend mode');
    assert.ok(
      created.some((record) => record.url === url),
      'produced by URL.createObjectURL, not string construction'
    );
  }
  assert.equal(new Set(urls).size, urls.length, 'no URL is shared between implementations');
});

test('an unknown id rejects in both implementations rather than returning a URL', async () => {
  const created0 = created.length;
  await assert.rejects(() => attachmentsRepository.getDownloadUrl('service-jobs/nope/before/x.jpg'));
  await assert.rejects(() => workerRepository.getDownloadUrl('service-jobs/nope/before/x.jpg'));
  assert.equal(created.length, created0, 'a refused resolution leaks no object URL to revoke');
});

// --- regression guard on the canonical wording itself ----------------------

test('the AttachmentsRepository interface states the contract and no longer claims sync/direct-string behavior', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/repositories/types.ts', import.meta.url), 'utf8');
  const block = source.slice(
    source.indexOf('export interface AttachmentsRepository'),
    source.indexOf('deleteAttachment(id: string): Promise<void>')
  );

  assert.match(block, /URL\.createObjectURL/, 'the contract names how the URL is produced');
  assert.match(block, /ownership of it transfers to the CALLER/i);
  assert.match(block, /URL\.revokeObjectURL\(url\)/, 'the caller obligation is explicit');
  // The two false claims Phase 4R.6R found, as claims. (The JSDoc's historical
  // note names them in order to disown them, so the guard is anchored on the
  // assertive phrasing, not on the words appearing anywhere in the block.)
  assert.doesNotMatch(block, /getDownloadUrl\(\) is sync/);
  assert.doesNotMatch(block, /no round-trip needed/);
  assert.doesNotMatch(block, /this is direct\s+string/);
  // The behavioral suites above are what prove the contract; this only keeps
  // the false wording Phase 4R.6R found from being reintroduced.
});
