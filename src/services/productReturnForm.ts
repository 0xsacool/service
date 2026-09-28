import type { ServiceJob } from '../types/index.ts';

const RETURN_FORM_NUMBER_PATTERN = /^RT-(\d{4})-(\d{6})$/;
const ISO_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/;
const MAX_RETURN_FORM_SEQUENCE = 999999;

export function formatReturnFormNumber(year: number, sequence: number): string {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) {
    throw new Error('Return Form numbering year is invalid');
  }
  if (
    !Number.isInteger(sequence) ||
    sequence < 1 ||
    sequence > MAX_RETURN_FORM_SEQUENCE
  ) {
    throw new Error('Return Form sequence is malformed or exhausted');
  }
  return `RT-${year}-${String(sequence).padStart(6, '0')}`;
}

export function isValidReturnFormNumber(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = RETURN_FORM_NUMBER_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const sequence = Number(match[2]);
  return (
    Number.isInteger(year) &&
    year >= 2000 &&
    year <= 9999 &&
    Number.isInteger(sequence) &&
    sequence >= 1 &&
    sequence <= MAX_RETURN_FORM_SEQUENCE
  );
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if ([4, 6, 9, 11].includes(month)) return 30;
  return 31;
}

export function isTrustworthyReturnClosedAt(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = ISO_DATE_TIME_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[7] === 'Z' ? 0 : Number(match[8]);
  const offsetMinute = match[7] === 'Z' ? 0 : Number(match[9]);

  if (
    year < 1 ||
    year > 9999 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59 ||
    offsetHour < 0 ||
    offsetHour > 23 ||
    offsetMinute < 0 ||
    offsetMinute > 59
  ) {
    return false;
  }

  return !Number.isNaN(Date.parse(value));
}

export function hasTrustedReturnFormMetadata(
  job: Pick<ServiceJob, 'status' | 'closedAt' | 'returnFormNumber'>
): boolean {
  return (
    job.status === 'Completed' &&
    isTrustworthyReturnClosedAt(job.closedAt) &&
    isValidReturnFormNumber(job.returnFormNumber)
  );
}
