import type { Product } from '../types';
import { repositories } from '../repositories/repositoryProvider';

export interface UseProductsResult {
  products: Product[];
  isLoading: false;
  error: null;
}

// Scaffolded for the Sprint 2 Product Instance lookup-or-create intake flow
// (BUSINESS_RULES.md) — not yet consumed by any page, so today's UI stays
// visually identical. Backed by mock data derived from service job records;
// see productsRepository.ts. Resolved through the Repository Provider — see
// repositoryProvider.ts.
export function useProducts(): UseProductsResult {
  return {
    products: repositories.products.getAll(),
    isLoading: false,
    error: null,
  };
}
