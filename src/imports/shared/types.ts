// Entity-agnostic import pipeline types. Nothing here knows about products,
// customers, or any other business entity — that mapping lives in each
// entity's own folder (e.g. src/imports/products/). This is what lets a
// future customers/brands/users importer reuse the same pipeline shape
// without redesigning it.

// A row exactly as a spreadsheet/CSV library would hand it back — either
// already keyed by column header, or a raw matrix with a separate header
// row (the two shapes most tabular-parsing libraries produce).
export type TabularInput =
  | { kind: 'objects'; rows: Record<string, unknown>[] }
  | { kind: 'matrix'; header: string[]; rows: unknown[][] };

// Output of the Parser stage: structurally normalized (stringified,
// trimmed, keyed by trimmed header) but with no business meaning applied
// yet. `rowNumber` is 1-based over data rows only (header excluded), for
// human-readable error/warning messages ("Row 14: ...").
export interface ParsedRow {
  rowNumber: number;
  fields: Record<string, string>;
}

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationIssue {
  rowNumber: number;
  field?: string;
  code: string;
  message: string;
  severity: ValidationSeverity;
}

export type ImportRowStatus = 'new' | 'updated' | 'skipped' | 'error';

export interface ImportPreviewRow<TRecord> {
  rowNumber: number;
  status: ImportRowStatus;
  record?: TRecord;
  issues: ValidationIssue[];
}

export interface ImportSummary {
  totalRows: number;
  newCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  warningCount: number;
}

export interface ImportPreview<TRecord> {
  summary: ImportSummary;
  rows: ImportPreviewRow<TRecord>[];
}

export interface ImportSummaryLine {
  label: string;
  count: number;
}
