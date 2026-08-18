import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

// F5d-65 — approved architecture: new-customer creation is Worker-only, part
// of the same atomic Service Job transaction; product registration collects
// intake fields only (DECISIONS.md #037, no product_instances entity); the
// strict WarrantyStatus union is preserved. This file exercises the pure
// frontend logic (payload building, validation, serial-conflict detection)
// and the new components' accessibility contract — matching this project's
// existing no-React-renderer-except-static-markup testing convention
// (f5d64Accessibility.test.mjs).

const vite = await createServer({
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
});
after(() => vite.close());

const { buildCustomerIntakeSelector, buildServiceJobIntakePayload } =
  await vite.ssrLoadModule('/src/services/serviceJobCreation.ts');
const {
  buildManualRegisteredProduct,
  checkSerialAgainstServiceHistory,
  createEmptyManualProductEntry,
  validateManualProductEntry,
} = await vite.ssrLoadModule('/src/services/productRegistration.ts');
const { validateNewCustomerInput } = await vite.ssrLoadModule(
  '/src/validation/customerValidation.ts'
);
const { createEmptyNewCustomerDraft } = await vite.ssrLoadModule(
  '/src/types/customer.ts'
);
const { NewCustomerForm } = await vite.ssrLoadModule(
  '/src/features/service-jobs/components/NewCustomerForm.tsx'
);
const { NewCustomerSummaryCard } = await vite.ssrLoadModule(
  '/src/features/service-jobs/components/NewCustomerSummaryCard.tsx'
);
const { RegisterProductForm } = await vite.ssrLoadModule(
  '/src/shared/components/product/RegisterProductForm.tsx'
);
const { SearchNoResults } = await vite.ssrLoadModule(
  '/src/shared/components/search/SearchNoResults.tsx'
);

const existingCustomer = {
  kind: 'existing',
  id: 'cust-1',
  name: 'Somchai',
  phone: '0812345678',
  email: 'somchai@example.com',
  previousServiceJobs: 2,
  lastVisit: '2026-01-01',
};
const newCustomer = {
  kind: 'new',
  name: 'Walk-in',
  phone: '0899999999',
  email: '',
};
const product = {
  id: 'SERIAL-1',
  brand: 'BRUNO',
  productName: 'Toaster',
  model: 'BOE021',
  serialNumber: 'SERIAL-1',
  category: 'Kitchen',
  status: 'Active',
  warrantyStatus: 'in_warranty',
  lastServiceDate: '—',
  previousServiceCount: 0,
};
const intake = {
  problemDescription: 'Broken',
  problemChips: [],
  accessories: [],
  internalNotes: '',
  photos: [],
  // F5d-69 — matches createEmptyServiceIntake()'s own defaults.
  contactChannel: null,
  contactChannelIdentity: '',
  orderNumber: '',
  purchaseDate: '',
  orderDeliveredDate: '',
  externalEvidenceUrl: '',
  externalEvidenceNote: '',
};

// --- A/D: customer intake selector -----------------------------------------

test('buildCustomerIntakeSelector: existing customer maps to {kind, customerId}, never leaks name/phone/email', () => {
  const selector = buildCustomerIntakeSelector(existingCustomer);
  assert.deepEqual(selector, { kind: 'existing', customerId: 'cust-1' });
});

test('buildCustomerIntakeSelector: new customer maps to {kind: "new"} only — no id exists yet, nothing else leaks', () => {
  const selector = buildCustomerIntakeSelector(newCustomer);
  assert.deepEqual(selector, { kind: 'new' });
});

// --- B: existing-customer flow is unchanged ---------------------------------

test('B (regression): buildServiceJobIntakePayload produces identical output for an existing customer as before F5d-65', () => {
  const payload = buildServiceJobIntakePayload({
    customer: existingCustomer,
    product,
    intake,
  });
  assert.equal(payload.customerName, 'Somchai');
  assert.equal(payload.customerPhone, '0812345678');
  assert.equal(payload.customerEmail, 'somchai@example.com');
  assert.equal(payload.warranty, true);
});

test('the same payload builder works identically for a brand-new customer (no branch needed)', () => {
  const payload = buildServiceJobIntakePayload({
    customer: newCustomer,
    product,
    intake,
  });
  assert.equal(payload.customerName, 'Walk-in');
  assert.equal(payload.customerPhone, '0899999999');
  assert.equal(payload.customerEmail, '');
});

// --- C: new-customer validation ---------------------------------------------

test('C: a blank name is rejected', () => {
  const result = validateNewCustomerInput({
    ...createEmptyNewCustomerDraft(),
    phone: '0812345678',
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.name);
});

test('C: a blank phone is rejected', () => {
  const result = validateNewCustomerInput({
    ...createEmptyNewCustomerDraft(),
    name: 'Somchai',
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.phone);
});

test('C: name and phone present, email blank — valid (email is optional)', () => {
  const result = validateNewCustomerInput({
    name: 'Somchai',
    phone: '0812345678',
    email: '',
  });
  assert.equal(result.valid, true);
});

test('C: a malformed email is rejected; a well-formed one passes', () => {
  const bad = validateNewCustomerInput({ name: 'A', phone: '1', email: 'not-an-email' });
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.email);
  const good = validateNewCustomerInput({
    name: 'A',
    phone: '1',
    email: 'a@example.com',
  });
  assert.equal(good.valid, true);
});

test('C: an oversized name is rejected', () => {
  const result = validateNewCustomerInput({
    name: 'x'.repeat(201),
    phone: '0812345678',
    email: '',
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.name);
});

// --- G: product registration service ----------------------------------------

const manualEntry = (overrides = {}) => ({
  ...createEmptyManualProductEntry(),
  productName: 'Toaster',
  category: 'Kitchen',
  ...overrides,
});

test('G: buildManualRegisteredProduct with a matched catalog entry uses its real status', () => {
  const built = buildManualRegisteredProduct(manualEntry(), 'out_of_warranty', {
    id: 'p1',
    brand: 'BRUNO',
    categoryId: 'kitchen',
    name: 'Toaster',
    model: 'BOE021',
    status: 'Legacy',
    warrantyMonths: 12,
    accessoryIds: [],
    commonProblemIds: [],
  });
  assert.equal(built.status, 'Legacy');
});

test('G: buildManualRegisteredProduct with no catalog match defaults to Legacy status', () => {
  const built = buildManualRegisteredProduct(manualEntry(), 'out_of_warranty');
  assert.equal(built.status, 'Legacy');
});

test('G: a blank serial gets a synthetic local-only id, not the phone or an empty string', () => {
  const built = buildManualRegisteredProduct(manualEntry(), 'out_of_warranty');
  assert.equal(built.serialNumber, '');
  assert.notEqual(built.id, '');
});

test('G: a real serial is used directly as the id (matching the existing derived-product convention)', () => {
  const built = buildManualRegisteredProduct(
    manualEntry({ serialNumber: 'SERIAL-99' }),
    'out_of_warranty'
  );
  assert.equal(built.id, 'SERIAL-99');
});

// --- P1 #1 (blocker fix): warranty is never defaulted or discarded ----------

test('P1#1-A: no warranty selection blocks manual product submission', () => {
  const result = validateManualProductEntry(manualEntry(), null);
  assert.equal(result.valid, false);
  assert.ok(result.errors.warrantyStatus);
});

test('P1#1-A: an explicit warranty selection unblocks submission', () => {
  assert.equal(validateManualProductEntry(manualEntry(), 'in_warranty').valid, true);
  assert.equal(validateManualProductEntry(manualEntry(), 'out_of_warranty').valid, true);
});

test('P1#1-B: choosing in_warranty produces a Service Job intake with warranty === true', () => {
  const built = buildManualRegisteredProduct(manualEntry(), 'in_warranty');
  assert.equal(built.warrantyStatus, 'in_warranty');
  const payload = buildServiceJobIntakePayload({
    customer: newCustomer,
    product: built,
    intake,
  });
  assert.equal(payload.warranty, true);
});

test('P1#1-C: choosing out_of_warranty produces a Service Job intake with warranty === false', () => {
  const built = buildManualRegisteredProduct(manualEntry(), 'out_of_warranty');
  assert.equal(built.warrantyStatus, 'out_of_warranty');
  const payload = buildServiceJobIntakePayload({
    customer: newCustomer,
    product: built,
    intake,
  });
  assert.equal(payload.warranty, false);
});

test('P1#1-D: there is no default/implicit out_of_warranty path — the entry carries no warranty field at all', () => {
  const empty = createEmptyManualProductEntry();
  assert.equal(
    Object.prototype.hasOwnProperty.call(empty, 'warrantyStatus'),
    false,
    'createEmptyManualProductEntry() must not carry any warranty value to default from'
  );
  assert.equal(Object.values(empty).includes('out_of_warranty'), false);
});

test('P1#1-E: UI state and builder payload cannot diverge — the built value always equals the value passed, for both statuses', () => {
  for (const status of ['in_warranty', 'out_of_warranty']) {
    // A stale/contradictory field on the entry object must not be able to
    // win over the explicitly passed selection (the exact defect: the form
    // held the real choice while the builder read a separate default).
    const contaminated = { ...manualEntry(), warrantyStatus: 'in_warranty' };
    const built = buildManualRegisteredProduct(contaminated, status);
    assert.equal(built.warrantyStatus, status);
    const payload = buildServiceJobIntakePayload({
      customer: newCustomer,
      product: built,
      intake,
    });
    assert.equal(payload.warranty, status === 'in_warranty');
  }
});

// --- P1 #2 (blocker fix): serial history, never phone-based ownership -------

test('P1#2-A: a serial already anywhere in brand-scoped loaded history blocks manual registration', () => {
  const history = [{ serialNumber: 'SERIAL-1', customerPhone: '0899999999' }];
  assert.deepEqual(checkSerialAgainstServiceHistory('SERIAL-1', history), {
    kind: 'already-in-service-history',
  });
});

test('P1#2-B: two distinct customers sharing one phone cannot bypass the block', () => {
  // Same phone on both sides — under the old phone-equality rule this was
  // treated as "the selected customer already owns it" and auto-selected.
  // Shared household phones are explicitly allowed by BUSINESS_RULES.md, so
  // this must still block.
  const history = [{ serialNumber: 'SERIAL-1', customerPhone: '0812345678' }];
  assert.deepEqual(checkSerialAgainstServiceHistory('SERIAL-1', history), {
    kind: 'already-in-service-history',
  });
});

test('P1#2-B: a blank/unresolvable historical phone is not an ownership exception either', () => {
  const history = [{ serialNumber: 'SERIAL-1', customerPhone: '' }];
  assert.deepEqual(checkSerialAgainstServiceHistory('SERIAL-1', history), {
    kind: 'already-in-service-history',
  });
});

test('P1#2-C: a blank serial is still accepted (no history linkage, per BUSINESS_RULES.md)', () => {
  const history = [{ serialNumber: 'SERIAL-1', customerPhone: '0812345678' }];
  assert.deepEqual(checkSerialAgainstServiceHistory('', history), { kind: 'clear' });
  assert.deepEqual(checkSerialAgainstServiceHistory('   ', history), { kind: 'clear' });
});

test('P1#2-C: a genuinely unknown serial is clear', () => {
  const history = [{ serialNumber: 'SERIAL-1', customerPhone: '0812345678' }];
  assert.deepEqual(checkSerialAgainstServiceHistory('SERIAL-NEW', history), {
    kind: 'clear',
  });
});

test('P1#2-D: no phone-equality ownership inference remains in the registration service', async () => {
  const source = await readFile(
    new URL('../src/services/productRegistration.ts', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(source, /normalizeCanonicalPhone/);
  assert.doesNotMatch(source, /customerPhone/);
});

test('P1#2-E: no automatic same-phone serial reuse — the result set has no auto-select branch', () => {
  const history = [{ serialNumber: 'SERIAL-1', customerPhone: '0812345678' }];
  const result = checkSerialAgainstServiceHistory('SERIAL-1', history);
  // The old 'existing-for-customer' branch carried a product to silently
  // select; the safe result carries no product at all.
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'product'), false);
  assert.equal(result.kind, 'already-in-service-history');
});

// --- H: accessibility -------------------------------------------------------

test('H: NewCustomerForm exposes labelled name/phone/email fields and an autofocused first field', () => {
  const markup = renderToStaticMarkup(
    createElement(NewCustomerForm, { onConfirm() {}, onCancel() {} })
  );
  assert.match(markup, /ชื่อลูกค้า/);
  assert.match(markup, /เบอร์โทรศัพท์/);
  assert.match(markup, /อีเมล/);
  assert.match(markup, /autofocus=""/);
  assert.match(markup, /<button/);
});

test('H: NewCustomerSummaryCard clearly marks the customer as new/unsaved for screen readers too (plain text, not just color)', () => {
  const markup = renderToStaticMarkup(
    createElement(NewCustomerSummaryCard, {
      customer: newCustomer,
      onChangeCustomer() {},
    })
  );
  assert.match(markup, /ลูกค้าใหม่/);
  assert.match(markup, /Walk-in/);
});

test('H: RegisterProductForm warranty control uses a native, labelled radio group (fieldset/legend), not a custom widget', () => {
  const markup = renderToStaticMarkup(
    createElement(RegisterProductForm, { onRegister() {}, onCancel() {} })
  );
  assert.match(markup, /<fieldset/);
  assert.match(markup, /<legend/);
  assert.match(markup, /type="radio"/);
  assert.match(markup, /name="register-product-warranty"/g);
});

test('P1#1: RegisterProductForm renders both warranty radios unchecked, and never tells staff to use out_of_warranty when unknown', () => {
  const markup = renderToStaticMarkup(
    createElement(RegisterProductForm, { onRegister() {}, onCancel() {} })
  );
  assert.doesNotMatch(markup, /checked=""/);
  // The removed copy instructed staff to record a false warranty state when
  // the real one was unknown.
  assert.doesNotMatch(markup, /หากไม่ทราบสถานะการรับประกัน/);
  assert.doesNotMatch(markup, /ไม่ทราบ/);
  assert.match(markup, /กรุณาตรวจสอบสถานะการรับประกันจริง/);
});

test('H: SearchNoResults offers a live "+ New Customer" action unconditionally (F5d-65 activates it in every backend mode)', () => {
  const markup = renderToStaticMarkup(
    createElement(SearchNoResults, { query: 'ไม่พบ', onCreateNew() {} })
  );
  assert.match(markup, /สร้างลูกค้าใหม่/);
  assert.doesNotMatch(markup, /ยังไม่รองรับในโหมดนี้/);
});
