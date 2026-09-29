import type { ProductCatalogState } from './productImport.ts';
import {
  MAX_TRANSACTION_RETRIES,
  TransactionConflictError,
  type AllocationTransaction,
} from './serviceJobCreation.ts';

export interface ProductDeleteRecord {
  status: 'Active' | 'Legacy';
  referenceTrackingVersion: number | null;
}

export interface ProductCatalogDeletionDataAccess {
  beginServiceJobTransaction(): Promise<AllocationTransaction>;
  getProductForDeletion(
    transaction: AllocationTransaction,
    productId: string
  ): Promise<ProductDeleteRecord | null>;
  hasServiceJobProductReference(
    transaction: AllocationTransaction,
    productId: string
  ): Promise<boolean>;
  getProductCatalogState(
    transaction: AllocationTransaction
  ): Promise<ProductCatalogState | null>;
  commitProductDeletion(
    transaction: AllocationTransaction,
    input: { productId: string; nextCatalogRevision: number; now: string }
  ): Promise<void>;
}

export class ProductDeleteNotFoundError extends Error {}
export class ProductDeleteNotLegacyError extends Error {}
export class ProductDeleteReferenceUnknownError extends Error {}
export class ProductDeleteInUseError extends Error {}
export class ProductDeleteRetryExhaustedError extends Error {}

export async function deleteProductSafely(input: {
  productId: string;
  dataAccess: ProductCatalogDeletionDataAccess;
  now?: () => Date;
}): Promise<void> {
  const now = input.now ?? (() => new Date());

  for (let attempt = 0; attempt < MAX_TRANSACTION_RETRIES; attempt += 1) {
    const transaction = await input.dataAccess.beginServiceJobTransaction();
    const product = await input.dataAccess.getProductForDeletion(
      transaction,
      input.productId
    );

    if (!product) throw new ProductDeleteNotFoundError();
    if (product.status !== 'Legacy') throw new ProductDeleteNotLegacyError();
    if (product.referenceTrackingVersion !== 1) {
      throw new ProductDeleteReferenceUnknownError();
    }
    if (
      await input.dataAccess.hasServiceJobProductReference(
        transaction,
        input.productId
      )
    ) {
      throw new ProductDeleteInUseError();
    }

    const state = await input.dataAccess.getProductCatalogState(transaction);
    const nextCatalogRevision = (state?.revision ?? 0) + 1;

    try {
      await input.dataAccess.commitProductDeletion(transaction, {
        productId: input.productId,
        nextCatalogRevision,
        now: now().toISOString(),
      });
      return;
    } catch (error) {
      if (
        error instanceof TransactionConflictError &&
        attempt + 1 < MAX_TRANSACTION_RETRIES
      ) {
        continue;
      }
      if (error instanceof TransactionConflictError) {
        throw new ProductDeleteRetryExhaustedError();
      }
      throw error;
    }
  }

  throw new ProductDeleteRetryExhaustedError();
}
