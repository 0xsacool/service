import type { ProductMasterEntry } from '../types';
import type { ProductMasterRepository } from './types';
import { productCategories, productMasterEntries } from './mockData/productMaster.mock';
import { productKnowledgeRepository } from './productKnowledgeRepository';

// Session-only persistence, same pattern as serviceJobsRepository — a Map
// (not a plain array) because this repository now supports updates as well
// as creates (Sprint P3's Add Product + Import Products commit both write
// here). Seeded once from the static mock catalog; every read after that
// goes through the Map so a product edited or created this session is
// immediately visible everywhere, including to itself. Lost on refresh —
// expected for a mock repository, not a bug.
const productsById = new Map<string, ProductMasterEntry>(
  productMasterEntries.map((product) => [product.id, product])
);

export const productMasterRepository: ProductMasterRepository = {
  getCategories() {
    return productCategories;
  },
  getProducts() {
    return Array.from(productsById.values());
  },
  getProductById(id) {
    return productsById.get(id);
  },
  getAccessoriesForProduct(productId) {
    const product = productsById.get(productId);
    if (!product) return [];
    return productKnowledgeRepository.getAccessoriesByIds(product.accessoryIds);
  },
  getCommonProblemsForProduct(productId) {
    const product = productsById.get(productId);
    if (!product) return [];
    return productKnowledgeRepository.getCommonProblemsByIds(product.commonProblemIds);
  },
  createProduct(entry) {
    productsById.set(entry.id, entry);
    return entry;
  },
  updateProduct(id, patch) {
    const existing = productsById.get(id);
    if (!existing) {
      throw new Error(`Cannot update product "${id}": no such product exists`);
    }
    const updated = { ...existing, ...patch };
    productsById.set(id, updated);
    return updated;
  },
  // The mock's Map is already synchronously authoritative — every write
  // (including mockProductImportRepository's) goes through this same
  // singleton, so there is nothing to fetch.
  async refreshFromServer() {},
};
