import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', server: { middlewareMode: true } });
after(() => vite.close());

const {
  PUBLIC_TRACKING_CODE_SUFFIX_SPACE,
  PublicTrackingCodeCollisionError,
  generateAvailablePublicTrackingCode,
  generatePublicTrackingCode,
  hashPublicTrackingCode,
  isValidPublicTrackingCode,
  normalizePublicTrackingCodeInput,
  parsePublicTrackingCode,
} = await vite.ssrLoadModule('/src/services/publicTrackingCode.ts');
const { preparePublicTrackingCodeIssuance } = await vite.ssrLoadModule(
  '/src/services/publicTrackingCodeIssuance.ts'
);

function deterministicRandomBytes(values) {
  const remaining = [...values];
  return (length) => Uint8Array.from({ length }, () => remaining.shift() ?? 0);
}

test('public tracking code has the approved date and six-character format', () => {
  const code = generatePublicTrackingCode(
    new Date(2026, 7, 10),
    deterministicRandomBytes([0, 1, 2, 3, 4, 5])
  );
  assert.match(code, /^SRV-2026-0810-[0-9A-Z]{6}$/);
  assert.equal(code.slice(-6), '012345');
  assert.equal(PUBLIC_TRACKING_CODE_SUFFIX_SPACE, 36 ** 6);
});

test('generation fails closed for invalid or non-four-digit dates', () => {
  assert.throws(() => generatePublicTrackingCode(new Date('invalid')), RangeError);
  assert.throws(
    () => generatePublicTrackingCode(new Date('0999-01-01T00:00:00.000Z')),
    RangeError
  );
});

test('generation uses injectable secure randomness and never Math.random', async () => {
  const source = await readFile(
    new URL('../src/services/publicTrackingCode.ts', import.meta.url),
    'utf8'
  );
  assert.match(source, /crypto\.getRandomValues/);
  assert.doesNotMatch(source, /Math\.random/);
  const code = generatePublicTrackingCode(
    new Date(2026, 7, 10),
    deterministicRandomBytes([35, 34, 33, 32, 31, 30])
  );
  assert.equal(code.slice(-6), 'ZYXWVU');
});

test('normalization accepts an unambiguous pasted compact code', () => {
  assert.equal(
    normalizePublicTrackingCodeInput(' srv20260810k7m2qx '),
    'SRV-2026-0810-K7M2QX'
  );
  assert.equal(
    normalizePublicTrackingCodeInput('srv-2026-0810-k7m2qx'),
    'SRV-2026-0810-K7M2QX'
  );
});

test('parser rejects malformed, partial, lowercase, and impossible dates', () => {
  for (const value of [
    '',
    'SRV-2026-0810-K7M2Q',
    'SRV-2026-0810-K7M2QX7',
    'srv-2026-0810-K7M2QX',
    'SRV-2026-0231-K7M2QX',
    'BRN-2026-0810-K7M2QX',
  ]) {
    assert.equal(parsePublicTrackingCode(value), null);
    assert.equal(isValidPublicTrackingCode(value), false);
  }
});

test('collision check regenerates and accepts the first free code', async () => {
  const checked = [];
  const first = 'SRV-2026-0810-012345';
  const second = 'SRV-2026-0810-6789AB';
  const random = deterministicRandomBytes([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  const code = await generateAvailablePublicTrackingCode(
    new Date(2026, 7, 10),
    {
      async exists(candidate) {
        checked.push(candidate);
        return candidate === first;
      },
    },
    random
  );
  assert.equal(code, second);
  assert.deepEqual(checked, [first, second]);
});

test('collision retry exhaustion fails closed at the bounded limit', async () => {
  await assert.rejects(
    generateAvailablePublicTrackingCode(
      new Date(2026, 7, 10),
      {
        async exists() {
          return true;
        },
      },
      deterministicRandomBytes(Array.from({ length: 40 }, (_, index) => index)),
      3
    ),
    PublicTrackingCodeCollisionError
  );
});

test('public code hash is stable, one-way, and distinct from the raw code', async () => {
  const code = 'SRV-2026-0810-K7M2QX';
  const hash = await hashPublicTrackingCode(code);
  assert.equal(hash, await hashPublicTrackingCode('srv20260810k7m2qx'));
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.notEqual(hash, code);
});

test('trusted issuance preparation returns raw code once plus hash without a browser route', async () => {
  const prepared = await preparePublicTrackingCodeIssuance({
    serviceJobId: 'internal-job-id',
    createdAt: new Date(2026, 7, 10),
    store: {
      async exists() {
        return false;
      },
    },
    randomBytes: deterministicRandomBytes([0, 1, 2, 3, 4, 5]),
  });
  assert.equal(prepared.serviceJobId, 'internal-job-id');
  assert.match(prepared.code, /^SRV-2026-0810-[0-9A-Z]{6}$/);
  assert.equal(prepared.codeHash, await hashPublicTrackingCode(prepared.code));
  const source = await readFile(
    new URL('../src/services/publicTrackingCodeIssuance.ts', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(source, /fetch\(|window\.|navigator\./);
});
