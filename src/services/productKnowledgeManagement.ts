import type { CommonProblemStatus } from '../types/productMaster.ts';

export const PRODUCT_KNOWLEDGE_LIMITS = {
  label: 160,
  description: 2000,
} as const;

export interface AccessoryCreateRequest {
  version: 1;
  label: string;
}

export interface ProductKnowledgeAssociationRequest {
  version: 1;
  include: boolean;
}

export interface CommonProblemWriteRequest {
  version: 1;
  label: string;
  status: CommonProblemStatus;
  description: string | null;
}

function safeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFC').trim();
  if (normalized.length === 0 || [...normalized].length > maxLength) return null;
  for (const char of normalized) {
    const code = char.codePointAt(0) ?? 0;
    if ((code >= 0 && code <= 0x1f) || code === 0x7f) return null;
  }
  return normalized;
}

export function normalizeProductKnowledgeLabel(value: string): string {
  return value.normalize('NFC').trim().toLocaleLowerCase('en-US');
}

export function parseAccessoryCreateRequest(
  input: unknown
): AccessoryCreateRequest | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  if (
    Object.keys(raw).some((key) => key !== 'version' && key !== 'label') ||
    raw.version !== 1
  ) {
    return null;
  }
  const label = safeText(raw.label, PRODUCT_KNOWLEDGE_LIMITS.label);
  return label ? { version: 1, label } : null;
}

export function parseProductKnowledgeAssociationRequest(
  input: unknown
): ProductKnowledgeAssociationRequest | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  if (
    Object.keys(raw).some((key) => key !== 'version' && key !== 'include') ||
    raw.version !== 1 ||
    typeof raw.include !== 'boolean'
  ) {
    return null;
  }
  return { version: 1, include: raw.include };
}

export function parseCommonProblemWriteRequest(
  input: unknown
): CommonProblemWriteRequest | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const allowed = new Set(['version', 'label', 'status', 'description']);
  if (Object.keys(raw).some((key) => !allowed.has(key)) || raw.version !== 1) {
    return null;
  }
  const label = safeText(raw.label, PRODUCT_KNOWLEDGE_LIMITS.label);
  const status = raw.status === 'Active' || raw.status === 'Inactive' ? raw.status : null;
  let description: string | null = null;
  if (
    raw.description !== null &&
    raw.description !== undefined &&
    raw.description !== ''
  ) {
    description = safeText(raw.description, PRODUCT_KNOWLEDGE_LIMITS.description);
    if (description === null) return null;
  }
  return label && status ? { version: 1, label, status, description } : null;
}
