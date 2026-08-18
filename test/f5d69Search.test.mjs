import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

// F5d-69 Phase 2B — Firestore-mode Universal Search regression coverage for
// the new orderNumber/contactChannelIdentity search dimensions, and a
// regression check that the pre-existing name/phone/tracking/serial
// dimensions are unaffected.

const vite = await createServer({ appType: 'custom', server: { middlewareMode: true } });
after(() => vite.close());

const {
  normalizeOrderNumberForMatch,
  matchesOrderNumber,
  normalizeChannelIdentityForMatch,
  matchesChannelIdentity,
} = await vite.ssrLoadModule('/src/repositories/searchMatching.ts');
const { createFirestoreSearchRepository } = await vite.ssrLoadModule(
  '/src/repositories/firestoreSearchRepository.ts'
);

let failures = 0;
function check(name, value) {
  if (value) return;
  failures += 1;
  console.error(`  FAIL  ${name}`);
}

// --- pure matching primitives ------------------------------------------------

test('normalizeOrderNumberForMatch ignores spaces and hyphens only, preserves other punctuation', () => {
  assert.equal(normalizeOrderNumberForMatch('250731 SHP-04821'), '250731shp04821');
  assert.equal(normalizeOrderNumberForMatch('250731.SHP/04821'), '250731.shp/04821');
});

test('matchesOrderNumber: order formatting variance for spaces/hyphens matches', () => {
  assert.equal(matchesOrderNumber('250731SHP04821', '250731-SHP-04821'), true);
  assert.equal(matchesOrderNumber('250731-SHP-04821', '250731SHP04821'), true);
  assert.equal(matchesOrderNumber('250731 SHP 04821', 'shp04821'), true);
});

test('matchesOrderNumber: substring match, case-insensitive', () => {
  assert.equal(matchesOrderNumber('250731SHP04821', 'SHP048'), true);
  assert.equal(matchesOrderNumber('250731SHP04821', 'shp048'), true);
});

test('matchesOrderNumber: distinct punctuation is preserved, not ignored (no fuzzy matching)', () => {
  assert.equal(matchesOrderNumber('250731.SHP.04821', '250731SHP04821'), false);
  assert.equal(matchesOrderNumber('250731.SHP.04821', '250731.SHP.04821'), true);
});

test('matchesOrderNumber: null orderNumber never matches', () => {
  assert.equal(matchesOrderNumber(null, 'anything'), false);
});

test('normalizeChannelIdentityForMatch strips a single leading @ and lowercases', () => {
  assert.equal(normalizeChannelIdentityForMatch('@Shop_User'), 'shop_user');
  assert.equal(normalizeChannelIdentityForMatch('Shop_User'), 'shop_user');
});

test('normalizeChannelIdentityForMatch strips only ONE leading @, not both', () => {
  assert.equal(normalizeChannelIdentityForMatch('@@handle'), '@handle');
});

test('matchesChannelIdentity: leading @ normalization matches on either side', () => {
  assert.equal(matchesChannelIdentity('shop_user', '@shop_user'), true);
  assert.equal(matchesChannelIdentity('@shop_user', 'shop_user'), true);
});

test('matchesChannelIdentity: substring match, case-insensitive', () => {
  assert.equal(matchesChannelIdentity('shopee_user_99', 'USER'), true);
});

test('matchesChannelIdentity: null identity never matches', () => {
  assert.equal(matchesChannelIdentity(null, 'x'), false);
});

// --- firestoreSearchRepository projection, end to end -----------------------

function customer(id, name, phone) {
  return { id, name, phone, email: `${id}@example.com`, brandIds: ['bruno-thailand'] };
}

function job(id, customerPhone, overrides = {}) {
  return {
    id,
    brandId: 'bruno-thailand',
    customerName: 'x',
    customerPhone,
    customerEmail: '',
    product: 'p',
    productCategory: 'c',
    serialNumber: `SN-${id}`,
    issue: 'i',
    description: 'd',
    status: 'Received',
    priority: 'Normal',
    createdAt: '2026-08-01',
    updatedAt: '2026-08-01',
    technician: 'Unassigned',
    estimatedCompletion: '—',
    warranty: true,
    photos: [],
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

function makeRepo(customers, jobs) {
  const customersRepo = { getAll: () => customers };
  const serviceJobsRepo = { getAll: () => jobs };
  return createFirestoreSearchRepository(customersRepo, serviceJobsRepo);
}

test('search by order number returns the owning customer with the matched order number projected', () => {
  const repo = makeRepo(
    [customer('c1', 'Somchai', '0812345678')],
    [job('BRN-2026-000001', '0812345678', { orderNumber: '250731SHP04821' })]
  );
  const results = repo.search('SHP048');
  assert.equal(results.length, 1);
  assert.equal(results[0].orderNumber, '250731SHP04821');
});

test('search by channel identity returns the owning customer with matched channel + identity projected', () => {
  const repo = makeRepo(
    [customer('c1', 'Somchai', '0812345678')],
    [job('BRN-2026-000001', '0812345678', { contactChannel: 'line', contactChannelIdentity: 'somchai_line' })]
  );
  const results = repo.search('@somchai_line');
  assert.equal(results.length, 1);
  assert.equal(results[0].marketplace, 'LINE');
  assert.equal(results[0].username, 'somchai_line');
});

test('name/phone/tracking/serial match projects the most recent non-null contact channel, not a query-matched one', () => {
  const repo = makeRepo(
    [customer('c1', 'Somchai Deterministic', '0812345678')],
    [
      job('BRN-2026-000001', '0812345678', { createdAt: '2026-07-01', contactChannel: 'shopee', contactChannelIdentity: 'old' }),
      job('BRN-2026-000002', '0812345678', { createdAt: '2026-08-01', contactChannel: 'line', contactChannelIdentity: 'new_id' }),
    ]
  );
  const results = repo.search('Somchai Deterministic');
  assert.equal(results.length, 1);
  assert.equal(results[0].marketplace, 'LINE');
  assert.equal(results[0].username, 'new_id');
});

test('deterministic projection: job ordering is createdAt DESC then job id DESC, never iteration order', () => {
  const repo = makeRepo(
    [customer('c1', 'Somchai', '0812345678')],
    [
      // Deliberately inserted out of chronological order to prove the
      // repository doesn't just pick whichever job happens to be last in
      // the array.
      job('BRN-2026-000005', '0812345678', { createdAt: '2026-08-01', contactChannel: 'shopee', contactChannelIdentity: 'later_same_day_lower_id' }),
      job('BRN-2026-000009', '0812345678', { createdAt: '2026-08-01', contactChannel: 'line', contactChannelIdentity: 'later_same_day_higher_id' }),
      job('BRN-2026-000001', '0812345678', { createdAt: '2026-07-01', contactChannel: 'other', contactChannelIdentity: 'earliest' }),
    ]
  );
  const results = repo.search('Somchai');
  assert.equal(results[0].username, 'later_same_day_higher_id');
});

test('a customer can project both an order-number match and a channel-identity match from two different jobs at once', () => {
  const repo = makeRepo(
    [customer('c1', 'Somchai', '0812345678')],
    [
      job('BRN-2026-000001', '0812345678', { orderNumber: 'ORDMATCH-1' }),
      job('BRN-2026-000002', '0812345678', { contactChannel: 'shopee', contactChannelIdentity: 'idmatch_shared_token' }),
    ]
  );
  // Query text must appear in both fields to trigger both projections in one search.
  const jobsShared = [
    job('BRN-2026-000001', '0812345678', { orderNumber: 'SHAREDTOKEN-1' }),
    job('BRN-2026-000002', '0812345678', { contactChannel: 'shopee', contactChannelIdentity: 'sharedtoken_user' }),
  ];
  const repo2 = makeRepo([customer('c1', 'Somchai', '0812345678')], jobsShared);
  const results = repo2.search('sharedtoken');
  assert.equal(results.length, 1);
  assert.equal(results[0].orderNumber, 'SHAREDTOKEN-1');
  assert.equal(results[0].username, 'sharedtoken_user');
});

// --- existing dimensions unaffected (regression) -----------------------------

test('existing name search still works unchanged', () => {
  const repo = makeRepo([customer('c1', 'Existing Name Regression', '0812345678')], [job('BRN-2026-000001', '0812345678')]);
  const results = repo.search('Existing Name Regression');
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'c1');
});

test('existing phone search still works unchanged', () => {
  const repo = makeRepo([customer('c1', 'X', '0899998888')], [job('BRN-2026-000001', '0899998888')]);
  const results = repo.search('0899998888');
  assert.equal(results.length, 1);
});

test('existing tracking-number search still works unchanged', () => {
  const repo = makeRepo([customer('c1', 'X', '0812345678')], [job('BRN-2026-000042', '0812345678')]);
  const results = repo.search('BRN-2026-000042');
  assert.equal(results.length, 1);
});

test('existing serial-number search still works unchanged', () => {
  const repo = makeRepo([customer('c1', 'X', '0812345678')], [job('BRN-2026-000001', '0812345678')]);
  const results = repo.search('SN-BRN-2026-000001');
  assert.equal(results.length, 1);
});

test('a customer with no matching job or field returns no results', () => {
  const repo = makeRepo([customer('c1', 'X', '0812345678')], [job('BRN-2026-000001', '0812345678')]);
  assert.equal(repo.search('completely-unrelated-query').length, 0);
});

console.log(`\nf5d69Search: ${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
if (failures > 0) process.exit(1);
