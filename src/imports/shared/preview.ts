import type {
  ImportPreview,
  ImportPreviewRow,
  ImportRowStatus,
  ImportSummary,
  ImportSummaryLine,
  ValidationIssue,
} from './types';

export type MatchState = 'new' | 'identical' | 'changed';

// A row with an error is always 'error' regardless of match state — a
// record that failed validation isn't safe to create or update. Otherwise
// the entity-specific validator has already determined whether the record
// is brand new, matches an existing one exactly (nothing to do), or
// differs from an existing one (would update it); this just turns that
// into the row-level status the preview reports.
export function statusFrom(
  issues: ValidationIssue[],
  matchState: MatchState
): ImportRowStatus {
  if (issues.some((i) => i.severity === 'error')) return 'error';
  if (matchState === 'identical') return 'skipped';
  if (matchState === 'changed') return 'updated';
  return 'new';
}

export function summarize<TRecord>(rows: ImportPreviewRow<TRecord>[]): ImportSummary {
  const summary: ImportSummary = {
    totalRows: rows.length,
    newCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    warningCount: 0,
  };

  for (const row of rows) {
    if (row.issues.some((i) => i.severity === 'warning')) summary.warningCount += 1;
    switch (row.status) {
      case 'new':
        summary.newCount += 1;
        break;
      case 'updated':
        summary.updatedCount += 1;
        break;
      case 'skipped':
        summary.skippedCount += 1;
        break;
      case 'error':
        summary.errorCount += 1;
        break;
    }
  }

  return summary;
}

export function buildPreview<TRecord>(
  rows: ImportPreviewRow<TRecord>[]
): ImportPreview<TRecord> {
  return { summary: summarize(rows), rows };
}

// `entityLabel` lets one formatter serve any future entity importer, e.g.
// formatImportSummary(summary, 'Models') -> "New Models", "Updated Models",
// formatImportSummary(summary, 'Customers') -> "New Customers", etc.
export function formatImportSummary(
  summary: ImportSummary,
  entityLabel: string
): ImportSummaryLine[] {
  return [
    { label: `New ${entityLabel}`, count: summary.newCount },
    { label: `Updated ${entityLabel}`, count: summary.updatedCount },
    { label: 'Skipped', count: summary.skippedCount },
    { label: 'Errors', count: summary.errorCount },
    { label: 'Warnings', count: summary.warningCount },
  ];
}
