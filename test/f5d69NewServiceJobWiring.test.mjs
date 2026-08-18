import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

// F5d-69 Phase 2B-FIX — closes the two test-coverage gaps the Phase 2B-R
// source-freeze audit found: NewServiceJob.tsx's derived-channel-prefill and
// reset wiring had no direct test (only the pure functions it calls were
// tested in isolation), and the channel picker's re-click-to-deselect
// behavior had no coverage in either component that implements it. Follows
// the source-structural assertion convention established for this same
// component family (test/f5d69Components.test.mjs, test/serviceRequestPrint.test.mjs)
// — no jsdom/testing-library is installed in this project, so React
// wiring that can't be unit-tested through a pure function is proven here
// as a source-order/presence assertion instead. No implementation file was
// changed to make any of this easier to assert.

const readSource = async (path) =>
  await readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const newServiceJobSourcePromise = readSource(
  'src/features/service-jobs/pages/NewServiceJob.tsx'
);

function extractFunctionBody(source, signaturePattern) {
  const match = source.match(signaturePattern);
  assert.notEqual(match, null, `expected to find a function matching ${signaturePattern}`);
  return match[1];
}

// --- 2. Existing customer prefill wiring ------------------------------------

test('customer-history scoping: selectExistingCustomer filters serviceJobs to the selected customer via canonical-phone matching before deriving a channel', async () => {
  const source = await newServiceJobSourcePromise;
  const body = extractFunctionBody(
    source,
    /const selectExistingCustomer = \(customer: CustomerSearchResult\) => \{([\s\S]*?)\n  \};/
  );
  // The exact predicate must compare each job's own customerPhone,
  // normalized, against the selected customer's own normalized phone — not
  // some other field, and not an unconditional true.
  assert.match(
    body,
    /serviceJobs\.filter\(\(job\) => normalizeCanonicalPhone\(job\.customerPhone\) === phone\)/,
    'expected serviceJobs to be filtered by canonical-phone match against the selected customer'
  );
});

test('derived-channel wiring: the canonical-phone-filtered jobs (not the unfiltered brand-wide list) are what gets passed into mostRecentJobWithContactChannel', async () => {
  const source = await newServiceJobSourcePromise;
  const body = extractFunctionBody(
    source,
    /const selectExistingCustomer = \(customer: CustomerSearchResult\) => \{([\s\S]*?)\n  \};/
  );
  // Regression guard: this specifically fails if a future change passes the
  // bare `serviceJobs` array (every brand job, every customer) instead of
  // its filtered result — the `.filter(` must appear directly inside the
  // mostRecentJobWithContactChannel(...) call, not merely somewhere in the
  // function.
  assert.match(
    body,
    /mostRecentJobWithContactChannel\(\s*serviceJobs\.filter\(/,
    'expected mostRecentJobWithContactChannel to be called with the .filter(...) result directly, not the unfiltered serviceJobs list'
  );
});

test('derived-channel wiring: prefill updates only contactChannel and contactChannelIdentity, preserving the rest of the current intake via the existing spread', async () => {
  const source = await newServiceJobSourcePromise;
  const body = extractFunctionBody(
    source,
    /const selectExistingCustomer = \(customer: CustomerSearchResult\) => \{([\s\S]*?)\n  \};/
  );
  const prefillBlock = body.match(
    /if \(priorJob\?\.contactChannel\) \{([\s\S]*?)\n {4}\}/
  );
  assert.notEqual(prefillBlock, null, 'expected an "if (priorJob?.contactChannel)" prefill block');
  const setIntakeCall = prefillBlock[1];
  assert.match(setIntakeCall, /\.\.\.current,/, 'expected the rest of the current intake to be spread in, not replaced');
  assert.match(setIntakeCall, /contactChannel: priorJob\.contactChannel,/);
  assert.match(setIntakeCall, /contactChannelIdentity: priorJob\.contactChannelIdentity \?\? '',/);
  // Must NOT inject or reset any of the other six F5d-69 intake fields as
  // part of a channel prefill — those stay whatever the (already-reset,
  // per changeCustomer) current draft has.
  for (const field of [
    'orderNumber:',
    'orderVerification:',
    'purchaseDate:',
    'orderDeliveredDate:',
    'externalEvidenceUrl:',
    'externalEvidenceNote:',
  ]) {
    assert.doesNotMatch(
      setIntakeCall,
      new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `prefill must not set ${field} — only contactChannel/contactChannelIdentity`
    );
  }
});

// --- 3. Reset wiring ---------------------------------------------------------

test('intake reset wiring: changeCustomer resets the full intake draft via setIntake(createEmptyServiceIntake())', async () => {
  const source = await newServiceJobSourcePromise;
  const body = extractFunctionBody(source, /const changeCustomer = \(\) => \{([\s\S]*?)\n {2}\};/);
  assert.match(body, /setIntake\(createEmptyServiceIntake\(\)\)/);
});

test('intake reset wiring: changeProduct resets the full intake draft via setIntake(createEmptyServiceIntake())', async () => {
  const source = await newServiceJobSourcePromise;
  const body = extractFunctionBody(source, /const changeProduct = \(\) => \{([\s\S]*?)\n {2}\};/);
  assert.match(body, /setIntake\(createEmptyServiceIntake\(\)\)/);
});

test('intake reset wiring: startNewServiceJob resets the full intake draft via setIntake(createEmptyServiceIntake())', async () => {
  const source = await newServiceJobSourcePromise;
  const body = extractFunctionBody(
    source,
    /const startNewServiceJob = \(\) => \{([\s\S]*?)\n {2}\};/
  );
  assert.match(body, /setIntake\(createEmptyServiceIntake\(\)\)/);
});

// --- 4. Save validation order -------------------------------------------------

test('validation ordering: handleSaveAndPrint checks photos, then serviceIntakeMetadataError, then the whole-request byte limit, in that order', async () => {
  const source = await newServiceJobSourcePromise;
  const body = extractFunctionBody(
    source,
    /const handleSaveAndPrint = async \(\) => \{([\s\S]*?)\n {2}\};/
  );
  const photoIndex = body.indexOf('validatePhotosForSubmission(intake.photos)');
  const metadataIndex = body.indexOf('serviceIntakeMetadataError(intake)');
  const byteLimitIndex = body.indexOf('estimateIntakeRequestBytes(intakePayload, customerSelector)');
  assert.equal(photoIndex >= 0, true, 'expected the F5d-67 photo validation check');
  assert.equal(metadataIndex >= 0, true, 'expected the F5d-69 metadata validation check');
  assert.equal(byteLimitIndex >= 0, true, 'expected the F5d-67 whole-request byte-limit check');
  assert.equal(
    photoIndex < metadataIndex,
    true,
    'photo validation (F5d-67) must run before F5d-69 metadata validation'
  );
  assert.equal(
    metadataIndex < byteLimitIndex,
    true,
    'F5d-69 metadata validation must run before the whole-request byte-limit gate, so an invalid date/URL is caught before that more expensive check'
  );
});

test('validation ordering: an invalid metadata state returns early, never reaching createServiceJob', async () => {
  const source = await newServiceJobSourcePromise;
  const body = extractFunctionBody(
    source,
    /const handleSaveAndPrint = async \(\) => \{([\s\S]*?)\n {2}\};/
  );
  const metadataBlock = body.match(
    /const metadataError = serviceIntakeMetadataError\(intake\);\s*\n\s*if \(metadataError\) \{([\s\S]*?)\n {4}\}/
  );
  assert.notEqual(metadataBlock, null, 'expected an "if (metadataError)" early-return block');
  assert.match(metadataBlock[1], /return;/);
});

test('F5d-67 request-size protection is preserved: MAX_INTAKE_REQUEST_SAFE_BYTES still gates the estimateIntakeRequestBytes comparison', async () => {
  const source = await newServiceJobSourcePromise;
  assert.match(
    source,
    /estimateIntakeRequestBytes\(intakePayload, customerSelector\) > MAX_INTAKE_REQUEST_SAFE_BYTES/
  );
});

// --- 5. Channel re-click deselect (both components) --------------------------

test('intake channel deselect: ContactOrderMetadataSection\'s channel picker supports re-click-to-clear (selecting the already-selected channel sets it back to null)', async () => {
  const source = await readSource(
    'src/features/service-jobs/components/ContactOrderMetadataSection.tsx'
  );
  const setChannelCall = source.match(/onClick=\{\(\) => setChannel\(([^)]*)\)\}/);
  assert.notEqual(setChannelCall, null, 'expected the channel button\'s onClick to call setChannel(...)');
  assert.match(
    setChannelCall[1],
    /isSelected\s*\?\s*null\s*:\s*channel/,
    'expected re-clicking the selected channel to pass null (clear), not the same channel again — otherwise this degrades into a non-clearable radio-style picker'
  );
});

test('details channel deselect: ServiceEventMetadataEditSection\'s channel picker supports the same re-click-to-clear behavior', async () => {
  const source = await readSource(
    'src/features/service-jobs/components/ServiceEventMetadataEditSection.tsx'
  );
  const setChannelCall = source.match(/onClick=\{\(\) => setChannel\(([^)]*)\)\}/);
  assert.notEqual(setChannelCall, null, 'expected the channel button\'s onClick to call setChannel(...)');
  assert.match(
    setChannelCall[1],
    /isSelected\s*\?\s*null\s*:\s*channel/,
    'expected re-clicking the selected channel to pass null (clear), not the same channel again — otherwise this degrades into a non-clearable radio-style picker'
  );
});

test('both channel pickers clear contactChannelIdentity in the same setChannel handler that owns the deselect logic', async () => {
  // Cross-check against the invariant already covered by
  // test/f5d69Components.test.mjs, from the deselect angle specifically:
  // re-clicking to null must flow through the SAME handler that also clears
  // identity, not a separate, potentially-forgotten code path.
  const intakeSource = await readSource(
    'src/features/service-jobs/components/ContactOrderMetadataSection.tsx'
  );
  const detailsSource = await readSource(
    'src/features/service-jobs/components/ServiceEventMetadataEditSection.tsx'
  );
  for (const source of [intakeSource, detailsSource]) {
    const setChannelFn = source.match(/const setChannel = \(channel: ChannelId \| null\) => \{([\s\S]*?)\n  \};/);
    assert.notEqual(setChannelFn, null);
    assert.match(setChannelFn[1], /contactChannel: channel,/);
    assert.match(
      setChannelFn[1],
      /channel === null \|\| channel === 'phone' \? '' : value\.contactChannelIdentity/
    );
  }
});
