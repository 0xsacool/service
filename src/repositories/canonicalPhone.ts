// The single canonical phone-normalization rule used to join Customer and
// Service Job records (F5d-49B). Firestore customer document IDs are
// identity only — never treated as a phone number here — the real,
// documented relationship is `customer.phone` <-> `serviceJob.customerPhone`
// (Decision #031's accepted legacy join key), which this function makes
// robust against formatting differences (spaces, dashes, parentheses)
// instead of requiring byte-identical strings.
//
// Returns null for a missing/blank/non-digit phone — callers must treat
// null as "cannot safely join," never as a value that could accidentally
// equal another null (two blank phones are not the same phone).
export function normalizeCanonicalPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}
