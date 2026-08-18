import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

// F5d-69 Phase 2B — frontend regression coverage for the pure, framework-
// independent logic behind the New Service Job intake, the Service Job
// Details save path, and their shared invariant/validation helpers.
// Follows the established ssrLoadModule convention (see
// test/attachmentRetentionLifecycle.test.mjs) rather than rendering React,
// since no jsdom/testing-library is installed in this project.

const vite = await createServer({ appType: 'custom', server: { middlewareMode: true } });
after(() => vite.close());

const { buildServiceJobIntakePayload, estimateIntakeRequestBytes, buildCustomerIntakeSelector } =
  await vite.ssrLoadModule('/src/services/serviceJobCreation.ts');
const { createEmptyServiceIntake } = await vite.ssrLoadModule('/src/constants/serviceIntake.ts');
const { resolveServiceEventMetadataInvariants } = await vite.ssrLoadModule(
  '/src/services/serviceEventMetadataInvariants.ts'
);
const { buildServiceJobUpdate } = await vite.ssrLoadModule('/src/services/serviceJobUpdate.ts');
const {
  isServiceIntakeComplete,
  serviceIntakeMetadataError,
  serviceEventMetadataDraftError,
} = await vite.ssrLoadModule('/src/validation/serviceIntakeValidation.ts');
const { isValidCalendarDate, isValidHttpsUrl } = await vite.ssrLoadModule(
  '/src/utils/serviceEventValidation.ts'
);
const { mostRecentJobWithContactChannel, compareServiceJobsByRecency } = await vite.ssrLoadModule(
  '/src/services/serviceJobHistory.ts'
);
const { channelLabel, orderVerificationLabel } = await vite.ssrLoadModule(
  '/src/services/serviceJobPresentation.ts'
);

const baseCustomer = { kind: 'existing', id: 'cust-1', name: 'QA Customer', phone: '0812345678', email: 'qa@example.com', previousServiceJobs: 0, lastVisit: '2026-08-01' };
const baseProduct = {
  id: 'prod-1',
  brand: 'Bruno',
  productName: 'Blender',
  model: 'X100',
  serialNumber: 'SN1',
  category: 'Kitchen',
  status: 'active',
  warrantyStatus: 'in_warranty',
  lastServiceDate: '—',
  previousServiceCount: 0,
};

function baseServiceJob(overrides = {}) {
  return {
    id: 'BRN-2026-000001',
    brandId: 'bruno-thailand',
    customerName: 'QA Customer',
    customerPhone: '0812345678',
    customerEmail: 'qa@example.com',
    product: 'Blender X100',
    productCategory: 'Kitchen',
    serialNumber: 'SN1',
    issue: 'issue',
    description: 'description',
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

let failures = 0;
function check(name, value) {
  if (value) return;
  failures += 1;
  console.error(`  FAIL  ${name}`);
}

// --- createEmptyServiceIntake / isServiceIntakeComplete ---------------------

test('createEmptyServiceIntake includes blank F5d-69 fields', () => {
  const intake = createEmptyServiceIntake();
  assert.equal(intake.contactChannel, null);
  assert.equal(intake.contactChannelIdentity, '');
  assert.equal(intake.orderNumber, '');
  assert.equal(intake.purchaseDate, '');
  assert.equal(intake.orderDeliveredDate, '');
  assert.equal(intake.externalEvidenceUrl, '');
  assert.equal(intake.externalEvidenceNote, '');
});

test('F5d-69 fields never gate isServiceIntakeComplete (recommended, not required)', () => {
  const intake = {
    ...createEmptyServiceIntake(),
    problemDescription: 'broken',
    contactChannel: null,
  };
  assert.equal(isServiceIntakeComplete(intake), true);
  const withoutProblem = { ...createEmptyServiceIntake(), contactChannel: 'shopee', contactChannelIdentity: 'x' };
  assert.equal(isServiceIntakeComplete(withoutProblem), false);
});

// --- INTAKE: new customer + Shopee username + order number ------------------

test('new customer + Shopee username + order number: payload carries all resolved fields', () => {
  const intake = {
    ...createEmptyServiceIntake(),
    contactChannel: 'shopee',
    contactChannelIdentity: '  shop_user  ',
    orderNumber: '  250731SHP04821  ',
  };
  const payload = buildServiceJobIntakePayload({ customer: baseCustomer, product: baseProduct, intake });
  assert.equal(payload.contactChannel, 'shopee');
  assert.equal(payload.contactChannelIdentity, 'shop_user');
  assert.equal(payload.orderNumber, '250731SHP04821');
  assert.equal(payload.orderVerification, 'unverified');
});

// --- INTAKE: existing customer + derived prior channel / later LINE ---------

test('existing customer + derived prior channel: most recent job with a channel wins', () => {
  const jobs = [
    baseServiceJob({ id: 'BRN-2026-000001', createdAt: '2026-07-01', contactChannel: 'shopee', contactChannelIdentity: 'old_user' }),
    baseServiceJob({ id: 'BRN-2026-000002', createdAt: '2026-08-01', contactChannel: 'line', contactChannelIdentity: 'new_line_id' }),
  ];
  const recent = mostRecentJobWithContactChannel(jobs);
  check('most recent job by createdAt is selected', recent.id === 'BRN-2026-000002');
  check('its channel is line', recent.contactChannel === 'line');
});

test('existing customer later contacts via LINE: same-day tiebreak uses job id DESC', () => {
  const jobs = [
    baseServiceJob({ id: 'BRN-2026-000001', createdAt: '2026-08-01', contactChannel: 'shopee' }),
    baseServiceJob({ id: 'BRN-2026-000002', createdAt: '2026-08-01', contactChannel: 'line' }),
  ];
  const recent = mostRecentJobWithContactChannel(jobs);
  check('same-day tie broken by higher job id', recent.id === 'BRN-2026-000002');
  check('compareServiceJobsByRecency orders id DESC on a createdAt tie', compareServiceJobsByRecency(jobs[1], jobs[0]) < 0);
});

test('a job with no contact channel is never selected as the recent one', () => {
  const jobs = [baseServiceJob({ id: 'BRN-2026-000001', contactChannel: null })];
  assert.equal(mostRecentJobWithContactChannel(jobs), null);
});

// --- INTAKE: change customer resets metadata --------------------------------

test('change customer resets metadata: a fresh empty intake carries no leaked channel/order state', () => {
  const dirtyIntake = {
    ...createEmptyServiceIntake(),
    contactChannel: 'shopee',
    contactChannelIdentity: 'leaked_user',
    orderNumber: 'LEAKED-1',
  };
  void dirtyIntake; // simulated prior customer's draft — never read after reset
  const resetIntake = createEmptyServiceIntake();
  assert.equal(resetIntake.contactChannel, null);
  assert.equal(resetIntake.contactChannelIdentity, '');
  assert.equal(resetIntake.orderNumber, '');
});

// --- INTAKE: phone channel clears identity / clearing channel clears identity

test('phone channel clears identity at payload build, even if client state was not cleared', () => {
  const intake = { ...createEmptyServiceIntake(), contactChannel: 'phone', contactChannelIdentity: 'stale' };
  const payload = buildServiceJobIntakePayload({ customer: baseCustomer, product: baseProduct, intake });
  assert.equal(payload.contactChannelIdentity, null);
});

test('clearing channel to null clears identity at payload build too', () => {
  const intake = { ...createEmptyServiceIntake(), contactChannel: null, contactChannelIdentity: 'stale' };
  const payload = buildServiceJobIntakePayload({ customer: baseCustomer, product: baseProduct, intake });
  assert.equal(payload.contactChannelIdentity, null);
});

// --- INTAKE: order verification default / clearing --------------------------

test('order number present defaults verification to unverified', () => {
  const intake = { ...createEmptyServiceIntake(), orderNumber: 'ABC-1' };
  const payload = buildServiceJobIntakePayload({ customer: baseCustomer, product: baseProduct, intake });
  assert.equal(payload.orderVerification, 'unverified');
});

test('clearing order number to blank clears verification to null', () => {
  const intake = { ...createEmptyServiceIntake(), orderNumber: '   ' };
  const payload = buildServiceJobIntakePayload({ customer: baseCustomer, product: baseProduct, intake });
  assert.equal(payload.orderNumber, null);
  assert.equal(payload.orderVerification, null);
});

// --- INTAKE: dates valid/invalid --------------------------------------------

test('a valid entered date passes serviceIntakeMetadataError', () => {
  const intake = { ...createEmptyServiceIntake(), purchaseDate: '2026-07-31' };
  assert.equal(serviceIntakeMetadataError(intake), null);
});

test('an impossible calendar date blocks save with an error', () => {
  const intake = { ...createEmptyServiceIntake(), purchaseDate: '2026-02-30' };
  assert.notEqual(serviceIntakeMetadataError(intake), null);
});

test('a non-leap-year Feb 29 blocks save with an error', () => {
  const intake = { ...createEmptyServiceIntake(), orderDeliveredDate: '2026-02-29' };
  assert.notEqual(serviceIntakeMetadataError(intake), null);
});

test('a blank date is never an error (dates are optional)', () => {
  const intake = createEmptyServiceIntake();
  assert.equal(serviceIntakeMetadataError(intake), null);
});

test('isValidCalendarDate accepts a real leap day', () => {
  assert.equal(isValidCalendarDate('2024-02-29'), true);
});

test('isValidCalendarDate rejects month 13 and day 32', () => {
  assert.equal(isValidCalendarDate('2026-13-01'), false);
  assert.equal(isValidCalendarDate('2026-01-32'), false);
});

// --- INTAKE: external evidence -----------------------------------------------

test('a valid https evidence URL passes validation and round-trips through payload build', () => {
  const intake = { ...createEmptyServiceIntake(), externalEvidenceUrl: 'https://drive.google.com/x' };
  assert.equal(serviceIntakeMetadataError(intake), null);
  const payload = buildServiceJobIntakePayload({ customer: baseCustomer, product: baseProduct, intake });
  assert.equal(payload.externalEvidenceUrl, 'https://drive.google.com/x');
});

test('an http evidence URL is rejected by client-side validation', () => {
  const intake = { ...createEmptyServiceIntake(), externalEvidenceUrl: 'http://example.com/a' };
  assert.notEqual(serviceIntakeMetadataError(intake), null);
});

test('a malformed evidence URL is rejected by client-side validation', () => {
  const intake = { ...createEmptyServiceIntake(), externalEvidenceUrl: 'not a url' };
  assert.notEqual(serviceIntakeMetadataError(intake), null);
});

test('no external evidence entered: payload carries null for both fields, no error', () => {
  const intake = createEmptyServiceIntake();
  assert.equal(serviceIntakeMetadataError(intake), null);
  const payload = buildServiceJobIntakePayload({ customer: baseCustomer, product: baseProduct, intake });
  assert.equal(payload.externalEvidenceUrl, null);
  assert.equal(payload.externalEvidenceNote, null);
});

test('isValidHttpsUrl rejects javascript: and data: schemes', () => {
  assert.equal(isValidHttpsUrl('javascript:alert(1)'), false);
  assert.equal(isValidHttpsUrl('data:text/html,x'), false);
});

// --- INTAKE: metadata included in the final request-byte calculation --------

test('a large orderNumber measurably increases the estimated request byte count', () => {
  const shortIntake = { ...createEmptyServiceIntake(), orderNumber: 'A' };
  const longIntake = { ...createEmptyServiceIntake(), orderNumber: 'B'.repeat(64) };
  const shortPayload = buildServiceJobIntakePayload({ customer: baseCustomer, product: baseProduct, intake: shortIntake });
  const longPayload = buildServiceJobIntakePayload({ customer: baseCustomer, product: baseProduct, intake: longIntake });
  const selector = buildCustomerIntakeSelector(baseCustomer);
  const shortBytes = estimateIntakeRequestBytes(shortPayload, selector);
  const longBytes = estimateIntakeRequestBytes(longPayload, selector);
  check('longer orderNumber increases the measured byte count', longBytes > shortBytes + 50);
});

test('a large externalEvidenceNote measurably increases the estimated request byte count', () => {
  const shortIntake = { ...createEmptyServiceIntake(), externalEvidenceNote: 'x' };
  const longIntake = { ...createEmptyServiceIntake(), externalEvidenceNote: 'เครื่องดับหลังใช้งาน'.repeat(20) };
  const shortPayload = buildServiceJobIntakePayload({ customer: baseCustomer, product: baseProduct, intake: shortIntake });
  const longPayload = buildServiceJobIntakePayload({ customer: baseCustomer, product: baseProduct, intake: longIntake });
  const selector = buildCustomerIntakeSelector(baseCustomer);
  const shortBytes = estimateIntakeRequestBytes(shortPayload, selector);
  const longBytes = estimateIntakeRequestBytes(longPayload, selector);
  check('longer Thai note increases the measured byte count', longBytes > shortBytes + 100);
});

test('the byte estimate measures the ACTUAL payload buildServiceJobIntakePayload returns, not a separate shape', () => {
  const intake = {
    ...createEmptyServiceIntake(),
    contactChannel: 'shopee',
    contactChannelIdentity: 'shop_user',
    orderNumber: 'ORD-1',
    purchaseDate: '2026-07-01',
    orderDeliveredDate: '2026-07-05',
    externalEvidenceUrl: 'https://drive.google.com/x',
    externalEvidenceNote: 'note',
  };
  const payload = buildServiceJobIntakePayload({ customer: baseCustomer, product: baseProduct, intake });
  const selector = buildCustomerIntakeSelector(baseCustomer);
  const expectedBytes = new TextEncoder().encode(JSON.stringify({ intake: payload, customer: selector })).length;
  assert.equal(estimateIntakeRequestBytes(payload, selector), expectedBytes);
});

// --- shared invariant resolver -----------------------------------------------

test('resolveServiceEventMetadataInvariants: phone channel forces identity null', () => {
  const resolved = resolveServiceEventMetadataInvariants({
    contactChannel: 'phone',
    contactChannelIdentity: 'stale',
    orderNumber: null,
    orderVerification: null,
  });
  assert.equal(resolved.contactChannelIdentity, null);
});

test('resolveServiceEventMetadataInvariants: order number present with null verification defaults to unverified', () => {
  const resolved = resolveServiceEventMetadataInvariants({
    contactChannel: null,
    contactChannelIdentity: null,
    orderNumber: 'ABC-1',
    orderVerification: null,
  });
  assert.equal(resolved.orderVerification, 'unverified');
});

test('resolveServiceEventMetadataInvariants: order number present with an explicit verification keeps it', () => {
  const resolved = resolveServiceEventMetadataInvariants({
    contactChannel: null,
    contactChannelIdentity: null,
    orderNumber: 'ABC-1',
    orderVerification: 'verified',
  });
  assert.equal(resolved.orderVerification, 'verified');
});

test('resolveServiceEventMetadataInvariants: null order number forces verification null', () => {
  const resolved = resolveServiceEventMetadataInvariants({
    contactChannel: null,
    contactChannelIdentity: null,
    orderNumber: null,
    orderVerification: 'verified',
  });
  assert.equal(resolved.orderVerification, null);
});

// --- DETAILS: all metadata editable / clearing to null / verification transitions

test('buildServiceJobUpdate includes resolved metadata when contactChannel is supplied', () => {
  const current = baseServiceJob();
  const patch = buildServiceJobUpdate(
    {
      status: 'Received',
      notes: [],
      contactChannel: 'lazada',
      contactChannelIdentity: 'lzd_user',
      orderNumber: 'LZD-1',
      orderVerification: 'verified',
      purchaseDate: '2026-07-01',
      orderDeliveredDate: '2026-07-05',
      externalEvidenceUrl: 'https://drive.google.com/x',
      externalEvidenceNote: 'note',
    },
    current,
    'mock'
  );
  assert.equal(patch.contactChannel, 'lazada');
  assert.equal(patch.contactChannelIdentity, 'lzd_user');
  assert.equal(patch.orderNumber, 'LZD-1');
  assert.equal(patch.orderVerification, 'verified');
  assert.equal(patch.purchaseDate, '2026-07-01');
  assert.equal(patch.orderDeliveredDate, '2026-07-05');
  assert.equal(patch.externalEvidenceUrl, 'https://drive.google.com/x');
  assert.equal(patch.externalEvidenceNote, 'note');
});

test('buildServiceJobUpdate omits metadata keys entirely when contactChannel is not supplied (edits.contactChannel undefined)', () => {
  const current = baseServiceJob();
  const patch = buildServiceJobUpdate({ status: 'Received', notes: [] }, current, 'mock');
  assert.equal('contactChannel' in patch, false);
  assert.equal('orderNumber' in patch, false);
});

test('buildServiceJobUpdate: clearing to null on all metadata fields is preserved verbatim', () => {
  const current = baseServiceJob({ contactChannel: 'shopee', contactChannelIdentity: 'x', orderNumber: 'ABC', orderVerification: 'verified' });
  const patch = buildServiceJobUpdate(
    {
      status: 'Received',
      notes: [],
      contactChannel: null,
      contactChannelIdentity: null,
      orderNumber: null,
      orderVerification: null,
      purchaseDate: null,
      orderDeliveredDate: null,
      externalEvidenceUrl: null,
      externalEvidenceNote: null,
    },
    current,
    'mock'
  );
  assert.equal(patch.contactChannel, null);
  assert.equal(patch.contactChannelIdentity, null);
  assert.equal(patch.orderNumber, null);
  assert.equal(patch.orderVerification, null);
});

test('buildServiceJobUpdate: verification transition from unverified to verified is preserved, order number unchanged', () => {
  const current = baseServiceJob({ orderNumber: 'ABC-1', orderVerification: 'unverified' });
  const patch = buildServiceJobUpdate(
    {
      status: 'Received',
      notes: [],
      contactChannel: null,
      contactChannelIdentity: null,
      orderNumber: 'ABC-1',
      orderVerification: 'verified',
      purchaseDate: null,
      orderDeliveredDate: null,
      externalEvidenceUrl: null,
      externalEvidenceNote: null,
    },
    current,
    'mock'
  );
  assert.equal(patch.orderNumber, 'ABC-1');
  assert.equal(patch.orderVerification, 'verified');
});

test('buildServiceJobUpdate: an order number supplied with null verification is defaulted to unverified server-side-equivalent (client resolver)', () => {
  const current = baseServiceJob();
  const patch = buildServiceJobUpdate(
    {
      status: 'Received',
      notes: [],
      contactChannel: null,
      contactChannelIdentity: null,
      orderNumber: 'NEW-1',
      orderVerification: null,
      purchaseDate: null,
      orderDeliveredDate: null,
      externalEvidenceUrl: null,
      externalEvidenceNote: null,
    },
    current,
    'mock'
  );
  assert.equal(patch.orderVerification, 'unverified');
});

// --- DETAILS: serviceEventMetadataDraftError shared with intake -------------

test('serviceEventMetadataDraftError blocks an invalid date the same way for a Details-shaped draft', () => {
  const err = serviceEventMetadataDraftError({
    purchaseDate: '2026-02-30',
    orderDeliveredDate: '',
    externalEvidenceUrl: '',
  });
  assert.notEqual(err, null);
});

test('serviceEventMetadataDraftError blocks an invalid URL for a Details-shaped draft', () => {
  const err = serviceEventMetadataDraftError({
    purchaseDate: '',
    orderDeliveredDate: '',
    externalEvidenceUrl: 'javascript:alert(1)',
  });
  assert.notEqual(err, null);
});

// --- presentation labels ------------------------------------------------------

test('channelLabel covers all seven approved channels with a non-empty label', () => {
  for (const channel of ['shopee', 'lazada', 'line', 'store', 'website', 'phone', 'other']) {
    check(`channelLabel('${channel}') is non-empty`, typeof channelLabel(channel) === 'string' && channelLabel(channel).length > 0);
  }
});

test('orderVerificationLabel covers all three states with distinct labels', () => {
  const labels = new Set(['unverified', 'verified', 'not_found'].map(orderVerificationLabel));
  assert.equal(labels.size, 3);
});

console.log(`\nf5d69Frontend: ${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
if (failures > 0) process.exit(1);
