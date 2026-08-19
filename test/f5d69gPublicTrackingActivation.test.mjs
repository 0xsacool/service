import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import { createServer } from 'vite';

// F5d-69G Phase 2-FIX — Explicit Issuance Lifecycle.
//
// Service Job creation and Public Tracking issuance are separate operations.
// Creation never mints the SRV bearer secret (a create whose response is lost
// would otherwise strand the credential as committed-but-unknowable), so
// every assertion here is built around the explicit issuance path and the
// three genuinely distinct states it produces:
//   A  inactive                     — publicTrackingCodeHash === null
//   B  active, plaintext known here — just issued in THIS session
//   C  active, plaintext unknown    — issued earlier / response lost
// Follows this project's no-jsdom convention: repository/pure behavior runs
// through Vite's ssrLoadModule, React wiring is proven as source-structural
// assertions (test/f5d69NewServiceJobWiring.test.mjs's precedent).

const vite = await createServer({ appType: 'custom', server: { middlewareMode: true } });
after(() => vite.close());

const readSource = async (path) =>
  await readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const { serviceJobsRepository } = await vite.ssrLoadModule(
  '/src/repositories/serviceJobsRepository.ts'
);
const { isValidPublicTrackingCode } = await vite.ssrLoadModule(
  '/src/services/publicTrackingCode.ts'
);
const { buildPublicTrackingUrl } = await vite.ssrLoadModule(
  '/src/services/publicTrackingLink.ts'
);
const { PublicTrackingIssuanceError } = await vite.ssrLoadModule(
  '/src/repositories/types.ts'
);

function draft(overrides = {}) {
  return {
    brandId: 'bruno-thailand',
    customerName: 'F5d-69G Test Customer',
    customerPhone: '0899999001',
    customerEmail: '',
    product: 'Test Product',
    productCategory: 'Other',
    serialNumber: 'SERIAL-F5D69G',
    issue: 'Test issue',
    description: 'Test description',
    status: 'Received',
    priority: 'Normal',
    createdAt: '2026-08-19',
    updatedAt: '2026-08-19',
    technician: 'Unassigned',
    estimatedCompletion: '—',
    warranty: false,
    photos: [],
    accessories: [],
    timeline: [],
    notes: [],
    closedAt: null,
    publicTrackingTokenHash: null,
    publicTrackingCodeHash: null,
    contactChannel: null,
    contactChannelIdentity: null,
    orderNumber: null,
    orderVerification: null,
    purchaseDate: null,
    orderDeliveredDate: null,
    externalEvidenceUrl: null,
    externalEvidenceNote: null,
    ...overrides,
  };
}

// --- creation creates NO credential ----------------------------------------

test('Mock create() returns the ServiceJob itself and mints no tracking credential', async () => {
  const created = await serviceJobsRepository.create(draft());
  assert.equal(typeof created.id, 'string', 'create() must return the ServiceJob directly');
  assert.equal(
    created.publicTrackingCodeHash,
    null,
    'creation must never activate public tracking'
  );
  assert.equal(
    serviceJobsRepository.getById(created.id)?.publicTrackingCodeHash,
    null,
    'the persisted job must also be inactive after creation'
  );
});

test('no creation path can produce an SRV bearer secret — so a creation retry cannot lose one', async () => {
  const created = await serviceJobsRepository.create(draft({ customerPhone: '0899999002' }));
  assert.doesNotMatch(
    JSON.stringify(created),
    /SRV-\d{4}-\d{4}-[0-9A-Z]{6}/,
    'no SRV-shaped credential may appear anywhere in a creation result'
  );
});

// --- explicit issuance: inactive -> issue, active -> rotate ----------------

test('explicit issuance activates an inactive job and returns a valid canonical code', async () => {
  const created = await serviceJobsRepository.create(draft({ customerPhone: '0899999003' }));
  const issued = await serviceJobsRepository.issuePublicTrackingCode(created.id);
  assert.ok(isValidPublicTrackingCode(issued.code));
  assert.notEqual(issued.job.publicTrackingCodeHash, null);
  assert.equal(
    serviceJobsRepository.getById(created.id)?.publicTrackingCodeHash,
    issued.job.publicTrackingCodeHash
  );
  assert.notEqual(issued.code, issued.job.publicTrackingCodeHash, 'the code must never equal its stored hash');
});

test('rotation issues a different code and replaces the stored hash, invalidating the previous one', async () => {
  const created = await serviceJobsRepository.create(draft({ customerPhone: '0899999004' }));
  const first = await serviceJobsRepository.issuePublicTrackingCode(created.id);
  const rotated = await serviceJobsRepository.issuePublicTrackingCode(created.id);
  assert.notEqual(rotated.code, first.code);
  assert.notEqual(rotated.job.publicTrackingCodeHash, first.job.publicTrackingCodeHash);
  assert.equal(
    serviceJobsRepository.getById(created.id)?.publicTrackingCodeHash,
    rotated.job.publicTrackingCodeHash,
    'only the newest hash may remain stored — the old one is gone, so the old code cannot verify'
  );
});

test('issuance fails closed for a nonexistent Service Job id', async () => {
  await assert.rejects(() => serviceJobsRepository.issuePublicTrackingCode('NO-SUCH-JOB-ID'));
});

// --- ambiguous vs conclusive issuance failure ------------------------------

test('PublicTrackingIssuanceError distinguishes a conclusive rejection from an ambiguous outcome', () => {
  assert.equal(new PublicTrackingIssuanceError('forbidden', 403).isConclusive, true);
  assert.equal(new PublicTrackingIssuanceError('unauthorized', 401).isConclusive, true);
  assert.equal(new PublicTrackingIssuanceError('bad request', 400).isConclusive, true);
  // A server-side failure or a total absence of a status leaves the real
  // outcome unknown — the credential may in fact be live.
  assert.equal(new PublicTrackingIssuanceError('server error', 500).isConclusive, false);
  assert.equal(new PublicTrackingIssuanceError('network failure', null).isConclusive, false);
});

test('the Firestore repository classifies a network failure and a malformed 2xx body as AMBIGUOUS, not as failure', async () => {
  const source = await readSource('src/repositories/firestoreServiceJobRepository.ts');
  const body = source.match(/async issuePublicTrackingCode\(id\) \{([\s\S]*?)\n {4}\},/);
  assert.notEqual(body, null, 'expected to find issuePublicTrackingCode');
  // A rejected fetch must become a null-status (ambiguous) error, never a
  // conclusive one, because the request may already have committed.
  assert.match(
    body[1],
    /catch \{[\s\S]*?new PublicTrackingIssuanceError\(\s*'Public tracking code issuance could not be confirmed',\s*null\s*\)/,
    'a rejected fetch must produce an ambiguous (null-status) issuance error'
  );
  assert.match(
    body[1],
    /new PublicTrackingIssuanceError\(message, response\.status\)/,
    'an HTTP error must carry its real status so a 4xx can be reported conclusively'
  );
});

// --- three-state staff UI ---------------------------------------------------

const sectionSourcePromise = readSource(
  'src/features/service-jobs/components/PublicTrackingSection.tsx'
);

test('STATE A (inactive): shows the inactive badge and the issue action', async () => {
  const source = await sectionSourcePromise;
  assert.match(source, /useState\(job\.publicTrackingCodeHash !== null\)/, 'active-ness must derive from the persisted hash');
  assert.match(source, /ยังไม่ได้เปิดใช้งาน/);
  assert.match(source, /สร้างรหัสติดตาม/);
});

test('STATE C (active, plaintext unknown) is never rendered as inactive', async () => {
  const source = await sectionSourcePromise;
  // The active branch is selected by isActive alone — NOT by whether a
  // plaintext code happens to be in local state.
  assert.match(source, /\) : isActive \? \(/, 'expected an isActive branch distinct from the issued-code branch');
  assert.match(source, /รหัสเดิมไม่สามารถแสดงซ้ำได้/);
  assert.match(source, /ออกใหม่/);
});

test('STATE B (active, plaintext known) shows the code, copy actions, and a rotate affordance', async () => {
  const source = await sectionSourcePromise;
  assert.match(source, /\{issuedCode && trackingUrl \? \(/);
  assert.match(source, /คัดลอกรหัส/);
  assert.match(source, /คัดลอกลิงก์/);
});

test('an ambiguous issuance failure never auto-retries and never auto-rotates', async () => {
  const source = await sectionSourcePromise;
  const issueBody = source.match(/const issue = async \(\) => \{([\s\S]*?)\n {2}\};/);
  assert.notEqual(issueBody, null, 'expected to find the issue() handler');
  // Exactly one onIssue call in the handler — no retry loop, no second call.
  assert.equal(
    (issueBody[1].match(/onIssue\(/g) ?? []).length,
    1,
    'issue() must call the issuance endpoint exactly once — an automatic retry could silently rotate a live credential'
  );
  assert.doesNotMatch(issueBody[1], /setTimeout|while \(|for \(/, 'no retry loop or scheduled retry is permitted');
  assert.match(issueBody[1], /isConclusive/, 'the handler must branch on conclusive vs ambiguous');
});

test('an ambiguous failure uses neutral wording and re-reads the real persisted job state', async () => {
  const source = await sectionSourcePromise;
  assert.match(source, /ไม่สามารถยืนยันผลการสร้างรหัสติดตามได้/);
  assert.match(source, /หากระบบแสดงว่าเปิดใช้งานแล้ว ให้กด “ออกใหม่” เพื่อรับรหัสใหม่/);
  assert.match(
    source,
    /const refreshed = onRefreshJob\?\.\(job\.id\);\s*\n\s*if \(refreshed && refreshed\.publicTrackingCodeHash !== null\) setIsActive\(true\);/,
    'an ambiguous outcome must re-read the job so staff can tell inactive from active-but-undelivered'
  );
});

test('the section never attempts plaintext recovery — no scan, no query, no hash-to-code path', async () => {
  const source = await sectionSourcePromise;
  assert.doesNotMatch(source, /setIssuedCode\(job\.publicTrackingCodeHash\)/);
  // Code constructs only — deliberately not prose, so an explanatory comment
  // mentioning "scan"/"query" can never trip this guard.
  assert.doesNotMatch(source, /getAll\(\)|\.filter\(|repositories\./);
  assert.match(source, /setIssuedCode\(result\.code\)/, 'the only source of a displayed code is a fresh issuance result');
});

// --- print truthfulness across all three states ----------------------------

const printSourcePromise = readSource(
  'src/features/service-jobs/components/ServiceRequestPrintPreview.tsx'
);

test('the print document derives three distinct public-tracking states, not two', async () => {
  const source = await printSourcePromise;
  assert.match(
    source,
    /publicTrackingState: 'credentialed' \| 'active-unavailable' \| 'inactive'/,
    'the print document must model active-but-unavailable as its own state'
  );
  assert.match(
    source,
    /publicTrackingCode !== null\s*\n?\s*\? 'credentialed'\s*\n?\s*: job\.publicTrackingCodeHash !== null\s*\n?\s*\? 'active-unavailable'\s*\n?\s*: 'inactive'/,
    'the state must be derived from BOTH the in-session code and the persisted hash'
  );
});

test('STATE C print: an active job with no known code must NOT be printed as inactive', async () => {
  const source = await printSourcePromise;
  const activeUnavailableBlock = source.match(
    /publicTrackingState === 'active-unavailable' &&[\s\S]*?\)\}/
  );
  assert.notEqual(activeUnavailableBlock, null, 'expected an active-unavailable print branch');
  assert.doesNotMatch(
    activeUnavailableBlock[0],
    /ยังไม่ได้เปิดใช้งาน/,
    'the active-but-unavailable state must never print the inactive claim — that would be false'
  );
  assert.match(activeUnavailableBlock[0], /เปิดใช้งานการติดตามแล้ว/);
});

test('STATE A print: a genuinely inactive job prints the truthful inactive message and no QR', async () => {
  const source = await printSourcePromise;
  const inactiveBlock = source.match(/publicTrackingState === 'inactive' &&[\s\S]*?\)\}/);
  assert.notEqual(inactiveBlock, null);
  assert.match(inactiveBlock[0], /ยังไม่ได้เปิดใช้งานการติดตามสาธารณะ/);
  assert.doesNotMatch(inactiveBlock[0], /คิวอาร์โค้ด/, 'no QR placeholder may be printed without a credential');
});

test('STATE B print: only the credentialed state renders the QR and the real credentialed URL', async () => {
  // F5d-69G Phase 5A — the QR is now a real <QRCode value={trackingUrl}>
  // element rather than placeholder text; the invariant (only this exact
  // state ever renders a QR, bound to the real credentialed URL) is
  // unchanged, only the detection mechanism updates.
  const source = await printSourcePromise;
  const credentialedBlock = source.match(
    /publicTrackingState === 'credentialed' && trackingUrl && \([\s\S]*?\n {14}\)\}/
  );
  assert.notEqual(credentialedBlock, null, 'expected a credentialed print branch');
  assert.match(credentialedBlock[0], /<QRCode\s/);
  assert.match(credentialedBlock[0], /value=\{trackingUrl\}/);
  assert.match(credentialedBlock[0], /\{trackingUrl\}/);
});

test('print remains completely side-effect free — no issuance, no rotation, no network capability', async () => {
  const source = await printSourcePromise;
  assert.doesNotMatch(
    source,
    /repositoryProvider|useIssuePublicTrackingCode|issuePublicTrackingCode|fetch\(/,
    'the print component must have no capability to issue or rotate anything'
  );
});

// --- URL contract ----------------------------------------------------------

test('the credentialed URL carries the secret in the fragment, shared by both surfaces', async () => {
  assert.equal(
    buildPublicTrackingUrl('https://app.example', 'BRN-2026-000006', 'SRV-2026-0819-K7M2QX'),
    'https://app.example/track/BRN-2026-000006#SRV-2026-0819-K7M2QX'
  );
  const url = new URL(
    buildPublicTrackingUrl('https://app.example', 'BRN-2026-000006', 'SRV-2026-0819-K7M2QX')
  );
  assert.equal(url.search, '', 'the credential must never be placed in a query string');
  assert.equal(url.hash, '#SRV-2026-0819-K7M2QX');
  for (const path of [
    'src/features/service-jobs/components/PublicTrackingSection.tsx',
    'src/features/service-jobs/components/ServiceRequestPrintPreview.tsx',
  ]) {
    assert.match(await readSource(path), /buildPublicTrackingUrl\(/, `${path} must use the shared builder`);
  }
});

test('the credentialed URL is forward-compatible with a future opaque Service Job ID', () => {
  assert.equal(
    buildPublicTrackingUrl('https://app.example', 'BRN-2026-A7K29Q', 'SRV-2026-0819-K7M2QX'),
    'https://app.example/track/BRN-2026-A7K29Q#SRV-2026-0819-K7M2QX'
  );
});

// --- creation success flow wiring ------------------------------------------

test('NewServiceJob no longer expects creation to return a credential', async () => {
  const source = await readSource('src/features/service-jobs/pages/NewServiceJob.tsx');
  assert.match(source, /const job = await createServiceJob\(/);
  assert.doesNotMatch(
    source,
    /const \{ job, publicTrackingCode \} = await createServiceJob\(/,
    'creation must not destructure a credential it no longer returns'
  );
});

test('NewServiceJob offers explicit issuance after creation and feeds the result to the print preview', async () => {
  const source = await readSource('src/features/service-jobs/pages/NewServiceJob.tsx');
  assert.match(source, /<PublicTrackingSection[\s\S]*?onIssued=\{setSavedPublicTrackingCode\}/);
  assert.match(source, /publicTrackingCode=\{savedPublicTrackingCode\}/);
  // The control must sit inside the print-hidden toolbar so the A4 document
  // geometry is untouched.
  assert.match(
    source,
    /className="service-request-preview-toolbar mb-6">\s*\n\s*<PublicTrackingSection/,
    'the issuance control must be inside the print-hidden toolbar wrapper'
  );
});

test('the in-session credential is transient only — never persisted to storage', async () => {
  for (const path of [
    'src/features/service-jobs/pages/NewServiceJob.tsx',
    'src/features/service-jobs/components/PublicTrackingSection.tsx',
  ]) {
    const source = await readSource(path);
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/, `${path} must not persist the plaintext code`);
  }
});

test('ServiceJobDetails wires both issuance and the ambiguous-failure refresh seam', async () => {
  const source = await readSource('src/features/service-jobs/pages/ServiceJobDetails.tsx');
  assert.match(source, /const \{ issuePublicTrackingCode, readServiceJob \} = useIssuePublicTrackingCode\(\)/);
  assert.match(source, /onIssue=\{issuePublicTrackingCode\}/);
  assert.match(source, /onRefreshJob=\{readServiceJob\}/);
});

// --- gateway / customer-facing copy ----------------------------------------

test('the public tracking gateway treats the tracking reference as an opaque charset-checked string', async () => {
  const source = await readSource('src/features/tracking/publicTracking.ts');
  assert.match(source, /SAFE_TRACKING_REFERENCE = \/\^\[a-zA-Z0-9_-\]\+\$\//);
});

test('TrackHome help copy distinguishes the SRV public code from a BRN Service Job number', async () => {
  const source = await readSource('src/features/tracking/publicTrackingLocale.ts');
  assert.match(source, /SRV-\.\.\..*ไม่ใช่เลขที่งานบริการที่ขึ้นต้นด้วย BRN/);
});
