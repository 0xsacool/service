import type { RegisteredProduct } from '../types';
import { repositories } from '../repositories/repositoryProvider';

export interface UseCustomerProductsResult {
  products: RegisteredProduct[];
  isLoading: false;
  error: null;
}

export function useCustomerProducts(customerId: string): UseCustomerProductsResult {
  return {
    products: repositories.registeredProducts.getForCustomer(customerId),
    isLoading: false,
    error: null,
  };
}
