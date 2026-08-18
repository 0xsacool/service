// Pure string-matching helpers shared by every SearchRepository
// implementation (Mock and Firestore) — kept dependency-free so both can
// import the exact same matching behavior instead of drifting apart.

export function normalizeDigits(value: string): string {
  return value.replace(/\D/g, '');
}

export function matches(haystack: string | undefined, query: string): boolean {
  if (!haystack) return false;
  return haystack.toLowerCase().includes(query);
}

export function matchesPhone(phone: string, query: string, queryDigits: string): boolean {
  if (matches(phone, query)) return true;
  return queryDigits.length > 0 && normalizeDigits(phone).includes(queryDigits);
}

// F5d-69 / DECISIONS.md #041 — order number matching. Deliberately narrow:
// only spaces and hyphens are ignored (a staff member retyping
// "250731 SHP 04821" or "250731-SHP-04821" for "250731SHP04821" should
// still match) — every other punctuation character is preserved literally,
// so this stays a real substring match, never a fuzzy one.
export function normalizeOrderNumberForMatch(value: string): string {
  return value.trim().toLowerCase().replace(/[ -]/g, '');
}

export function matchesOrderNumber(orderNumber: string | null, query: string): boolean {
  if (!orderNumber) return false;
  const normalizedQuery = normalizeOrderNumberForMatch(query);
  return normalizedQuery.length > 0 && normalizeOrderNumberForMatch(orderNumber).includes(normalizedQuery);
}

// Channel identity matching. A single leading '@' is ignored on both sides
// (so "@shop_user" and "shop_user" match each other) — only one, so a
// genuinely doubled "@@handle" is not silently mangled into "handle".
function stripSingleLeadingAt(value: string): string {
  return value.startsWith('@') ? value.slice(1) : value;
}

export function normalizeChannelIdentityForMatch(value: string): string {
  return stripSingleLeadingAt(value.trim().toLowerCase());
}

export function matchesChannelIdentity(identity: string | null, query: string): boolean {
  if (!identity) return false;
  const normalizedQuery = normalizeChannelIdentityForMatch(query);
  return (
    normalizedQuery.length > 0 &&
    normalizeChannelIdentityForMatch(identity).includes(normalizedQuery)
  );
}
