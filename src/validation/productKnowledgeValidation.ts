import type { ValidationResult } from './types';
import { VALID } from './types';
import type { NewCommonProblemInput } from '../services/productKnowledgeAdmin';

export function validateNewAccessoryInput(label: string): ValidationResult {
  if (!label.trim()) {
    return { valid: false, errors: { label: 'Accessory name is required' } };
  }
  return VALID;
}

export function validateNewCommonProblemInput(
  input: NewCommonProblemInput
): ValidationResult {
  const errors: Record<string, string> = {};
  if (!input.label.trim()) errors.label = 'Problem name is required';

  if (Object.keys(errors).length > 0) return { valid: false, errors };
  return VALID;
}
