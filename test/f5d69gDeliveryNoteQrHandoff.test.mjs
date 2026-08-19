import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import QRCodeComponent from 'react-qr-code';

// F5d-69G Phase 7A — the "พิมพ์ใบนำส่ง" button on an existing Service Job's
// details page is a LOCAL RENDER TOGGLE (showDeliveryNotePreview), not a
// route change: PublicTrackingSection unmounts and DeliveryNotePrintPreview
// mounts within the same ServiceJobDetailsView instance. The bug was that
// PublicTrackingSection's freshly-issued plaintext SRV (its own local state)
// was never lifted to that shared parent, so DeliveryNotePrintPreview's
// already-existing (but always-undefined) publicTrackingCode prop could
// never receive it. This file proves the fix: the parent now owns the code
// via PublicTrackingSection's existing onIssued callback and threads it
// through to DeliveryNotePrintPreview, which now renders a real QR built
// from the exact same canonical helper every other tracking surface uses.

const readSource = async (path) =>
  await readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const detailsSourcePromise = readSource(
  'src/features/service-jobs/pages/ServiceJobDetails.tsx'
);
const noteSourcePromise = readSource(
  'src/features/service-jobs/components/DeliveryNotePrintPreview.tsx'
);

const vite = await createServer({ appType: 'custom', server: { middlewareMode: true } });
after(() => vite.close());
const { buildPublicTrackingUrl } = await vite.ssrLoadModule(
  '/src/services/publicTrackingLink.ts'
);

const FIXTURE_JOB_ID = 'BRN-2026-000007';
const FIXTURE_CODE = 'SRV-2026-0819-ABC123';
const FIXTURE_ORIGIN = 'https://luxace-service.web.app';
const EXPECTED_URL = `${FIXTURE_ORIGIN}/track/${FIXTURE_JOB_ID}#${FIXTURE_CODE}`;

// --- A/B/C: the in-memory handoff itself ------------------------------------

test('ServiceJobDetailsView holds the issued plaintext code in its own local state, never from job/Firestore', async () => {
  const source = await detailsSourcePromise;
  assert.match(
    source,
    /const \[issuedTrackingCode, setIssuedTrackingCode\] = useState<string \| null>\(null\);/
  );
});

test('PublicTrackingSection\'s existing onIssued callback is wired to that parent state (was previously unwired)', async () => {
  const source = await detailsSourcePromise;
  const sectionCall = source.match(/<PublicTrackingSection\s+([\s\S]*?)\/>/);
  assert.notEqual(sectionCall, null, 'expected a PublicTrackingSection render call');
  assert.match(sectionCall[1], /onIssued=\{setIssuedTrackingCode\}/);
});

test('the delivery-note print branch receives the exact same lifted state as publicTrackingCode', async () => {
  const source = await detailsSourcePromise;
  const printCall = source.match(/<DeliveryNotePrintPreview\s+([\s\S]*?)\/>/);
  assert.notEqual(printCall, null, 'expected a DeliveryNotePrintPreview render call');
  assert.match(printCall[1], /publicTrackingCode=\{issuedTrackingCode \?\? undefined\}/);
});

test('the print toggle is a local render swap, not a router navigation — no navigate() call is involved in reaching it', async () => {
  const source = await detailsSourcePromise;
  const buttonBlock = source.match(
    /onClick=\{\(\) => setShowDeliveryNotePreview\(true\)\}/
  );
  assert.notEqual(buttonBlock, null);
  // The branch that actually renders the print preview is a plain
  // conditional `if (showDeliveryNotePreview) return (...)`, not a route.
  assert.match(source, /if \(showDeliveryNotePreview\) \{/);
  assert.doesNotMatch(source, /navigate\([^)]*deliver/i);
});

// --- D: canonical QR value, byte-for-byte identical to every other surface --

test('DeliveryNotePrintPreview builds its QR value via the same canonical buildPublicTrackingUrl helper, never a hand-built string', async () => {
  const source = await noteSourcePromise;
  assert.match(
    source,
    /import \{ buildPublicTrackingUrl \} from '\.\.\/\.\.\/\.\.\/services\/publicTrackingLink';/
  );
  assert.match(
    source,
    /buildPublicTrackingUrl\(window\.location\.origin, job\.id, publicTrackingCode\)/
  );
  assert.doesNotMatch(source, /\$\{window\.location\.origin\}.*\/track\//);
});

test('the canonical helper produces the exact expected fixture URL for BRN-2026-000007', () => {
  assert.equal(
    buildPublicTrackingUrl(FIXTURE_ORIGIN, FIXTURE_JOB_ID, FIXTURE_CODE),
    EXPECTED_URL
  );
});

test('the real react-qr-code component, server-rendered with the delivery note\'s exact fixture props, produces a well-formed SVG QR encoding the canonical URL', () => {
  const html = renderToStaticMarkup(
    React.createElement(QRCodeComponent, { value: EXPECTED_URL, size: 64, level: 'L' })
  );
  assert.match(html, /^<svg[^>]*>/);
  assert.match(html, /width="64"/);
  assert.match(html, /height="64"/);
  assert.equal((html.match(/<path/g) ?? []).length, 2);
});

// --- Three-state contract, mirrored from ServiceRequestPrintPreview ---------

test('DeliveryNotePrintPreview: credentialed state renders the QR only when a plaintext code is actually present', async () => {
  const source = await noteSourcePromise;
  assert.match(
    source,
    /publicTrackingState === 'credentialed' && trackingUrl && \(/
  );
});

test('DeliveryNotePrintPreview: active-unavailable state is distinct from inactive — "no code in hand" never prints as "not activated"', async () => {
  const source = await noteSourcePromise;
  assert.match(
    source,
    /publicTrackingState: 'credentialed' \| 'active-unavailable' \| 'inactive' =\s*\n\s*publicTrackingCode != null\s*\n\s*\? 'credentialed'\s*\n\s*: job\.publicTrackingCodeHash !== null\s*\n\s*\? 'active-unavailable'\s*\n\s*: 'inactive';/
  );
  assert.match(source, /เปิดใช้งานการติดตามแล้ว — กรุณาออกรหัสติดตามใหม่ก่อนพิมพ์ QR/);
  assert.match(source, /ยังไม่ได้เปิดใช้งานการติดตามสาธารณะ/);
});

test('trackingUrl (and therefore the QR value) is null whenever no plaintext code is known — never falls back to a bare /track/{BRN} URL', async () => {
  const source = await noteSourcePromise;
  assert.match(
    source,
    /const trackingUrl =\s*\n\s*publicTrackingCode != null\s*\n\s*\? buildPublicTrackingUrl\(window\.location\.origin, job\.id, publicTrackingCode\)\s*\n\s*: null;/
  );
});

// --- E: printing never triggers a new issuance -------------------------------

test('DeliveryNotePrintPreview never calls or receives an issuance function — printing cannot itself issue/rotate a credential', async () => {
  const source = await noteSourcePromise;
  assert.doesNotMatch(source, /onIssue|issuePublicTrackingCode/);
});

// --- F: refresh/new-session semantics ----------------------------------------

test('issuedTrackingCode has no persisted source — it is only ever set by the onIssued callback, defaulting to null on every fresh mount', async () => {
  const source = await detailsSourcePromise;
  // The ONLY writer of this state is the onIssued callback wired above;
  // there is no read from claim/job, localStorage, or any other source.
  const setterUsages = source.match(/setIssuedTrackingCode/g) ?? [];
  assert.equal(setterUsages.length, 2, 'expected exactly the declaration + the one onIssued wiring');
});

// --- G/H: no persistence, no query-string/path credential --------------------

test('no localStorage/sessionStorage/IndexedDB/cookie persistence was introduced by this change', async () => {
  for (const source of [await detailsSourcePromise, await noteSourcePromise]) {
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|document\.cookie/);
  }
});

test('the canonical link never places the credential in a query string or the URL path', () => {
  const url = new URL(buildPublicTrackingUrl(FIXTURE_ORIGIN, FIXTURE_JOB_ID, FIXTURE_CODE));
  assert.equal(url.search, '');
  assert.equal(url.hash, `#${FIXTURE_CODE}`);
  assert.doesNotMatch(url.pathname, new RegExp(FIXTURE_CODE));
});
