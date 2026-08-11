const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

function shiftedBangkokDate(value: Date): Date {
  if (Number.isNaN(value.getTime())) throw new Error('Invalid date');
  return new Date(value.getTime() + BANGKOK_OFFSET_MS);
}

export function bangkokNumberingYear(value: Date): number {
  return shiftedBangkokDate(value).getUTCFullYear();
}

export function bangkokIsoDate(value: Date): string {
  const date = shiftedBangkokDate(value);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
