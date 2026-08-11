export interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}

export const VALID: ValidationResult = { valid: true, errors: {} };
