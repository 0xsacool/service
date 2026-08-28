import type { CanonicalAttachmentKey } from '../types/attachment.ts';

const encoder = new TextEncoder();
const CANONICAL_KEY_PATTERN =
  /^service-jobs\/([A-Za-z0-9_-]+)\/(before|after|documents|report)\/([A-Za-z0-9._-]+)$/;

function isPrintableAscii(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint < 0x20 || codePoint > 0x7e) return false;
  }
  return true;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function u32be(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError('Framed byte length is outside U32 range');
  }
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function frame(domain: string, values: readonly string[]): Uint8Array {
  const parts: Uint8Array[] = [encoder.encode(`${domain}\0`)];
  for (const value of values) {
    const bytes = encoder.encode(value);
    parts.push(u32be(bytes.byteLength), bytes);
  }
  return concatBytes(parts);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function canonicalAttachmentKeyByteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

export function isCanonicalAttachmentKey(value: unknown): value is CanonicalAttachmentKey {
  if (typeof value !== 'string') return false;
  const byteLength = canonicalAttachmentKeyByteLength(value);
  if (byteLength < 1 || byteLength > 1024 || !isPrintableAscii(value)) return false;
  if (value.includes('\\') || value.includes('%')) return false;
  const match = CANONICAL_KEY_PATTERN.exec(value);
  if (!match || match[3] === '.' || match[3] === '..') return false;
  return value.split('/').length === 4;
}

export function assertCanonicalAttachmentKey(value: unknown): CanonicalAttachmentKey {
  if (!isCanonicalAttachmentKey(value)) throw new Error('Invalid canonical attachment key');
  return value;
}

export function serviceJobIdFromCanonicalAttachmentKey(
  key: CanonicalAttachmentKey
): string {
  const match = CANONICAL_KEY_PATTERN.exec(key);
  if (!match?.[1]) throw new Error('Invalid canonical attachment key');
  return match[1];
}

export function compareCanonicalAttachmentKeys(
  left: CanonicalAttachmentKey,
  right: CanonicalAttachmentKey
): number {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const sharedLength = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = leftBytes[index]! - rightBytes[index]!;
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

export function legacyAttachmentMetadataDocId(key: CanonicalAttachmentKey): string {
  return key.replace(/\//g, '__');
}

export async function attachmentMetadataDocId(
  key: CanonicalAttachmentKey
): Promise<`ak2_${string}`> {
  return `ak2_${await sha256Hex(frame('service-tech:attachment-metadata-doc:v2', [key]))}`;
}

export async function attachmentDeletionClaimDocId(
  key: CanonicalAttachmentKey
): Promise<`dc1_${string}`> {
  return `dc1_${await sha256Hex(frame('service-tech:attachment-deletion-claim:v1', [key]))}`;
}

export async function attachmentRetentionHoldDocId(
  approvalEventId: string,
  key: CanonicalAttachmentKey
): Promise<`ah1_${string}`> {
  return `ah1_${await sha256Hex(
    frame('service-tech:attachment-retention-hold:v1', [approvalEventId, key])
  )}`;
}

export async function verifyAttachmentMetadataAddress(
  documentId: string,
  storedKey: unknown
): Promise<boolean> {
  return isCanonicalAttachmentKey(storedKey) && documentId === (await attachmentMetadataDocId(storedKey));
}

export async function verifyAttachmentDeletionClaimAddress(
  documentId: string,
  storedKey: unknown
): Promise<boolean> {
  return isCanonicalAttachmentKey(storedKey) && documentId === (await attachmentDeletionClaimDocId(storedKey));
}

export async function verifyAttachmentRetentionHoldAddress(
  documentId: string,
  approvalEventId: unknown,
  storedKey: unknown
): Promise<boolean> {
  return (
    typeof approvalEventId === 'string' &&
    approvalEventId.length > 0 &&
    isCanonicalAttachmentKey(storedKey) &&
    documentId === (await attachmentRetentionHoldDocId(approvalEventId, storedKey))
  );
}
