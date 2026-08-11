import type { RegisteredProduct } from '../types';
import type { RegisteredProductsRepository } from './types';
import { mockServiceJobs } from './mockData/serviceJobs.mock';
import {
  productInstanceCatalogBySerial,
  unservicedProductInstancesByCustomerId,
} from './mockData/productCatalog.mock';
import { productMasterRepository } from './productMasterRepository';
import { addMonths, warrantyStatusFor } from '../utils/warranty';

const NEVER_SERVICED = '—';
const DEFAULT_WARRANTY_MONTHS = 12;

function resolveCategoryName(categoryId: string): string {
  return (
    productMasterRepository.getCategories().find((c) => c.id === categoryId)?.name ??
    categoryId
  );
}

// Serviced products are derived from service job history (grouped by serial
// number, the physical unit's identifier) rather than hand-authored, so this
// can never drift from the jobs it summarizes — same pattern as
// customersRepository.ts / searchRepository.ts. `customerId` is today the
// same value as customerPhone (see searchRepository.ts's customer
// derivation) since mock data has no separate id column; a real Customer
// Master swaps this filter to `job.customer_id` without any caller changes.
//
// Catalog identity (brand/name/model/category/warrantyMonths/status) is
// resolved through productMasterRepository via the instance's productId —
// not duplicated here — so this function's output shape never changes when
// the catalog itself changes (Sprint P1).
function deriveServicedProducts(customerId: string): RegisteredProduct[] {
  const bySerial = new Map<string, RegisteredProduct>();

  for (const job of mockServiceJobs) {
    if (job.customerPhone !== customerId) continue;

    const existing = bySerial.get(job.serialNumber);
    if (existing) {
      existing.previousServiceCount += 1;
      if (job.updatedAt > existing.lastServiceDate)
        existing.lastServiceDate = job.updatedAt;
      continue;
    }

    const instanceEntry = productInstanceCatalogBySerial[job.serialNumber];
    const product = instanceEntry
      ? productMasterRepository.getProductById(instanceEntry.productId)
      : undefined;
    const purchaseDate = instanceEntry?.purchaseDate ?? job.createdAt;
    const warrantyMonths = product?.warrantyMonths ?? DEFAULT_WARRANTY_MONTHS;
    const warrantyExpiresAt = addMonths(purchaseDate, warrantyMonths);

    bySerial.set(job.serialNumber, {
      id: job.serialNumber,
      brand: product?.brand ?? 'Unknown',
      productName: product?.name ?? job.product,
      model: product?.model ?? '',
      serialNumber: job.serialNumber,
      category: product ? resolveCategoryName(product.categoryId) : job.productCategory,
      status: product?.status ?? 'Legacy',
      purchaseDate,
      warrantyMonths,
      warrantyExpiresAt,
      warrantyStatus: warrantyStatusFor(warrantyExpiresAt),
      lastServiceDate: job.updatedAt,
      previousServiceCount: 1,
    });
  }

  return Array.from(bySerial.values());
}

function deriveUnservicedProducts(customerId: string): RegisteredProduct[] {
  return (unservicedProductInstancesByCustomerId[customerId] ?? []).map((entry) => {
    const product = productMasterRepository.getProductById(entry.productId);
    const warrantyMonths = product?.warrantyMonths ?? DEFAULT_WARRANTY_MONTHS;
    const warrantyExpiresAt = addMonths(entry.purchaseDate, warrantyMonths);
    return {
      id: entry.serialNumber,
      brand: product?.brand ?? 'Unknown',
      productName: product?.name ?? 'Unknown product',
      model: product?.model ?? '',
      serialNumber: entry.serialNumber,
      category: product ? resolveCategoryName(product.categoryId) : 'Unknown',
      status: product?.status ?? 'Legacy',
      purchaseDate: entry.purchaseDate,
      warrantyMonths,
      warrantyExpiresAt,
      warrantyStatus: warrantyStatusFor(warrantyExpiresAt),
      lastServiceDate: NEVER_SERVICED,
      previousServiceCount: 0,
    };
  });
}

// Ordering rule (explicitly not alphabetical): most recently serviced
// first, ties broken by service frequency, anything never serviced
// ("Others") always last.
function compareRegisteredProducts(a: RegisteredProduct, b: RegisteredProduct): number {
  const aServiced = a.lastServiceDate !== NEVER_SERVICED;
  const bServiced = b.lastServiceDate !== NEVER_SERVICED;
  if (aServiced !== bServiced) return aServiced ? -1 : 1;
  if (!aServiced) return 0;
  if (a.lastServiceDate !== b.lastServiceDate) {
    return a.lastServiceDate < b.lastServiceDate ? 1 : -1;
  }
  return b.previousServiceCount - a.previousServiceCount;
}

export const registeredProductsRepository: RegisteredProductsRepository = {
  getForCustomer(customerId) {
    return [
      ...deriveServicedProducts(customerId),
      ...deriveUnservicedProducts(customerId),
    ].sort(compareRegisteredProducts);
  },
};
