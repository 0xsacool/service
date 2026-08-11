import type { ParsedRow, TabularInput } from './types';

function toFieldString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

// Structural conversion only: stringify, trim, key by trimmed header.
// Deliberately has no idea what a "SKU" or "Model" is — that mapping is
// each entity normalizer's job, so this stays reusable for any future
// import (customers, brands, users, ...).
export function parseRows(input: TabularInput): ParsedRow[] {
  if (input.kind === 'objects') {
    return input.rows.map((row, index) => {
      const fields: Record<string, string> = {};
      for (const [key, value] of Object.entries(row)) {
        fields[key.trim()] = toFieldString(value);
      }
      return { rowNumber: index + 1, fields };
    });
  }

  const header = input.header.map((column) => column.trim());
  return input.rows.map((row, index) => {
    const fields: Record<string, string> = {};
    header.forEach((column, columnIndex) => {
      fields[column] = toFieldString(row[columnIndex]);
    });
    return { rowNumber: index + 1, fields };
  });
}

// Case-insensitive, whitespace-tolerant lookup so a normalizer can accept
// "SKU", "sku", or " Sku " from an external spreadsheet without the parser
// needing to know the canonical header names in advance.
export function getField(
  fields: Record<string, string>,
  ...aliases: string[]
): string | undefined {
  for (const alias of aliases) {
    const target = alias.trim().toLowerCase();
    const key = Object.keys(fields).find((k) => k.toLowerCase() === target);
    if (key !== undefined) return fields[key];
  }
  return undefined;
}

// A row with no recognizable data in any of its fields — every value is an
// empty string once trimmed. Useful for detecting blank spreadsheet rows
// (trailing rows, section breaks) before they reach entity-specific
// validation.
export function isBlankRow(row: ParsedRow): boolean {
  return Object.values(row.fields).every((value) => value === '');
}
