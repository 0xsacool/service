import type { ProductImportRequest } from '../services/productImportRequest';
import { fetchWithWorkerToken, type WorkerTokenProvider } from '../auth/workerTokenProvider';
import { getFilesWorkerBaseUrl } from '../config/workerUrl';
import {
  ProductImportError,
  type ProductImportCommitResult,
  type ProductImportErrorCode,
  type ProductImportRepository,
  type ProductImportRowError,
} from './types';

interface ErrorResponseBody {
  code?: string;
  error?: string;
  // Matches worker/src/index.ts's validation_failed body exactly:
  // { rowNumber, errors }[] — never the full classification row.
  rows?: ProductImportRowError[];
}

const KNOWN_ERROR_CODES: readonly ProductImportErrorCode[] = [
  'authentication_required',
  'forbidden',
  'validation_failed',
  'stale_catalog',
  'idempotency_mismatch',
  'payload_too_large',
  'transaction_retry_exhausted',
  'dependency_unavailable',
];

function toKnownErrorCode(code: string | undefined): ProductImportErrorCode | null {
  return (KNOWN_ERROR_CODES as readonly string[]).includes(code ?? '')
    ? (code as ProductImportErrorCode)
    : null;
}

async function readErrorBody(response: Response): Promise<ErrorResponseBody> {
  try {
    return (await response.json()) as ErrorResponseBody;
  } catch {
    return {};
  }
}

// Talks only to worker/src/index.ts's POST /products/import — the same
// transport pattern workerAttachmentsRepository.ts and
// firestoreServiceReportsRepository.ts already use (fetchWithWorkerToken +
// getFilesWorkerBaseUrl). Never calls Firestore directly for products; the
// Worker is the sole writer per DECISIONS.md's privileged-catalog-workflow
// requirement.
export function createWorkerProductImportRepository(
  tokenProvider: WorkerTokenProvider
): ProductImportRepository {
  const baseUrl = getFilesWorkerBaseUrl();

  return {
    async commit(request: ProductImportRequest, idempotencyKey: string) {
      let response: Response;
      try {
        response = await fetchWithWorkerToken(tokenProvider, `${baseUrl}/products/import`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify(request),
        });
      } catch (networkError) {
        // No response at all — the request's real server-side effect is
        // unknown, so this is ambiguous (status: null), never conclusive.
        throw new ProductImportError(
          networkError instanceof Error ? networkError.message : 'Network error during product import',
          null,
          null
        );
      }

      if (!response.ok) {
        const body = await readErrorBody(response);
        throw new ProductImportError(
          body.error ?? response.statusText,
          response.status,
          toKnownErrorCode(body.code),
          body.rows ?? null
        );
      }

      return (await response.json()) as ProductImportCommitResult;
    },
  };
}
