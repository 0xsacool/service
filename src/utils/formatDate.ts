const BANGKOK_TIME_ZONE = 'Asia/Bangkok';

const operationalDateFormatter = new Intl.DateTimeFormat('en-GB-u-ca-gregory', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: BANGKOK_TIME_ZONE,
});

const operationalTimeFormatter = new Intl.DateTimeFormat('th-TH', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: BANGKOK_TIME_ZONE,
});

const thbFormatter = new Intl.NumberFormat('th-TH', {
  style: 'currency',
  currency: 'THB',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatDate(iso: string): string {
  if (iso === '—') return '—';
  return operationalDateFormatter.format(new Date(iso));
}

export function formatDateShort(iso: string): string {
  return formatDate(iso);
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function formatTime(date: Date): string {
  return operationalTimeFormatter.format(date);
}

// DD/MM/YYYY + Buddhist Era, per PRINT_SPECIFICATIONS.md's date-format rule
// for customer-facing documents (DECISIONS.md #003).
export function formatThaiDate(iso: string): string {
  if (iso === '—') return '—';
  const d = new Date(iso);
  const parts = operationalDateFormatter.formatToParts(d);
  const day = parts.find((part) => part.type === 'day')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  if (!day || !month || !Number.isInteger(year)) return '—';
  const buddhistEraYear = year + 543;
  return `${day}/${month}/${year} (พ.ศ. ${buddhistEraYear})`;
}

export function formatCurrencyTHB(value: number): string {
  return thbFormatter.format(value);
}
