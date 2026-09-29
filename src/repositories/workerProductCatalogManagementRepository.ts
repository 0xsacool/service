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
  'product_not_legacy',
  'product_reference_unknown',
  'product_in_use',
  'conflict',
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
    async setProductStatus(productId, status) {
      let response: Response;
      try {
        response = await fetchWithWorkerToken(
          tokenProvider,
          `${baseUrl}/products/${encodeURIComponent(productId)}/status`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ version: 1, status }),
          }
        );
      } catch (error) {
        throw new ProductCatalogManagementError(
          error instanceof Error
            ? error.message
            : 'Network error during product status update',
          null,
          null
        );
      }
      if (!response.ok) {
        let body: { code?: unknown; error?: unknown } = {};
        try {
          body = (await response.json()) as { code?: unknown; error?: unknown };
        } catch {
          // Keep the safe fallback below when a provider returns a non-JSON error body.
        }
        throw new ProductCatalogManagementError(
          typeof body.error === 'string' ? body.error : 'Unable to update product status',
          response.status,
          errorCode(body.code)
        );
      }
    },

    async deleteProduct(productId) {
      let response: Response;
      try {
        response = await fetchWithWorkerToken(
          tokenProvider,
          `${baseUrl}/products/${encodeURIComponent(productId)}`,
          { method: 'DELETE' }
        );
      } catch (error) {
        throw new ProductCatalogManagementError(
          error instanceof Error
            ? error.message
            : 'Network error during product deletion',
          null,
          null
        );
      }
      if (!response.ok) {
        let body: { code?: unknown; error?: unknown } = {};
        try {
          body = (await response.json()) as { code?: unknown; error?: unknown };
        } catch {
          // Keep the safe fallback below when a provider returns a non-JSON error body.
        }
        throw new ProductCatalogManagementError(
          typeof body.error === 'string' ? body.error : 'Unable to delete product',
          response.status,
          errorCode(body.code)
        );
      }
    },

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
