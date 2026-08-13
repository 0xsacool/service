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
