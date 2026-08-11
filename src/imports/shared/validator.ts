import type { ValidationIssue, ValidationSeverity } from './types';

export function issue(
  rowNumber: number,
  code: string,
  message: string,
  severity: ValidationSeverity,
  field?: string
): ValidationIssue {
  return { rowNumber, code, message, severity, field };
}

// Every validation-failure helper below returns structured issues instead
// of throwing — a malformed row should show up in the preview as one bad
// row among many, not abort the whole import (per Sprint P2 spec: "Do NOT
// throw exceptions for normal validation failures").
export function requiredField(
  value: string | undefined,
  field: string,
  rowNumber: number,
  code: string
): ValidationIssue | null {
  if (value !== undefined && value.trim().length > 0) return null;
  return issue(rowNumber, code, `Row ${rowNumber}: missing ${field}`, 'error', field);
}

// Groups row numbers by a caller-supplied key, keeping only keys that
// appear more than once. Key extraction returning undefined/empty string
// excludes that row from duplicate detection entirely (an already-missing
// field is reported by requiredField, not flagged again as a duplicate of
// other missing values).
export function findDuplicateRowNumbers<T>(
  records: T[],
  rowNumberOf: (record: T) => number,
  keyOf: (record: T) => string | undefined
): Map<string, number[]> {
  const rowsByKey = new Map<string, number[]>();
  for (const record of records) {
    const key = keyOf(record);
    if (key === undefined || key.length === 0) continue;
    const rowNumbers = rowsByKey.get(key) ?? [];
    rowNumbers.push(rowNumberOf(record));
    rowsByKey.set(key, rowNumbers);
  }
  for (const [key, rowNumbers] of rowsByKey) {
    if (rowNumbers.length < 2) rowsByKey.delete(key);
  }
  return rowsByKey;
}
