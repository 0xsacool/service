import type { ValidationResult } from './types';
import { VALID } from './types';
import type { NewProductInput } from '../services/productMasterAdmin';

export function validateNewProductInput(input: NewProductInput): ValidationResult {
  const errors: Record<string, string> = {};

  if (!input.brand.trim()) errors.brand = 'Brand is required';
  if (!input.categoryId.trim()) errors.categoryId = 'Category is required';
  if (!input.model.trim()) errors.model = 'Model is required';
  if (!input.sku.trim()) errors.sku = 'SKU is required';
  if (!input.productName.trim()) errors.productName = 'Product Name is required';
  if (!Number.isInteger(input.warrantyMonths) || input.warrantyMonths <= 0) {
    errors.warrantyMonths = 'Warranty Months must be a positive whole number';
  }

  if (Object.keys(errors).length > 0) return { valid: false, errors };
  return VALID;
}
