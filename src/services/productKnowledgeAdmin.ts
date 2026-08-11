import type {
  AccessoryDefinition,
  CommonProblemDefinition,
  CommonProblemStatus,
} from '../types';
import { slugify } from '../utils/slugify';

export interface NewCommonProblemInput {
  label: string;
  status: CommonProblemStatus;
  description?: string;
}

export function generateKnowledgeId(
  fallbackPrefix: string,
  label: string,
  existingIds: Set<string>
): string {
  const base = slugify(label) || fallbackPrefix;
  if (!existingIds.has(base)) return base;

  let suffix = 2;
  while (existingIds.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

export function buildAccessoryDefinition(
  label: string,
  existingIds: Set<string>
): AccessoryDefinition {
  return {
    id: generateKnowledgeId('accessory', label, existingIds),
    label: label.trim(),
  };
}

export function buildCommonProblemDefinition(
  input: NewCommonProblemInput,
  existingIds: Set<string>
): CommonProblemDefinition {
  return {
    id: generateKnowledgeId('problem', input.label, existingIds),
    label: input.label.trim(),
    status: input.status,
    description: input.description?.trim() || undefined,
  };
}
