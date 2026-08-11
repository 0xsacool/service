import type { Customer } from '../types';
import { repositories } from '../repositories/repositoryProvider';

export interface UseCustomersResult {
  customers: Customer[];
  isLoading: false;
  error: null;
}

// Scaffolded for the Sprint 2 Customer lookup-or-create intake flow
// (BUSINESS_RULES.md) — not yet consumed by any page, so today's UI stays
// visually identical. Backed by mock data derived from service job records;
// see customersRepository.ts. Resolved through the Repository Provider —
// see repositoryProvider.ts.
export function useCustomers(): UseCustomersResult {
  return {
    customers: repositories.customers.getAll(),
    isLoading: false,
    error: null,
  };
}
