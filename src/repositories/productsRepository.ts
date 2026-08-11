import type { Product } from '../types';
import type { ProductsRepository } from './types';
import { mockServiceJobs } from './mockData/serviceJobs.mock';

// Derived from service job records rather than hand-authored — see the same
// note in customersRepository.ts. A real Product/Model catalog
// (DATABASE_SCHEMA.md) replaces this derivation in Sprint 3/4.
function deriveProducts(): Product[] {
  const byName = new Map<string, Product>();
  for (const job of mockServiceJobs) {
    if (!byName.has(job.product)) {
      byName.set(job.product, {
        id: job.product,
        name: job.product,
        category: job.productCategory,
      });
    }
  }
  return Array.from(byName.values());
}

const mockProducts = deriveProducts();

export const productsRepository: ProductsRepository = {
  getAll() {
    return mockProducts;
  },
};
