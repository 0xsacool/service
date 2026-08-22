import {
  hasSku,
  normalizeDisplayValue,
  normalizeIdentityValue,
  type CatalogProduct,
} from './productIdentity.ts';

// PI-3 — the deterministic catalog fingerprint that makes "the catalog
// changed since you previewed" detectable. The browser computes it over the
// product list it classified against and sends it with the request; the
// Worker recomputes it from the authoritative catalog INSIDE the
// transaction. A mismatch aborts with stale_catalog and writes nothing, per
// the approved abort-and-re-preview policy.
//
// Both runtimes import THIS module, so the two fingerprints are the same
// function over the same shape rather than two implementations that have to
// be kept in agreement by review.

// Bumped only if the canonical serialization below changes shape. An older
// client's fingerprint then cannot accidentally compare equal to a newer
// server's — it mismatches, which fails safe into a re-preview.
const FINGERPRINT_VERSION = 'pcf-1';

// Codepoint-order comparison. Deliberately NOT localeCompare: that is
// locale-sensitive, so the same catalog could serialize in two different
// orders on two machines and produce two different fingerprints for
// identical data.
function compareCodepoints(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

// The canonical string the fingerprint hashes. Kept separate from the hash
// itself so it is directly unit-testable without async crypto, and so a
// mismatch can be diagnosed by comparing serializations rather than opaque
// digests.
//
// Two properties this must have, both load-bearing:
//
//  - **Order independence.** Firestore returns documents in no guaranteed
//    order, and the browser's Map iteration order is insertion-dependent.
//    Rows are therefore sorted by document id before serialization, so the
//    same catalog always serializes identically regardless of how either
//    side happened to receive it.
//
//  - **No object-key enumeration.** Every row is serialized as a positional
//    ARRAY, never an object. JSON.stringify over an object would depend on
//    property insertion order, which differs between a literal built in the
//    browser and one assembled from Firestore fields — a silent, intermittent
//    fingerprint mismatch. Arrays are ordered by construction, and
//    JSON.stringify still gives correct escaping for arbitrary text.
//
// Fields included are exactly those an import can read or write:
// id, sku, brand, model, productName, categoryId. `status`,
// `warrantyMonths`, `accessoryIds`, and `commonProblemIds` are deliberately
// EXCLUDED — an import never reads them for classification and never writes
// them, so a change to any of them cannot invalidate a preview. Including
// them would only produce spurious stale_catalog aborts on edits the import
// is indifferent to.
//
// SKU is folded to its identity form (a case-only SKU edit is not a
// meaningful catalog change for matching purposes); the human-facing fields
// keep their display form, since changing "abc" to "ABC" in a product name
// genuinely is a change a preview should be re-run against.
export function buildCanonicalCatalogString(
  catalog: readonly CatalogProduct[]
): string {
  const rows = catalog
    .map((product) => [
      product.id,
      hasSku(product.sku) ? normalizeIdentityValue(product.sku) : '',
      normalizeDisplayValue(product.brand),
      normalizeDisplayValue(product.model),
      normalizeDisplayValue(product.productName),
      product.categoryId ?? '',
    ])
    .sort((a, b) => compareCodepoints(a[0]!, b[0]!));

  return `${FINGERPRINT_VERSION}\n${JSON.stringify(rows)}`;
}

const hexBytes = Array.from({ length: 256 }, (_, index) =>
  index.toString(16).padStart(2, '0')
);

// SHA-256 over UTF-8, hex-encoded. Uses Web Crypto, which is present and
// identical in all three runtimes this has to agree across: the browser,
// workerd, and Node (for the tests).
export async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  let out = '';
  for (const byte of new Uint8Array(digest)) out += hexBytes[byte]!;
  return out;
}

export async function computeCatalogFingerprint(
  catalog: readonly CatalogProduct[]
): Promise<string> {
  return await sha256Hex(buildCanonicalCatalogString(catalog));
}
