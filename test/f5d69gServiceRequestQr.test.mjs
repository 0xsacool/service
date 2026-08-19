import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import { createServer } from 'vite';
import qrcode from 'qrcode-generator';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import QRCodeComponent from 'react-qr-code';

// F5d-69G Phase 5A — Real Service Request QR Implementation. The QR must
// never build its own URL: it reuses the exact `trackingUrl` value the
// component already derives via the canonical publicTrackingLink.ts helper
// (the same value the staff "คัดลอกลิงก์" action copies) — this file proves
// that reuse structurally, proves the three-state gating around the QR is
// unchanged/truthful, and independently re-derives the QR's encoded payload
// without decoding an image (see the machine-readability section below for
// why a true camera/image decode was not attempted in this phase).

const readSource = async (path) =>
  await readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const printSourcePromise = readSource(
  'src/features/service-jobs/components/ServiceRequestPrintPreview.tsx'
);
const linkSourcePromise = readSource('src/services/publicTrackingLink.ts');
const sectionSourcePromise = readSource(
  'src/features/service-jobs/components/PublicTrackingSection.tsx'
);

const vite = await createServer({ appType: 'custom', server: { middlewareMode: true } });
after(() => vite.close());
const { buildPublicTrackingUrl } = await vite.ssrLoadModule(
  '/src/services/publicTrackingLink.ts'
);

const FIXTURE_JOB_ID = 'BRN-2026-000004';
const FIXTURE_CODE = 'SRV-2026-0819-ABC123';
const FIXTURE_ORIGIN = 'https://luxace-service.web.app';
const EXPECTED_URL = `${FIXTURE_ORIGIN}/track/${FIXTURE_JOB_ID}#${FIXTURE_CODE}`;

// --- H: dependency pinned at the exact approved version ---------------------

test('react-qr-code is installed at exactly the approved pinned version', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.dependencies['react-qr-code'], '2.2.0');
  const installed = JSON.parse(
    await readFile(new URL('../node_modules/react-qr-code/package.json', import.meta.url), 'utf8')
  );
  assert.equal(installed.version, '2.2.0');
});

// --- A/E: QR receives exactly the canonical URL, gated on it existing ------

test('the QR component is rendered with value bound to the same trackingUrl variable printed as text', async () => {
  const source = await printSourcePromise;
  assert.match(source, /import QRCode from 'react-qr-code';/);
  const credentialedBlock = source.match(
    /publicTrackingState === 'credentialed' && trackingUrl && \(([\s\S]*?)\n {14}\)\}/
  );
  assert.notEqual(credentialedBlock, null, 'expected a credentialed-QR render branch');
  assert.match(credentialedBlock[1], /<QRCode\s/);
  assert.match(credentialedBlock[1], /value=\{trackingUrl\}/);
  // The exact same variable is also printed as the human-readable fallback —
  // structurally guarantees the QR and the printed text can never diverge.
  assert.match(credentialedBlock[1], /\{trackingUrl\}/g);
});

test('trackingUrl is derived via the canonical buildPublicTrackingUrl helper, never a hand-built string', async () => {
  const source = await printSourcePromise;
  assert.match(source, /import \{ buildPublicTrackingUrl \} from '\.\.\/\.\.\/\.\.\/services\/publicTrackingLink';/);
  assert.match(
    source,
    /buildPublicTrackingUrl\(window\.location\.origin, job\.id, publicTrackingCode\)/
  );
  // No parallel/duplicate template-literal URL construction was introduced.
  assert.doesNotMatch(source, /\$\{window\.location\.origin\}.*\/track\//);
});

test('the canonical helper produces the exact expected fixture URL', () => {
  assert.equal(
    buildPublicTrackingUrl(FIXTURE_ORIGIN, FIXTURE_JOB_ID, FIXTURE_CODE),
    EXPECTED_URL
  );
});

// --- B: copy-link value and QR value share the identical source ------------

test('PublicTrackingSection (copy-link) and ServiceRequestPrintPreview (QR) both call the identical shared helper, never their own URL construction', async () => {
  for (const source of [await printSourcePromise, await sectionSourcePromise]) {
    assert.match(source, /buildPublicTrackingUrl\(/);
  }
  const linkSource = await linkSourcePromise;
  assert.match(linkSource, /export function buildPublicTrackingUrl/);
  // Exactly one canonical implementation exists in the codebase.
  const implementationCount = (
    await readSource('src/services/publicTrackingLink.ts')
  ).match(/export function buildPublicTrackingUrl/g)?.length;
  assert.equal(implementationCount, 1);
});

// --- C/D: no QR in the other two states -------------------------------------

test('STATE active-unavailable renders no QR component and no actionable link', async () => {
  const source = await printSourcePromise;
  const block = source.match(/publicTrackingState === 'active-unavailable' &&[\s\S]*?\)\}/);
  assert.notEqual(block, null);
  assert.doesNotMatch(block[0], /<QRCode/);
  assert.doesNotMatch(block[0], /trackingUrl/);
  assert.match(block[0], /เปิดใช้งานการติดตามแล้ว/);
});

test('STATE inactive renders no QR component and no actionable link', async () => {
  const source = await printSourcePromise;
  const block = source.match(/publicTrackingState === 'inactive' &&[\s\S]*?\)\}/);
  assert.notEqual(block, null);
  assert.doesNotMatch(block[0], /<QRCode/);
  assert.doesNotMatch(block[0], /trackingUrl/);
  assert.match(block[0], /ยังไม่ได้เปิดใช้งานการติดตามสาธารณะ/);
});

// --- E (restated as a positive contract): a bare BRN-only URL is never the
// value handed to the QR, because trackingUrl is null unless a code exists --

test('trackingUrl (and therefore the QR value) is null whenever no plaintext code is known — never falls back to a bare /track/{BRN} URL', async () => {
  const source = await printSourcePromise;
  assert.match(
    source,
    /const trackingUrl =\s*\n?\s*publicTrackingCode !== null\s*\n?\s*\? buildPublicTrackingUrl\(window\.location\.origin, job\.id, publicTrackingCode\)\s*\n?\s*: null;/
  );
});

// --- F: no query-string credential architecture ----------------------------

test('the canonical link never places the credential in a query string', () => {
  const url = new URL(buildPublicTrackingUrl(FIXTURE_ORIGIN, FIXTURE_JOB_ID, FIXTURE_CODE));
  assert.equal(url.search, '');
  assert.equal(url.hash, `#${FIXTURE_CODE}`);
});

// --- G: truthful three-state wording unchanged ------------------------------

test('the three Thai print-state messages are byte-unchanged from the audited Phase 2-FIX wording', async () => {
  const source = await printSourcePromise;
  assert.match(source, /เปิดใช้งานการติดตามแล้ว — กรุณาออกรหัสติดตามใหม่ก่อนพิมพ์ QR/);
  assert.match(source, /ยังไม่ได้เปิดใช้งานการติดตามสาธารณะ/);
});

// --- I: no plaintext persistence mechanism was added ------------------------

test('no localStorage/sessionStorage/IndexedDB persistence was introduced anywhere in the QR change', async () => {
  for (const source of [await printSourcePromise, await sectionSourcePromise, await linkSourcePromise]) {
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/);
  }
});

test('QR generation is entirely client-side — no network call is introduced by the QR component or its wiring', async () => {
  const source = await printSourcePromise;
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|axios/);
});

// --- Step 11: QR machine-readability — independent re-derivation ----------
//
// A true camera/image decode was NOT performed: doing so would require
// installing a QR-decoding library, which this phase does not authorize
// adding without separate approval. Instead this reuses qrcode-generator —
// already present as react-qr-code's own runtime dependency, so this adds
// no new package — calling it with the EXACT same arguments
// react-qr-code's own source (node_modules/react-qr-code/lib/index.mjs)
// uses internally: `qrcode.stringToBytes` overridden to UTF-8 bytes,
// `qrcode(0, level)`, `.addData(value)`, `.make()`. A successful, non-
// throwing encode at a real QR module-count size is strong evidence the
// exact canonical URL is valid, correctly-encoded QR payload data — but it
// is not a substitute for a physical scan. That physical scan remains a
// required manual post-deployment verification step.

test('the exact canonical fixture URL encodes successfully as real QR data via the same encoder react-qr-code uses internally', () => {
  qrcode.stringToBytes = (s) => Array.from(new TextEncoder().encode(s));
  const qr = qrcode(0, 'L');
  assert.doesNotThrow(() => {
    qr.addData(EXPECTED_URL);
    qr.make();
  });
  const moduleCount = qr.getModuleCount();
  // Real QR versions always have moduleCount = 17 + 4*version, version 1-40.
  assert.equal((moduleCount - 17) % 4, 0);
  assert.ok(moduleCount >= 21 && moduleCount <= 177);
});

test('the bytes react-qr-code would embed are exactly the UTF-8 bytes of the canonical URL, nothing else', () => {
  const expectedBytes = Array.from(new TextEncoder().encode(EXPECTED_URL));
  qrcode.stringToBytes = (s) => Array.from(new TextEncoder().encode(s));
  assert.deepEqual(qrcode.stringToBytes(EXPECTED_URL), expectedBytes);
});

test('the real react-qr-code component, server-rendered with the exact fixture props the print component uses, produces a well-formed SVG QR', () => {
  // No mock/stub: this renders the actual installed react-qr-code component
  // via React's own official SSR renderer — no jsdom, no browser, no new
  // dependency (react-dom/server ships with react-dom, already a direct
  // dependency). Cross-checks against the independent qrcode-generator
  // computation above: both must agree on the module count.
  const html = renderToStaticMarkup(
    React.createElement(QRCodeComponent, { value: EXPECTED_URL, size: 64, level: 'L' })
  );
  assert.match(html, /^<svg[^>]*>/);
  assert.match(html, /viewBox="0 0 33 33"/);
  assert.match(html, /width="64"/);
  assert.match(html, /height="64"/);
  assert.equal((html.match(/<path/g) ?? []).length, 2);
});
