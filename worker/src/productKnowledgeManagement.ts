import type {
  AccessoryDefinition,
  CommonProblemDefinition,
} from '../../src/types/productMaster.ts';
import type {
  AccessoryCreateRequest,
  CommonProblemWriteRequest,
} from '../../src/services/productKnowledgeManagement.ts';
import { normalizeProductKnowledgeLabel } from '../../src/services/productKnowledgeManagement.ts';
import {
  MAX_TRANSACTION_RETRIES,
  TransactionConflictError,
  type AllocationTransaction,
} from './serviceJobCreation.ts';

const MAX_KNOWLEDGE_DEFINITIONS = 2000;

export interface ProductKnowledgeTarget {
  accessoryIds: string[];
  commonProblemIds: string[];
}

export interface ProductKnowledgeDataAccess {
  beginTransaction(): Promise<AllocationTransaction>;
  listAccessoryDefinitions(
    transaction?: AllocationTransaction
  ): Promise<AccessoryDefinition[]>;
  listCommonProblemDefinitions(
    transaction?: AllocationTransaction
  ): Promise<CommonProblemDefinition[]>;
  getProductKnowledgeTarget(
    transaction: AllocationTransaction,
    productId: string
  ): Promise<ProductKnowledgeTarget | null>;
  getAccessoryDefinition(
    transaction: AllocationTransaction,
    accessoryId: string
  ): Promise<AccessoryDefinition | null>;
  getCommonProblemDefinition(
    transaction: AllocationTransaction,
    problemId: string
  ): Promise<CommonProblemDefinition | null>;
  commitAccessoryCreate(
    transaction: AllocationTransaction,
    input: {
      productId: string;
      accessory: AccessoryDefinition;
      accessoryIds: string[];
      now: string;
    }
  ): Promise<void>;
  commitCommonProblemCreate(
    transaction: AllocationTransaction,
    input: {
      productId: string;
      problem: CommonProblemDefinition;
      commonProblemIds: string[];
      now: string;
    }
  ): Promise<void>;
  commitProductKnowledgeAssociation(
    transaction: AllocationTransaction,
    input: {
      productId: string;
      field: 'accessoryIds' | 'commonProblemIds';
      ids: string[];
      now: string;
    }
  ): Promise<void>;
  commitCommonProblemUpdate(
    transaction: AllocationTransaction,
    input: {
      problem: CommonProblemDefinition;
      now: string;
    }
  ): Promise<void>;
}

export class ProductKnowledgeNotFoundError extends Error {}
export class ProductKnowledgeConflictError extends Error {}
export class ProductKnowledgeTooLargeError extends Error {}
export class ProductKnowledgeRetryExhaustedError extends Error {}

function ensureCatalogLimit(items: readonly unknown[]): void {
  if (items.length > MAX_KNOWLEDGE_DEFINITIONS) {
    throw new ProductKnowledgeTooLargeError('Product Knowledge catalog is too large');
  }
}

function hasDuplicateLabel(
  label: string,
  items: readonly { id: string; label: string }[],
  exceptId?: string
): boolean {
  const target = normalizeProductKnowledgeLabel(label);
  return items.some(
    (item) =>
      item.id !== exceptId &&
      normalizeProductKnowledgeLabel(item.label) === target
  );
}

async function withKnowledgeTransaction<T>(
  dataAccess: ProductKnowledgeDataAccess,
  operation: (transaction: AllocationTransaction) => Promise<T>
): Promise<T> {
  for (let attempt = 0; attempt < MAX_TRANSACTION_RETRIES; attempt += 1) {
    const transaction = await dataAccess.beginTransaction();
    try {
      return await operation(transaction);
    } catch (error) {
      if (
        error instanceof TransactionConflictError &&
        attempt + 1 < MAX_TRANSACTION_RETRIES
      ) {
        continue;
      }
      if (error instanceof TransactionConflictError) {
        throw new ProductKnowledgeRetryExhaustedError(
          'Product Knowledge write could not be committed after repeated conflicts'
        );
      }
      throw error;
    }
  }
  throw new ProductKnowledgeRetryExhaustedError(
    'Product Knowledge write could not be committed after repeated conflicts'
  );
}

export async function listProductKnowledge(
  dataAccess: ProductKnowledgeDataAccess
): Promise<{
  accessories: AccessoryDefinition[];
  commonProblems: CommonProblemDefinition[];
}> {
  const [accessories, commonProblems] = await Promise.all([
    dataAccess.listAccessoryDefinitions(),
    dataAccess.listCommonProblemDefinitions(),
  ]);
  ensureCatalogLimit(accessories);
  ensureCatalogLimit(commonProblems);
  return { accessories, commonProblems };
}

export async function createAccessoryForProduct(input: {
  productId: string;
  request: AccessoryCreateRequest;
  dataAccess: ProductKnowledgeDataAccess;
  now?: () => Date;
  newId?: () => string;
}): Promise<string> {
  const now = input.now ?? (() => new Date());
  const newId = input.newId ?? (() => crypto.randomUUID());

  return await withKnowledgeTransaction(input.dataAccess, async (transaction) => {
    const [product, accessories] = await Promise.all([
      input.dataAccess.getProductKnowledgeTarget(transaction, input.productId),
      input.dataAccess.listAccessoryDefinitions(transaction),
    ]);
    if (!product) throw new ProductKnowledgeNotFoundError('Product not found');
    ensureCatalogLimit(accessories);
    if (hasDuplicateLabel(input.request.label, accessories)) {
      throw new ProductKnowledgeConflictError('Accessory label already exists');
    }
    const accessory: AccessoryDefinition = {
      id: newId(),
      label: input.request.label,
    };
    const accessoryIds = [...new Set([...product.accessoryIds, accessory.id])];
    await input.dataAccess.commitAccessoryCreate(transaction, {
      productId: input.productId,
      accessory,
      accessoryIds,
      now: now().toISOString(),
    });
    return accessory.id;
  });
}

export async function createCommonProblemForProduct(input: {
  productId: string;
  request: CommonProblemWriteRequest;
  dataAccess: ProductKnowledgeDataAccess;
  now?: () => Date;
  newId?: () => string;
}): Promise<string> {
  const now = input.now ?? (() => new Date());
  const newId = input.newId ?? (() => crypto.randomUUID());

  return await withKnowledgeTransaction(input.dataAccess, async (transaction) => {
    const [product, problems] = await Promise.all([
      input.dataAccess.getProductKnowledgeTarget(transaction, input.productId),
      input.dataAccess.listCommonProblemDefinitions(transaction),
    ]);
    if (!product) throw new ProductKnowledgeNotFoundError('Product not found');
    ensureCatalogLimit(problems);
    if (hasDuplicateLabel(input.request.label, problems)) {
      throw new ProductKnowledgeConflictError('Common problem label already exists');
    }
    const problem: CommonProblemDefinition = {
      id: newId(),
      label: input.request.label,
      status: input.request.status,
      ...(input.request.description ? { description: input.request.description } : {}),
    };
    const commonProblemIds = [...new Set([...product.commonProblemIds, problem.id])];
    await input.dataAccess.commitCommonProblemCreate(transaction, {
      productId: input.productId,
      problem,
      commonProblemIds,
      now: now().toISOString(),
    });
    return problem.id;
  });
}

export async function setProductKnowledgeAssociation(input: {
  productId: string;
  kind: 'accessory' | 'commonProblem';
  knowledgeId: string;
  include: boolean;
  dataAccess: ProductKnowledgeDataAccess;
  now?: () => Date;
}): Promise<void> {
  const now = input.now ?? (() => new Date());

  await withKnowledgeTransaction(input.dataAccess, async (transaction) => {
    const product = await input.dataAccess.getProductKnowledgeTarget(
      transaction,
      input.productId
    );
    if (!product) throw new ProductKnowledgeNotFoundError('Product not found');

    const definition =
      input.kind === 'accessory'
        ? await input.dataAccess.getAccessoryDefinition(transaction, input.knowledgeId)
        : await input.dataAccess.getCommonProblemDefinition(
            transaction,
            input.knowledgeId
          );
    if (!definition) {
      throw new ProductKnowledgeNotFoundError('Product Knowledge definition not found');
    }

    const field =
      input.kind === 'accessory' ? 'accessoryIds' : 'commonProblemIds';
    const current = product[field];
    const ids = input.include
      ? [...new Set([...current, input.knowledgeId])]
      : current.filter((id) => id !== input.knowledgeId);

    await input.dataAccess.commitProductKnowledgeAssociation(transaction, {
      productId: input.productId,
      field,
      ids,
      now: now().toISOString(),
    });
  });
}

export async function updateCommonProblemDefinition(input: {
  problemId: string;
  request: CommonProblemWriteRequest;
  dataAccess: ProductKnowledgeDataAccess;
  now?: () => Date;
}): Promise<void> {
  const now = input.now ?? (() => new Date());

  await withKnowledgeTransaction(input.dataAccess, async (transaction) => {
    const [existing, problems] = await Promise.all([
      input.dataAccess.getCommonProblemDefinition(transaction, input.problemId),
      input.dataAccess.listCommonProblemDefinitions(transaction),
    ]);
    if (!existing) {
      throw new ProductKnowledgeNotFoundError('Common problem not found');
    }
    ensureCatalogLimit(problems);
    if (hasDuplicateLabel(input.request.label, problems, input.problemId)) {
      throw new ProductKnowledgeConflictError('Common problem label already exists');
    }
    const problem: CommonProblemDefinition = {
      id: input.problemId,
      label: input.request.label,
      status: input.request.status,
      ...(input.request.description ? { description: input.request.description } : {}),
    };
    await input.dataAccess.commitCommonProblemUpdate(transaction, {
      problem,
      now: now().toISOString(),
    });
  });
}
