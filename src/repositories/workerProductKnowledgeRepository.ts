import {
  fetchWithWorkerToken,
  type WorkerTokenProvider,
} from '../auth/workerTokenProvider';
import { getFilesWorkerBaseUrl } from '../config/workerUrl';
import type { AccessoryDefinition, CommonProblemDefinition } from '../types';
import type {
  AccessoryCreateRequest,
  CommonProblemWriteRequest,
} from '../services/productKnowledgeManagement';
import {
  ProductKnowledgeManagementError,
  type ProductKnowledgeManagementErrorCode,
  type ProductKnowledgeManagementRepository,
  type ProductKnowledgeRepository,
} from './types';

const KNOWN_CODES: readonly ProductKnowledgeManagementErrorCode[] = [
  'authentication_required',
  'forbidden',
  'validation_failed',
  'not_found',
  'conflict',
  'dependency_unavailable',
];

function errorCode(value: unknown): ProductKnowledgeManagementErrorCode | null {
  return typeof value === 'string' && (KNOWN_CODES as readonly string[]).includes(value)
    ? (value as ProductKnowledgeManagementErrorCode)
    : null;
}

async function managementRequest(
  tokenProvider: WorkerTokenProvider,
  url: string,
  init: RequestInit
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetchWithWorkerToken(tokenProvider, url, init);
  } catch (error) {
    throw new ProductKnowledgeManagementError(
      error instanceof Error
        ? error.message
        : 'Network error during Product Knowledge update',
      null,
      null
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    // Keep a safe public fallback; raw provider responses never reach the UI.
  }

  if (!response.ok) {
    throw new ProductKnowledgeManagementError(
      typeof body.error === 'string' ? body.error : 'Unable to update Product Knowledge',
      response.status,
      errorCode(body.code)
    );
  }
  return body;
}

export async function createWorkerProductKnowledgeRepositories(
  tokenProvider: WorkerTokenProvider
): Promise<{
  read: ProductKnowledgeRepository;
  management: ProductKnowledgeManagementRepository;
}> {
  const baseUrl = getFilesWorkerBaseUrl();
  let accessories: AccessoryDefinition[] = [];
  let commonProblems: CommonProblemDefinition[] = [];

  const refresh = async () => {
    let response: Response;
    try {
      response = await fetchWithWorkerToken(
        tokenProvider,
        `${baseUrl}/product-knowledge`,
        {
          method: 'GET',
        }
      );
    } catch (error) {
      throw new ProductKnowledgeManagementError(
        error instanceof Error
          ? error.message
          : 'Network error loading Product Knowledge',
        null,
        null
      );
    }
    if (!response.ok) {
      throw new ProductKnowledgeManagementError(
        'Unable to load Product Knowledge',
        response.status,
        null
      );
    }
    const body = (await response.json()) as {
      accessories?: unknown;
      commonProblems?: unknown;
    };
    accessories = Array.isArray(body.accessories)
      ? body.accessories.filter((item): item is AccessoryDefinition =>
          Boolean(
            item &&
            typeof item === 'object' &&
            typeof (item as AccessoryDefinition).id === 'string' &&
            typeof (item as AccessoryDefinition).label === 'string'
          )
        )
      : [];
    commonProblems = Array.isArray(body.commonProblems)
      ? body.commonProblems.filter((item): item is CommonProblemDefinition => {
          if (!item || typeof item !== 'object') return false;
          const value = item as CommonProblemDefinition;
          return (
            typeof value.id === 'string' &&
            typeof value.label === 'string' &&
            (value.status === 'Active' || value.status === 'Inactive') &&
            (value.description === undefined || typeof value.description === 'string')
          );
        })
      : [];
  };

  await refresh();

  const read: ProductKnowledgeRepository = {
    getAllAccessories: () => [...accessories],
    getAccessoriesByIds(ids) {
      const wanted = new Set(ids);
      return accessories.filter((item) => wanted.has(item.id));
    },
    createAccessory() {
      throw new Error('Direct browser Product Knowledge writes are disabled');
    },
    getAllCommonProblems: () => [...commonProblems],
    getCommonProblemsByIds(ids) {
      const wanted = new Set(ids);
      return commonProblems.filter((item) => wanted.has(item.id));
    },
    createCommonProblem() {
      throw new Error('Direct browser Product Knowledge writes are disabled');
    },
    updateCommonProblem() {
      throw new Error('Direct browser Product Knowledge writes are disabled');
    },
    refreshFromServer: refresh,
  };

  const management: ProductKnowledgeManagementRepository = {
    async createAccessory(productId: string, request: AccessoryCreateRequest) {
      const body = await managementRequest(
        tokenProvider,
        `${baseUrl}/products/${encodeURIComponent(productId)}/accessories`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        }
      );
      const accessoryId = body.accessoryId;
      if (typeof accessoryId !== 'string' || accessoryId.length === 0) {
        throw new ProductKnowledgeManagementError(
          'Unable to confirm the created accessory',
          null,
          null
        );
      }
      return accessoryId;
    },
    async setAccessoryAssociation(productId, accessoryId, include) {
      await managementRequest(
        tokenProvider,
        `${baseUrl}/products/${encodeURIComponent(productId)}/accessories/${encodeURIComponent(accessoryId)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ version: 1, include }),
        }
      );
    },
    async createCommonProblem(productId, request: CommonProblemWriteRequest) {
      const body = await managementRequest(
        tokenProvider,
        `${baseUrl}/products/${encodeURIComponent(productId)}/common-problems`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        }
      );
      const problemId = body.problemId;
      if (typeof problemId !== 'string' || problemId.length === 0) {
        throw new ProductKnowledgeManagementError(
          'Unable to confirm the created common problem',
          null,
          null
        );
      }
      return problemId;
    },
    async updateCommonProblem(problemId, request) {
      await managementRequest(
        tokenProvider,
        `${baseUrl}/product-knowledge/common-problems/${encodeURIComponent(problemId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        }
      );
    },
    async setCommonProblemAssociation(productId, problemId, include) {
      await managementRequest(
        tokenProvider,
        `${baseUrl}/products/${encodeURIComponent(productId)}/common-problems/${encodeURIComponent(problemId)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ version: 1, include }),
        }
      );
    },
  };

  return { read, management };
}
