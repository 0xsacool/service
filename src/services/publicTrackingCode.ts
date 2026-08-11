const PUBLIC_TRACKING_CODE_PREFIX = 'SRV';
const PUBLIC_TRACKING_CODE_SUFFIX_LENGTH = 6;
const PUBLIC_TRACKING_CODE_MAX_ATTEMPTS = 5;
const MAX_RANDOM_BYTE_ATTEMPTS = 64;
const BASE36_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const PUBLIC_TRACKING_CODE_PATTERN = /^SRV-(\d{4})-(\d{4})-([0-9A-Z]{6})$/;

export type SecureRandomBytes = (length: number) => Uint8Array;

export interface ParsedPublicTrackingCode {
  year: number;
  month: number;
  day: number;
  suffix: string;
}

export interface PublicTrackingCodeExistenceStore {
  exists(code: string): Promise<boolean>;
}

export class PublicTrackingCodeCollisionError extends Error {
  constructor(attempts: number) {
    super(`Unable to allocate a public tracking code after ${attempts} attempts`);
    this.name = 'PublicTrackingCodeCollisionError';
  }
}

export class PublicTrackingCodeRandomnessError extends Error {
  constructor() {
    super('Unable to obtain a secure random public tracking code suffix');
    this.name = 'PublicTrackingCodeRandomnessError';
  }
}

function secureRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function nextBase36Character(randomBytes: SecureRandomBytes): string {
  const largestUnbiasedByte =
    Math.floor(256 / BASE36_ALPHABET.length) * BASE36_ALPHABET.length;
  for (let attempt = 0; attempt < MAX_RANDOM_BYTE_ATTEMPTS; attempt += 1) {
    const byte = randomBytes(1)[0];
    if (byte !== undefined && byte < largestUnbiasedByte) {
      return BASE36_ALPHABET[byte % BASE36_ALPHABET.length] ?? '';
    }
  }
  throw new PublicTrackingCodeRandomnessError();
}

export function parsePublicTrackingCode(value: unknown): ParsedPublicTrackingCode | null {
  if (typeof value !== 'string') return null;
  const match = PUBLIC_TRACKING_CODE_PATTERN.exec(value);
  if (!match) return null;
  const yearText = match[1];
  const monthDay = match[2];
  const suffix = match[3];
  if (!yearText || !monthDay || !suffix) return null;
  const year = Number(yearText);
  const month = Number(monthDay.slice(0, 2));
  const day = Number(monthDay.slice(2));
  if (!isValidCalendarDate(year, month, day)) return null;
  return { year, month, day, suffix };
}

export function isValidPublicTrackingCode(value: unknown): value is string {
  return parsePublicTrackingCode(value) !== null;
}

export function normalizePublicTrackingCodeInput(value: string): string | null {
  const compact = value.trim().toUpperCase().replace(/[\s-]/g, '');
  if (!/^SRV\d{8}[0-9A-Z]{6}$/.test(compact)) return null;
  const normalized = `SRV-${compact.slice(3, 7)}-${compact.slice(7, 11)}-${compact.slice(11)}`;
  return isValidPublicTrackingCode(normalized) ? normalized : null;
}

export function generatePublicTrackingCode(
  createdAt: Date,
  randomBytes: SecureRandomBytes = secureRandomBytes
): string {
  const year = createdAt.getFullYear();
  if (!Number.isFinite(createdAt.getTime()) || year < 1000 || year > 9999) {
    throw new RangeError('createdAt must be a valid date in the four-digit code range');
  }
  const monthDay = `${String(createdAt.getMonth() + 1).padStart(2, '0')}${String(
    createdAt.getDate()
  ).padStart(2, '0')}`;
  let suffix = '';
  for (let index = 0; index < PUBLIC_TRACKING_CODE_SUFFIX_LENGTH; index += 1) {
    suffix += nextBase36Character(randomBytes);
  }
  return `${PUBLIC_TRACKING_CODE_PREFIX}-${year}-${monthDay}-${suffix}`;
}

export async function generateAvailablePublicTrackingCode(
  createdAt: Date,
  store: PublicTrackingCodeExistenceStore,
  randomBytes: SecureRandomBytes = secureRandomBytes,
  maxAttempts = PUBLIC_TRACKING_CODE_MAX_ATTEMPTS
): Promise<string> {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError('maxAttempts must be a positive integer');
  }
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = generatePublicTrackingCode(createdAt, randomBytes);
    if (!(await store.exists(candidate))) return candidate;
  }
  throw new PublicTrackingCodeCollisionError(maxAttempts);
}

export async function hashPublicTrackingCode(code: string): Promise<string> {
  const normalized = normalizePublicTrackingCodeInput(code);
  if (!normalized) throw new Error('Cannot hash an invalid public tracking code');
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(normalized)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

export function constantTimeEqualPublicTrackingCodeHashes(
  left: string,
  right: string
): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export const PUBLIC_TRACKING_CODE_SUFFIX_SPACE = 36 ** PUBLIC_TRACKING_CODE_SUFFIX_LENGTH;
export const PUBLIC_TRACKING_CODE_MAX_COLLISION_ATTEMPTS =
  PUBLIC_TRACKING_CODE_MAX_ATTEMPTS;
