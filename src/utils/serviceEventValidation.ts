// F5d-69 / DECISIONS.md #041 — client-side mirrors of the same two checks
// the Worker enforces on creation (worker/src/serviceJobCreation.ts) and
// Firestore Rules enforce on later edits. These are UX only: catching an
// obviously-wrong value here saves a round trip, but the Worker/Rules
// boundary is what actually protects the data — this file must never be
// treated as the source of truth for what's valid.

// Real calendar-arithmetic validity, not just YYYY-MM-DD shape — rejects
// 2026-02-30 and a non-leap 2026-02-29, matching nullableCalendarDate()'s
// Worker-side behavior exactly. A blank string is not validated here; call
// sites treat blank as "not entered yet", never as invalid.
export function isValidCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

// Real URL parsing via new URL(), never a startsWith() prefix test — mirrors
// nullableHttpsUrl()'s Worker-side behavior. A blank string is not validated
// here for the same reason as isValidCalendarDate above.
export function isValidHttpsUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'https:';
}
