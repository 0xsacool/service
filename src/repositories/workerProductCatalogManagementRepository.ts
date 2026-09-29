import {
  fetchWithWorkerToken,
  type WorkerTokenProvider,
} from '../auth/workerTokenProvider';
import { getFilesWorkerBaseUrl } from '../config/workerUrl';
import type { ProductCatalogUpdateRequest } from '../services/productCatalogManagement';
import {
  ProductCatalogManagementError,
  type ProductCatalogManagementErrorCode,
  type ProductCatalogManagementRepository,
} from './types';

const KNOWN_CODES: readonly ProductCatalogManagementErrorCode[] = [
  'authentication_required',
  'forbidden',
  'validation_failed',
  'not_found',
  'dependency_unavailable',
];

function errorCode(value: unknown): ProductCatalogManagementErrorCode | null {
  return typeof value === 'string' && (KNOWN_CODES as readonly string[]).includes(value)
    ? (value as ProductCatalogManagementErrorCode)
    : null;
}

export function createWorkerProductCatalogManagementRepository(
  tokenProvider: WorkerTokenProvider
): ProductCatalogManagementRepository {
  const baseUrl = getFilesWorkerBaseUrl();

  return {
    async updateProduct(productId: string, request: ProductCatalogUpdateRequest) {
      let response: Response;
      try {
        response = await fetchWithWorkerToken(
          tokenProvider,
          `${baseUrl}/products/${encodeURIComponent(productId)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
          }
        );
      } catch (error) {
        throw new ProductCatalogManagementError(
          error instanceof Error ? error.message : 'Network error during product update',
          null,
          null
        );
      }

      if (response.ok) return;

      let body: { code?: unknown; error?: unknown } = {};
      try {
        body = (await response.json()) as { code?: unknown; error?: unknown };
      } catch {
        // Keep the public fallback below. Raw provider bodies never reach the UI.
      }
      throw new ProductCatalogManagementError(
        typeof body.error === 'string' ? body.error : 'Unable to update product',
        response.status,
        errorCode(body.code)
      );
    },
  };
}
