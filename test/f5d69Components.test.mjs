import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

// F5d-69 Phase 2B — source-structural regression coverage for the intake
// and Service Job Details metadata components, following the same
// convention test/serviceRequestPrint.test.mjs established (no jsdom/
// testing-library in this project, so React behavior that can't be proven
// via the pure logic modules — test/f5d69Frontend.test.mjs — is proven here
// as a source-order/presence assertion instead).

const readSource = async (path) =>
  await readFile(new URL(`../${path}`, import.meta.url), 'utf8');

let failures = 0;
function check(name, value) {
  if (value) return;
  failures += 1;
  console.error(`  FAIL  ${name}`);
}

// --- ContactOrderMetadataSection (intake) -----------------------------------

const contactOrderSourcePromise = readSource(
  'src/features/service-jobs/components/ContactOrderMetadataSection.tsx'
);

test('intake: selecting the null/phone channel clears contactChannelIdentity live, in the same handler', async () => {
  const source = await contactOrderSourcePromise;
  const setChannel = source.match(/const setChannel = \(channel: ChannelId \| null\) => \{([\s\S]*?)\n  \};/);
  assert.notEqual(setChannel, null, 'expected a setChannel handler');
  assert.match(setChannel[1], /channel === null \|\| channel === 'phone' \? '' : value\.contactChannelIdentity/);
});

test('intake: contactChannelIdentity input has a 120-character maxLength', async () => {
  const source = await contactOrderSourcePromise;
  assert.match(source, /maxLength=\{120\}/);
});

test('intake: orderNumber input has a 64-character maxLength', async () => {
  const source = await contactOrderSourcePromise;
  assert.match(source, /maxLength=\{64\}/);
});

test('intake: both date inputs are native type="date" (project-standard YYYY-MM-DD)', async () => {
  const source = await contactOrderSourcePromise;
  const dateInputs = (source.match(/type="date"/g) ?? []).length;
  assert.equal(dateInputs, 2);
});

test('intake: channel is presented as an optional/recommended field, not required', async () => {
  const source = await contactOrderSourcePromise;
  assert.match(source, /subtitle="ไม่บังคับ แต่แนะนำให้บันทึก"/);
});

// --- ExternalEvidenceSection (intake) ---------------------------------------

const evidenceSourcePromise = readSource(
  'src/features/service-jobs/components/ExternalEvidenceSection.tsx'
);

test('intake evidence section never uses dangerouslySetInnerHTML', async () => {
  const source = await evidenceSourcePromise;
  assert.doesNotMatch(source, /dangerouslySetInnerHTML=/);
});

test('intake evidence URL input has a 2048-character maxLength and https-only validation', async () => {
  const source = await evidenceSourcePromise;
  assert.match(source, /maxLength=\{2048\}/);
  assert.match(source, /isValidHttpsUrl/);
});

test('intake evidence note input has a 1000-character maxLength', async () => {
  const source = await evidenceSourcePromise;
  assert.match(source, /maxLength=\{1000\}/);
});

// --- ServiceEventMetadataEditSection (Service Job Details) ------------------

const detailsSourcePromise = readSource(
  'src/features/service-jobs/components/ServiceEventMetadataEditSection.tsx'
);

test('Details: the saved evidence URL renders as a real link with target="_blank" rel="noopener noreferrer"', async () => {
  const source = await detailsSourcePromise;
  assert.match(source, /target="_blank"\s*\n\s*rel="noopener noreferrer"/);
});

test('Details: the evidence link is only rendered when the URL is non-blank and passes https validation (canPreviewUrl)', async () => {
  const source = await detailsSourcePromise;
  assert.match(source, /const canPreviewUrl = trimmedUrl !== '' && !urlError;/);
  assert.match(source, /\{canPreviewUrl && \(/);
});

test('Details never uses dangerouslySetInnerHTML', async () => {
  const source = await detailsSourcePromise;
  assert.doesNotMatch(source, /dangerouslySetInnerHTML=/);
});

test('Details: order verification control is shown only when an order number is present (showVerification)', async () => {
  const source = await detailsSourcePromise;
  assert.match(source, /const showVerification = value\.orderNumber\.trim\(\) !== '';/);
});

test('Details: setOrderNumber defaults verification to unverified only when it was previously null, and clears it when order number becomes blank', async () => {
  const source = await detailsSourcePromise;
  const setOrderNumber = source.match(/const setOrderNumber = \(orderNumber: string\) => \{([\s\S]*?)\n  \};/);
  assert.notEqual(setOrderNumber, null, 'expected a setOrderNumber handler');
  assert.match(
    setOrderNumber[1],
    /orderNumber\.trim\(\) === '' \? null : \(value\.orderVerification \?\? 'unverified'\)/
  );
});

test('Details: selecting the null/phone channel clears contactChannelIdentity live, same as intake', async () => {
  const source = await detailsSourcePromise;
  const setChannel = source.match(/const setChannel = \(channel: ChannelId \| null\) => \{([\s\S]*?)\n  \};/);
  assert.notEqual(setChannel, null, 'expected a setChannel handler');
  assert.match(setChannel[1], /channel === null \|\| channel === 'phone' \? '' : value\.contactChannelIdentity/);
});

test('Details: all eight F5d-69 fields have an editable control in the component', async () => {
  const source = await detailsSourcePromise;
  for (const marker of [
    'contactChannel',
    'contactChannelIdentity',
    'orderNumber',
    'orderVerification',
    'purchaseDate',
    'orderDeliveredDate',
    'externalEvidenceUrl',
    'externalEvidenceNote',
  ]) {
    check(`"${marker}" is referenced in the edit section`, source.includes(marker));
  }
});

console.log(`\nf5d69Components: ${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
if (failures > 0) process.exit(1);
