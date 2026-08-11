import { useState } from 'react';
import type { ProductCategory, ProductMasterEntry } from '../types';
import { repositories } from '../repositories/repositoryProvider';
import type { ImportPreviewRow } from '../imports/shared';
import type {
  ExistingProductRecord,
  ProductImportContext,
  ProductImportRecord,
} from '../imports/products';
import {
  buildProductFromImportRecord,
  buildProductMasterEntry,
  buildProductUpdatePatch,
  type NewProductInput,
} from '../services/productMasterAdmin';
import { canMutateProductCatalog } from '../services/productCatalogAccess';

export interface ImportCommitResult {
  created: number;
  updated: number;
}

export interface UseProductMasterResult {
  products: ProductMasterEntry[];
  categories: ProductCategory[];
  brands: string[];
  isLoading: false;
  error: null;
  canEdit: boolean;
  addProduct: (input: NewProductInput) => ProductMasterEntry;
  buildImportContext: () => ProductImportContext;
  commitImportRows: (rows: ImportPreviewRow<ProductImportRecord>[]) => ImportCommitResult;
}

// Matches how registeredProductsRepository already keys existing products
// for the Import Framework: real SKU when the product came from an import,
// falling back to its model code for anything hand-added or seeded before
// SKUs existed. This is the only place that fallback is applied — the
// importer itself (src/imports/) never sees or cares about it.
function toExistingProductRecord(product: ProductMasterEntry): ExistingProductRecord {
  return {
    sku: product.sku ?? product.model,
    brand: product.brand,
    model: product.model,
    variant: product.variant,
    productName: product.name,
    categoryId: product.categoryId,
  };
}

// Other data-access hooks (useServiceJobs) stay stateless — their pages
// never re-list after writing. This page lists its own writes immediately
// (Add Product, Import commit), so the hook holds local state and resyncs
// it from the repository after every mutation, rather than requiring the
// page itself to manage a refresh trigger.
export function useProductMaster(): UseProductMasterResult {
  const [products, setProducts] = useState<ProductMasterEntry[]>(() =>
    repositories.productMaster.getProducts()
  );
  const categories = repositories.productMaster.getCategories();
  const brands = Array.from(new Set(products.map((p) => p.brand))).sort();
  const canEdit = canMutateProductCatalog();

  const addProduct = (input: NewProductInput): ProductMasterEntry => {
    const existingIds = new Set(products.map((p) => p.id));
    const entry = buildProductMasterEntry(input, existingIds);
    repositories.productMaster.createProduct(entry);
    setProducts(repositories.productMaster.getProducts());
    return entry;
  };

  const buildImportContext = (): ProductImportContext => ({
    existingProducts: products.map(toExistingProductRecord),
    knownCategories: categories,
  });

  // Skips 'error' rows (never safe to write) and 'skipped' rows (already
  // identical — nothing to do). 'new' rows are created with a generated id;
  // 'updated' rows are matched back to their existing product via the same
  // sku-falls-back-to-model key used to build the import context above.
  const commitImportRows = (
    rows: ImportPreviewRow<ProductImportRecord>[]
  ): ImportCommitResult => {
    let created = 0;
    let updated = 0;
    let currentProducts = products;

    for (const row of rows) {
      if (!row.record || row.status === 'error' || row.status === 'skipped') continue;

      if (row.status === 'new') {
        const existingIds = new Set(currentProducts.map((p) => p.id));
        const entry = buildProductFromImportRecord(row.record, existingIds);
        repositories.productMaster.createProduct(entry);
        currentProducts = [...currentProducts, entry];
        created += 1;
      } else if (row.status === 'updated') {
        const record = row.record;
        const existing = currentProducts.find(
          (p) => (p.sku ?? p.model).toLowerCase() === record.sku.toLowerCase()
        );
        if (!existing) continue;
        const patch = buildProductUpdatePatch(record);
        repositories.productMaster.updateProduct(existing.id, patch);
        currentProducts = currentProducts.map((p) =>
          p.id === existing.id ? { ...p, ...patch } : p
        );
        updated += 1;
      }
    }

    setProducts(repositories.productMaster.getProducts());
    return { created, updated };
  };

  return {
    products,
    categories,
    brands,
    isLoading: false,
    error: null,
    canEdit,
    addProduct,
    buildImportContext,
    commitImportRows,
  };
}
