import type { RegisteredProduct } from '../types';
import { repositories } from '../repositories/repositoryProvider';

export interface UseCustomerProductsResult {
  products: RegisteredProduct[];
  isLoading: false;
  error: null;
}

// F5d-65 — `customerId` is `null` for a not-yet-durable walk-in customer
// (pending local state only, see IntakeCustomer). There is nothing to look
// up yet — no repository call is made, and an empty list is returned rather
// than querying with an empty/placeholder id.
export function useCustomerProducts(
  customerId: string | null
): UseCustomerProductsResult {
  return {
    products: customerId
      ? repositories.registeredProducts.getForCustomer(customerId)
      : [],
    isLoading: false,
    error: null,
  };
}
