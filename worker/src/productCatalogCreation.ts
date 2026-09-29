import type { ProductCatalogCreateRequest } from '../../src/services/productCatalogManagement.ts';
import { isKnownProductCategoryId } from '../../src/services/productCategories.ts';
import {
  matchCatalogProduct,
  type CatalogProduct,
} from '../../src/services/productIdentity.ts';
import {
  MAX_TRANSACTION_RETRIES,
  TransactionConflictError,
  type AllocationTransaction,
} from './serviceJobCreation.ts';
import {
  MAX_CATALOG_PRODUCTS,
  type ProductCatalogState,
} from './productImport.ts';

export interface ProductCatalogCreateCommitInput {
  productId: string;
  request: ProductCatalogCreateRequest;
  nextCatalogRevision: number;
  now: string;
}

export interface ProductCatalogCreateDataAccess {
  beginTransaction(): Promise<AllocationTransaction>;
  listProducts(
    transaction: AllocationTransaction,
    limit: number
  ): Promise<CatalogProduct[]>;
  getProductCatalogState(
    transaction: AllocationTransaction
  ): Promise<ProductCatalogState | null>;
  commitProductCatalogCreate(
    transaction: AllocationTransaction,
    input: ProductCatalogCreateCommitInput
  ): Promise<void>;
}

export class ProductCatalogCreateValidationError extends Error {}
export class ProductCatalogDuplicateError extends Error {}
export class ProductCatalogCreateCatalogTooLargeError extends Error {}
export class ProductCatalogCreateRetryExhaustedError extends Error {}

export interface ProductCatalogCreateResult {
  productId: string;
}

export async function createProductCatalogEntry(input: {
  request: ProductCatalogCreateRequest;
  dataAccess: ProductCatalogCreateDataAccess;
  now?: () => Date;
  newProductId?: () => string;
}): Promise<ProductCatalogCreateResult> {
  if (!isKnownProductCategoryId(input.request.categoryId)) {
    throw new ProductCatalogCreateValidationError('Unknown product category');
  }

  const now = input.now ?? (() => new Date());
  const newProductId = input.newProductId ?? (() => crypto.randomUUID());

  for (let attempt = 0; attempt < MAX_TRANSACTION_RETRIES; attempt += 1) {
    const transaction = await input.dataAccess.beginTransaction();
    const catalog = await input.dataAccess.listProducts(
      transaction,
      MAX_CATALOG_PRODUCTS + 1
    );
    if (catalog.length > MAX_CATALOG_PRODUCTS) {
      throw new ProductCatalogCreateCatalogTooLargeError(
        `The product catalog exceeds the ${MAX_CATALOG_PRODUCTS}-item direct-create limit`
      );
    }

    const match = matchCatalogProduct(
      {
        sku: input.request.sku,
        brand: input.request.brand,
        model: input.request.model,
        productName: input.request.productName,
        categoryId: input.request.categoryId,
      },
      catalog
    );
    if (match.kind !== 'new') {
      throw new ProductCatalogDuplicateError('Product identity already exists');
    }

    const state = await input.dataAccess.getProductCatalogState(transaction);
    const productId = newProductId();
    const timestamp = now().toISOString();

    try {
      await input.dataAccess.commitProductCatalogCreate(transaction, {
        productId,
        request: input.request,
        nextCatalogRevision: (state?.revision ?? 0) + 1,
        now: timestamp,
      });
      return { productId };
    } catch (error) {
      if (error instanceof TransactionConflictError) {
        if (attempt + 1 < MAX_TRANSACTION_RETRIES) continue;
        throw new ProductCatalogCreateRetryExhaustedError(
          'Product creation could not be committed after repeated conflicts'
        );
      }
      throw error;
    }
  }

  throw new ProductCatalogCreateRetryExhaustedError(
    'Product creation could not be committed after repeated conflicts'
  );
}
