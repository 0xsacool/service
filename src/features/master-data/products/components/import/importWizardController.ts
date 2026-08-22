import type { ImportPreview, ImportSummary } from '../../../../../imports/shared';
import type { ProductImportRecord } from '../../../../../imports/products';
import type { ImportCommitResult } from '../../../../../hooks/useProductMaster';
import { ProductImportError } from '../../../../../repositories/types';
import type { ParsedImportFile } from './types';

// PI-3 Slice 2 — pure state machine for the import wizard's
// chooseFile -> preview -> validation -> submit lifecycle, extracted out of
// ImportProductsWizard.tsx so the transition rules (including the ones that
// only matter for error recovery) are independently unit-testable without
// mounting React. No side effects live here: fetches, request-building, and
// the pending-idempotency-key bookkeeping (productImportPendingAttempt.ts)
// stay in the component; this module only ever computes the next state.

export type WizardState =
  | { step: 'chooseFile' }
  | { step: 'preview'; file: ParsedImportFile }
  | {
      step: 'validation';
      file: ParsedImportFile;
      preview: ImportPreview<ProductImportRecord>;
    }
  | {
      step: 'submitting';
      file: ParsedImportFile;
      preview: ImportPreview<ProductImportRecord>;
      // Set once an ambiguous failure has occurred and is awaiting either an
      // automatic or a manual same-key retry — null on the initial attempt.
      retryMessage: string | null;
    }
  // The classification the user reviewed no longer matches the catalog —
  // requires an external re-preview (new classification, new idempotency
  // key) before another submit is legitimate. Never auto-resubmitted.
  | { step: 'staleCatalog'; file: ParsedImportFile }
  | {
      step: 'error';
      file: ParsedImportFile;
      preview: ImportPreview<ProductImportRecord>;
      message: string;
    }
  | { step: 'result'; result: ImportCommitResult; summary: ImportSummary };

export type WizardAction =
  | { type: 'fileParsed'; file: ParsedImportFile }
  | { type: 'previewBuilt'; preview: ImportPreview<ProductImportRecord> }
  | { type: 'back' }
  | { type: 'submit' }
  | { type: 'commitSucceeded'; result: ImportCommitResult }
  | { type: 'commitFailedAmbiguous'; message: string }
  | { type: 'commitFailedConclusive'; message: string }
  | { type: 'commitFailedStale' }
  | { type: 'reset' };

export const initialWizardState: WizardState = { step: 'chooseFile' };

export function reduce(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'fileParsed':
      return { step: 'preview', file: action.file };

    case 'previewBuilt':
      if (state.step !== 'preview' && state.step !== 'staleCatalog') return state;
      return { step: 'validation', file: state.file, preview: action.preview };

    case 'back':
      if (state.step === 'validation') return { step: 'preview', file: state.file };
      if (state.step === 'preview') return { step: 'chooseFile' };
      return state;

    // ANY ERROR blocks the whole import (PI-3 Slice 2 requirement #10) —
    // enforced here, at the state-machine level, not only by a disabled
    // button, so a row-level error can never be bypassed by dispatching
    // 'submit' directly.
    case 'submit':
      if (state.step !== 'validation') return state;
      if (state.preview.summary.errorCount > 0) return state;
      return {
        step: 'submitting',
        file: state.file,
        preview: state.preview,
        retryMessage: null,
      };

    case 'commitSucceeded':
      if (state.step !== 'submitting') return state;
      return { step: 'result', result: action.result, summary: state.preview.summary };

    // Ambiguous (network failure, or a 5xx) — the write's real effect is
    // unknown, so the only safe recovery is retrying with the SAME request
    // and SAME idempotency key. Stays in 'submitting' shape; the retry
    // itself (automatic or manual) is the component's concern.
    case 'commitFailedAmbiguous':
      if (state.step !== 'submitting') return state;
      return { ...state, retryMessage: action.message };

    case 'commitFailedConclusive':
      if (state.step !== 'submitting') return state;
      return {
        step: 'error',
        file: state.file,
        preview: state.preview,
        message: action.message,
      };

    case 'commitFailedStale':
      if (state.step !== 'submitting') return state;
      return { step: 'staleCatalog', file: state.file };

    case 'reset':
      return { step: 'chooseFile' };

    default:
      return state;
  }
}

// Maps a commitImportRows() outcome to the action that advances the state
// machine. Takes the hook's async commit function directly rather than a
// ProductImportRepository — request-building stays inside useProductMaster,
// this module only interprets the outcome.
export async function submitImport(
  commitImportRows: (idempotencyKey: string) => Promise<ImportCommitResult>,
  idempotencyKey: string
): Promise<WizardAction> {
  try {
    const result = await commitImportRows(idempotencyKey);
    return { type: 'commitSucceeded', result };
  } catch (error) {
    if (error instanceof ProductImportError) {
      if (error.code === 'stale_catalog') return { type: 'commitFailedStale' };
      if (error.isConclusive) {
        return { type: 'commitFailedConclusive', message: error.message };
      }
      return { type: 'commitFailedAmbiguous', message: error.message };
    }
    return {
      type: 'commitFailedAmbiguous',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
