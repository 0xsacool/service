import type { BrandId, RegisteredProduct } from '../types';
import type { RegisteredProductsRepository, ServiceJobsRepository } from './types';

// No Product Instance entity (DECISIONS.md #012 / DATABASE_SCHEMA.md
// `product_instances`) exists in Firestore yet, so there is no canonical
// record of a product a customer owns but has never brought in for service
// — unlike Mock mode's `unservicedProductInstancesByCustomerId` fixture,
// nothing here can honestly synthesize that bucket. Every entry this
// repository returns is derived only from the customer's own real,
// already brand-scoped Service Job history (F5d-48 Objective 2/3) — never
// fabricated, never matched against Product Master by fuzzy name lookup
// (a Service Job has no stable productId FK, only free-text `product`/
// `productCategory`, so any such match could silently be wrong).
const BRAND_NAMES: Readonly<Record<BrandId, string>> = {
  'bruno-thailand': 'Bruno Thailand',
  'join-lux-club': 'Join Lux Club',
};

// Same ordering contract as the Mock repository (registeredProductsRepository.ts):
// most recently serviced first, ties broken by service frequency. There is
// no never-serviced bucket to append after it — see the module comment above.
function compareRegisteredProducts(a: RegisteredProduct, b: RegisteredProduct): number {
  if (a.lastServiceDate !== b.lastServiceDate) {
    return a.lastServiceDate < b.lastServiceDate ? 1 : -1;
  }
  return b.previousServiceCount - a.previousServiceCount;
}

// Builds a customer's registered-product list purely from
// `serviceJobs.getAll()` — already scoped to the authenticated staff's own
// brand by the Firestore Service Job repository's own brand-filtered
// listener query (itself governed by the deployed firestore.rules staff
// brand-ownership check). This function issues no Firestore query of its
// own, so it inherits that brand scoping by construction rather than
// re-deriving it — no new Rules requirement, no risk of a second,
// independently-wrong scoping check.
//
// `customerId` is matched against `ServiceJob.customerPhone`, the same
// informal join key every other part of this codebase already uses
// (customers.mock.ts, searchRepository.ts, Decision #031's accepted
// legacy-ID scheme) — Customer.id and customerPhone are the same value
// under the current phone-number-keyed customer ID scheme.
export function createFirestoreRegisteredProductsRepository(
  serviceJobs: ServiceJobsRepository
): RegisteredProductsRepository {
  return {
    getForCustomer(customerId) {
      const bySerial = new Map<string, RegisteredProduct>();

      for (const job of serviceJobs.getAll()) {
        if (job.customerPhone !== customerId) continue;
        if (!job.brandId) continue;

        const existing = bySerial.get(job.serialNumber);
        if (existing) {
          existing.previousServiceCount += 1;
          if (job.updatedAt > existing.lastServiceDate) {
            existing.lastServiceDate = job.updatedAt;
            existing.warrantyStatus = job.warranty ? 'in_warranty' : 'out_of_warranty';
          }
          continue;
        }

        bySerial.set(job.serialNumber, {
          id: job.serialNumber,
          brand: BRAND_NAMES[job.brandId],
          productName: job.product,
          model: '',
          serialNumber: job.serialNumber,
          category: job.productCategory,
          status: 'Legacy',
          warrantyStatus: job.warranty ? 'in_warranty' : 'out_of_warranty',
          lastServiceDate: job.updatedAt,
          previousServiceCount: 1,
        });
      }

      return Array.from(bySerial.values()).sort(compareRegisteredProducts);
    },
  };
}
