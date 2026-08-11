export function formatDate(iso: string): string {
  if (iso === '—') return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('th-TH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatDateShort(iso: string): string {
  if (iso === '—') return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('th-TH', { month: 'short', day: 'numeric' });
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString('th-TH', { hour: 'numeric', minute: '2-digit' });
}

// DD/MM/YYYY + Buddhist Era, per PRINT_SPECIFICATIONS.md's date-format rule
// for customer-facing documents (DECISIONS.md #003). Scoped to print output
// only — the rest of the app's staff-facing UI stays en-US pending the
// deferred Thai-first pass, so this isn't used outside the print preview.
export function formatThaiDate(iso: string): string {
  if (iso === '—') return '—';
  const d = new Date(iso);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const buddhistEraYear = year + 543;
  return `${day}/${month}/${year} (B.E. ${buddhistEraYear})`;
}
