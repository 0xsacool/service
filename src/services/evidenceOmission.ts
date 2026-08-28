import type { CanonicalAttachmentKey } from '../types/attachment.ts';
import { isCanonicalAttachmentKey } from './attachmentIdentity.ts';

export const MAX_EVIDENCE_ATTACHMENTS = 50;

const encoder = new TextEncoder();

// Phase 3R.3: confirmedOmittedEvidenceAttachmentIds is a mathematical SET
// carried as a JSON array, so [A,B] and [B,A] must reach identical request
// identity. Ordering is defined over raw UTF-8 bytes rather than JS string
// comparison (which orders UTF-16 code units) or localeCompare (which is
// locale- and ICU-version-dependent, so it could silently reorder across
// runtimes and break replay of an already-issued idempotency key).
export function compareCanonicalAttachmentKeys(left: string, right: string): number {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const shared = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < shared; index += 1) {
    const difference = leftBytes[index]! - rightBytes[index]!;
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

export function canonicalizeEvidenceKeys<T extends string>(keys: readonly T[]): T[] {
  return [...keys].sort(compareCanonicalAttachmentKeys);
}

export function evidenceKeySetsEqual(
  left: readonly string[],
  right: readonly string[]
): boolean {
  if (left.length !== right.length) return false;
  const canonicalLeft = canonicalizeEvidenceKeys(left);
  const canonicalRight = canonicalizeEvidenceKeys(right);
  return canonicalLeft.every((key, index) => key === canonicalRight[index]);
}

export type ConfirmedOmissionParse =
  | { ok: true; keys: CanonicalAttachmentKey[] }
  | { ok: false; reason: 'not-an-array' | 'too-many' | 'invalid-key' | 'duplicate-key' };

// Duplicates are rejected rather than deduplicated: silently collapsing [A,A]
// to [A] would accept a request the operator never confirmed, and would make
// two different client payloads share one request identity.
export function parseConfirmedOmissionSet(value: unknown): ConfirmedOmissionParse {
  if (!Array.isArray(value)) return { ok: false, reason: 'not-an-array' };
  if (value.length > MAX_EVIDENCE_ATTACHMENTS) return { ok: false, reason: 'too-many' };
  const seen = new Set<string>();
  const keys: CanonicalAttachmentKey[] = [];
  for (const key of value) {
    if (!isCanonicalAttachmentKey(key)) return { ok: false, reason: 'invalid-key' };
    if (seen.has(key)) return { ok: false, reason: 'duplicate-key' };
    seen.add(key);
    keys.push(key);
  }
  return { ok: true, keys: canonicalizeEvidenceKeys(keys) };
}
