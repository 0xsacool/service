import {
  buildServerJob,
  parseServiceJobIntake,
  resolveIntakeMetadata,
} from '../src/serviceJobCreation.ts';

// F5d-69 Phase 2A — Worker-side validation of the contact/order/external
// evidence intake metadata. The Worker holds privileged Firestore
// credentials and therefore bypasses Firestore Rules entirely, so this is
// the ONLY validation on the creation path; Rules cover later browser
// updates of the same fields. Follows this suite's existing plain
// check()/counter convention rather than node:test, matching every other
// worker/test/*.mts file.

let failures = 0;
function check(name: string, value: boolean) {
  if (value) console.log(`  PASS  ${name}`);
  else {
    failures += 1;
    console.error(`  FAIL  ${name}`);
  }
}

const baseIntake = {
  customerName: 'QA',
  customerPhone: '0812345678',
  customerEmail: '',
  product: 'Product',
  productCategory: 'Other',
  serialNumber: 'S',
  problemDescription: '',
  problemChips: [],
  accessories: [],
  internalNotes: '',
  photos: [],
  warranty: false,
};

const withMetadata = (metadata: Record<string, unknown>) =>
  parseServiceJobIntake({ intake: { ...baseIntake, ...metadata } });

// --- backward compatibility with the currently-live frontend ---------------

const legacy = withMetadata({});
check('legacy intake with none of the new fields is accepted', legacy !== null);
check(
  'every new field resolves to null for a legacy intake',
  legacy !== null &&
    legacy.contactChannel === null &&
    legacy.contactChannelIdentity === null &&
    legacy.orderNumber === null &&
    legacy.orderVerification === null &&
    legacy.purchaseDate === null &&
    legacy.orderDeliveredDate === null &&
    legacy.externalEvidenceUrl === null &&
    legacy.externalEvidenceNote === null
);

const explicitNulls = withMetadata({
  contactChannel: null,
  contactChannelIdentity: null,
  orderNumber: null,
  orderVerification: null,
  purchaseDate: null,
  orderDeliveredDate: null,
  externalEvidenceUrl: null,
  externalEvidenceNote: null,
});
check('explicit nulls are accepted and equivalent to absence', explicitNulls !== null);

// --- full valid payload -----------------------------------------------------

const full = withMetadata({
  contactChannel: 'shopee',
  contactChannelIdentity: 'customer_123',
  orderNumber: '250731SHP04821',
  orderVerification: 'verified',
  purchaseDate: '2026-07-31',
  orderDeliveredDate: '2026-08-02',
  externalEvidenceUrl: 'https://drive.google.com/file/d/abc123/view',
  externalEvidenceNote: 'เครื่องดับหลังเปิดประมาณ 5 นาที',
});
check('a fully populated valid payload is accepted', full !== null);
check(
  'all valid values are preserved verbatim',
  full !== null &&
    full.contactChannel === 'shopee' &&
    full.contactChannelIdentity === 'customer_123' &&
    full.orderNumber === '250731SHP04821' &&
    full.orderVerification === 'verified' &&
    full.purchaseDate === '2026-07-31' &&
    full.orderDeliveredDate === '2026-08-02' &&
    full.externalEvidenceUrl === 'https://drive.google.com/file/d/abc123/view' &&
    full.externalEvidenceNote === 'เครื่องดับหลังเปิดประมาณ 5 นาที'
);

// --- channel ----------------------------------------------------------------

for (const channel of ['shopee', 'lazada', 'line', 'store', 'website', 'other']) {
  check(
    `channel '${channel}' is accepted with an identity`,
    withMetadata({ contactChannel: channel, contactChannelIdentity: 'id' }) !== null
  );
}
check(
  "channel 'phone' is accepted without an identity",
  withMetadata({ contactChannel: 'phone' }) !== null
);
check(
  'an unknown channel is rejected',
  withMetadata({ contactChannel: 'tiktok_shop' }) === null
);
check(
  'a non-string channel is rejected',
  withMetadata({ contactChannel: 42 }) === null
);

const identity120 = 'a'.repeat(120);
check(
  'a 120-character contact identity is accepted',
  withMetadata({ contactChannel: 'line', contactChannelIdentity: identity120 }) !== null
);
check(
  'a 121-character contact identity is rejected',
  withMetadata({ contactChannel: 'line', contactChannelIdentity: 'a'.repeat(121) }) === null
);
check(
  'a contact identity is trimmed',
  withMetadata({ contactChannel: 'line', contactChannelIdentity: '  spaced  ' })
    ?.contactChannelIdentity === 'spaced'
);
check(
  'a blank-only contact identity resolves to null',
  withMetadata({ contactChannel: 'line', contactChannelIdentity: '   ' })
    ?.contactChannelIdentity === null
);
// F5d-69 Phase 2A-FIX: an interior control character is no longer denied on
// its own for these ordinary text fields — Rules has no matching per-
// character check to mirror (see nullableBoundedString's comment), so a
// Worker-only rejection here would only create the divergence this fix
// closes. This intentionally flips the pre-fix expectation.
check(
  'a contact identity containing an interior newline is accepted, not rejected',
  withMetadata({ contactChannel: 'line', contactChannelIdentity: 'a\nb' })
    ?.contactChannelIdentity === 'a\nb'
);

// --- paste-artifact regression (F5d-69 Phase 2A-R Defect 1) -----------------
//
// The pre-fix hasControlCharacters() ran BEFORE trim(), so a value like
// "ABC\r\n" — surrounding whitespace a paste from another app commonly
// leaves behind — was rejected outright instead of trimming clean to "ABC",
// failing the WHOLE Service Job creation over a cosmetic paste artifact.
for (const artifact of ['\r\n', '\r', '\t', '\n']) {
  check(
    `contactChannelIdentity with a trailing "${JSON.stringify(artifact)}" paste artifact trims clean`,
    withMetadata({ contactChannel: 'line', contactChannelIdentity: `ABC${artifact}` })
      ?.contactChannelIdentity === 'ABC'
  );
  check(
    `orderNumber with a leading "${JSON.stringify(artifact)}" paste artifact trims clean`,
    withMetadata({ orderNumber: `${artifact}ABC` })?.orderNumber === 'ABC'
  );
  check(
    `externalEvidenceNote with a "${JSON.stringify(artifact)}" paste artifact on both sides trims clean`,
    withMetadata({ externalEvidenceNote: `${artifact}ABC${artifact}` })?.externalEvidenceNote ===
      'ABC'
  );
}
// The whole intake — not just the primitive parser — must succeed end to
// end, matching the real-world failure mode the audit reproduced (creation
// failing entirely, not just one field being dropped).
const pastedIntake = withMetadata({
  contactChannel: 'line',
  contactChannelIdentity: 'customer_123\r\n',
  orderNumber: '\r\nORD-1',
  externalEvidenceNote: 'note\r\n',
});
check('an intake with CRLF paste artifacts across multiple fields is accepted', pastedIntake !== null);
check(
  'every pasted field is persisted trimmed clean via buildServerJob',
  (() => {
    if (!pastedIntake) return false;
    const job = buildServerJob('bruno-thailand', pastedIntake, new Date('2026-08-18T03:00:00.000Z'));
    return (
      job.contactChannelIdentity === 'customer_123' &&
      job.orderNumber === 'ORD-1' &&
      job.externalEvidenceNote === 'note'
    );
  })()
);

// --- cross-field invariants C and D ----------------------------------------

check(
  "invariant D: 'phone' channel drops a supplied identity",
  withMetadata({ contactChannel: 'phone', contactChannelIdentity: '0812345678' })
    ?.contactChannelIdentity === null
);
check(
  'invariant C: an identity without a channel resolves to null',
  withMetadata({ contactChannelIdentity: 'orphan' })?.contactChannelIdentity === null
);
check(
  'invariant C: the channel itself stays null when absent',
  withMetadata({ contactChannelIdentity: 'orphan' })?.contactChannel === null
);

// --- order number and verification -----------------------------------------

check('a valid order number is accepted', withMetadata({ orderNumber: 'ABC-123' }) !== null);
check(
  'a 64-character order number is accepted',
  withMetadata({ orderNumber: 'a'.repeat(64) }) !== null
);
check(
  'a 65-character order number is rejected',
  withMetadata({ orderNumber: 'a'.repeat(65) }) === null
);
check(
  'order number display value is preserved (case and punctuation)',
  withMetadata({ orderNumber: '250731-SHP-04821' })?.orderNumber === '250731-SHP-04821'
);
check(
  'a blank-only order number resolves to null',
  withMetadata({ orderNumber: '   ' })?.orderNumber === null
);

check(
  'invariant B: an order number with omitted verification defaults to unverified',
  withMetadata({ orderNumber: 'ABC-123' })?.orderVerification === 'unverified'
);
check(
  'invariant A: a null order number forces verification to null',
  withMetadata({ orderVerification: 'verified' })?.orderVerification === null
);
for (const verification of ['unverified', 'verified', 'not_found']) {
  check(
    `verification '${verification}' is accepted alongside an order number`,
    withMetadata({ orderNumber: 'ABC-123', orderVerification: verification })
      ?.orderVerification === verification
  );
}
check(
  'an unknown verification value is rejected',
  withMetadata({ orderNumber: 'ABC-123', orderVerification: 'approved' }) === null
);

// --- dates ------------------------------------------------------------------

check('a valid purchaseDate is accepted', withMetadata({ purchaseDate: '2026-08-18' }) !== null);
check(
  'a valid orderDeliveredDate is accepted',
  withMetadata({ orderDeliveredDate: '2026-08-20' }) !== null
);
check(
  'a leap day in a leap year is accepted',
  withMetadata({ purchaseDate: '2024-02-29' }) !== null
);
for (const invalid of [
  '18-08-2026',
  '2026/08/18',
  '2026-8-1',
  'not-a-date',
  '20260818',
  '2026-08-18T00:00:00Z',
]) {
  check(`malformed date '${invalid}' is rejected`, withMetadata({ purchaseDate: invalid }) === null);
}
check(
  'an impossible calendar date (2026-02-30) is rejected by the Worker',
  withMetadata({ purchaseDate: '2026-02-30' }) === null
);
check(
  'a leap day in a non-leap year (2026-02-29) is rejected by the Worker',
  withMetadata({ purchaseDate: '2026-02-29' }) === null
);
check('month 13 is rejected', withMetadata({ purchaseDate: '2026-13-01' }) === null);
check('day 00 is rejected', withMetadata({ purchaseDate: '2026-08-00' }) === null);

// --- external evidence URL --------------------------------------------------

check(
  'an https URL is accepted',
  withMetadata({ externalEvidenceUrl: 'https://example.com/a' }) !== null
);
check(
  'an http URL is rejected',
  withMetadata({ externalEvidenceUrl: 'http://example.com/a' }) === null
);
check(
  'a javascript: URL is rejected',
  withMetadata({ externalEvidenceUrl: 'javascript:alert(1)' }) === null
);
check(
  'a data: URL is rejected',
  withMetadata({ externalEvidenceUrl: 'data:text/html,<script>' }) === null
);
check(
  'a malformed URL is rejected',
  withMetadata({ externalEvidenceUrl: 'not a url' }) === null
);
check(
  'a scheme-relative URL is rejected',
  withMetadata({ externalEvidenceUrl: '//example.com/a' }) === null
);
check(
  'an https URL containing an interior newline is rejected',
  withMetadata({ externalEvidenceUrl: 'https://example.com/\na' }) === null
);
// F5d-69 Phase 2A-FIX section 3: externalEvidenceUrl keeps ZERO tolerance
// for control characters, including a trailing paste artifact the other
// (relaxed) text fields would simply trim away — proves the URL field does
// not inherit nullableBoundedString's relaxed policy. Verified separately
// that new URL() would otherwise silently strip this newline rather than
// throwing, which is exactly why nullableHttpsUrl screens for it explicitly
// instead of relying on new URL() alone.
check(
  'an https URL with only a trailing newline paste artifact is still rejected, not trimmed',
  withMetadata({ externalEvidenceUrl: 'https://example.com/a\n' }) === null
);
check(
  'an https URL with a carriage return is rejected',
  withMetadata({ externalEvidenceUrl: 'https://example.com/a\r' }) === null
);
check(
  'an https URL with a tab is rejected',
  withMetadata({ externalEvidenceUrl: 'https://example.com/a\tb' }) === null
);
const longUrl = `https://example.com/${'a'.repeat(2048)}`;
check(
  'an over-length evidence URL is rejected',
  withMetadata({ externalEvidenceUrl: longUrl }) === null
);
check(
  'an evidence URL exactly at the 2048 bound is accepted',
  withMetadata({
    externalEvidenceUrl: `https://example.com/${'a'.repeat(2048 - 'https://example.com/'.length)}`,
  }) !== null
);

// --- external evidence note -------------------------------------------------

check(
  'a 1000-character note is accepted',
  withMetadata({ externalEvidenceNote: 'a'.repeat(1000) }) !== null
);
check(
  'a 1001-character note is rejected',
  withMetadata({ externalEvidenceNote: 'a'.repeat(1001) }) === null
);
check(
  'a non-string note is rejected',
  withMetadata({ externalEvidenceNote: { text: 'x' } }) === null
);

// --- unknown-key rejection is unchanged ------------------------------------

check(
  'an unknown intake key is still rejected',
  parseServiceJobIntake({ intake: { ...baseIntake, unexpectedKey: 'x' } }) === null
);

// --- persistence ------------------------------------------------------------

const persisted = buildServerJob(
  'bruno-thailand',
  withMetadata({
    contactChannel: 'lazada',
    contactChannelIdentity: 'shop_user',
    orderNumber: 'LZD-77',
    purchaseDate: '2026-07-01',
    externalEvidenceUrl: 'https://drive.google.com/x',
  })!,
  new Date('2026-08-18T03:00:00.000Z')
);
check(
  'validated metadata is persisted onto the Service Job document',
  persisted.contactChannel === 'lazada' &&
    persisted.contactChannelIdentity === 'shop_user' &&
    persisted.orderNumber === 'LZD-77' &&
    persisted.orderVerification === 'unverified' &&
    persisted.purchaseDate === '2026-07-01' &&
    persisted.orderDeliveredDate === null &&
    persisted.externalEvidenceUrl === 'https://drive.google.com/x' &&
    persisted.externalEvidenceNote === null
);
const persistedLegacy = buildServerJob('bruno-thailand', legacy!, new Date('2026-08-18T03:00:00.000Z'));
check(
  'a legacy intake still produces a complete, valid Service Job',
  persistedLegacy.contactChannel === null &&
    persistedLegacy.orderVerification === null &&
    persistedLegacy.externalEvidenceUrl === null &&
    persistedLegacy.customerName === 'QA'
);

// --- invariant resolver in isolation ---------------------------------------

const resolved = resolveIntakeMetadata({
  contactChannel: null,
  contactChannelIdentity: 'orphan',
  orderNumber: null,
  orderVerification: 'verified',
  purchaseDate: null,
  orderDeliveredDate: null,
  externalEvidenceUrl: null,
  externalEvidenceNote: null,
});
check(
  'resolveIntakeMetadata enforces both null-parent invariants together',
  resolved.contactChannelIdentity === null && resolved.orderVerification === null
);

// --- no outbound fetch for external evidence -------------------------------

const workerSource = await (
  await import('node:fs/promises')
).readFile(new URL('../src/serviceJobCreation.ts', import.meta.url), 'utf8');
check(
  'the intake parser module introduces no fetch() call for external evidence',
  !workerSource.includes('fetch(')
);

console.log(`\nf5d69IntakeMetadata: ${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
if (failures > 0) process.exit(1);
