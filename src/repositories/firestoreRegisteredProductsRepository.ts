import type { BrandId, RegisteredProduct } from '../types';
import type {
  CustomersRepository,
  RegisteredProductsRepository,
  ServiceJobsRepository,
} from './types';
import { normalizeCanonicalPhone } from './canonicalPhone';

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
// F5d-49B (Terra P1 remediation): `customerId` is a Firestore document ID —
// identity only, never a phone number. A prior version of this file wrongly
// assumed `customerId === job.customerPhone`; that happened to hold under
// today's legacy phone-keyed IDs but is not guaranteed by the model
// (Decision #031 documents opaque IDs as the actual target design). The
// real, documented relationship is `customer.phone` <-> `job.customerPhone`,
// joined through one canonical normalization rule
// (`normalizeCanonicalPhone`) so formatting differences (spaces, dashes,
// parentheses) don't silently break the join, while a missing/blank phone
// on either side fails closed (never matches anything, including another
// blank phone). If more than one scoped customer normalizes to the same
// canonical phone, this fails closed for all of them — Service Job history
// is never guessed onto one of several possible owners.
export function createFirestoreRegisteredProductsRepository(
  customers: CustomersRepository,
  serviceJobs: ServiceJobsRepository
): RegisteredProductsRepository {
  return {
    getForCustomer(customerId) {
      const allCustomers = customers.getAll();
      const customer = allCustomers.find((c) => c.id === customerId);
      if (!customer) return [];

      const targetPhone = normalizeCanonicalPhone(customer.phone);
      if (!targetPhone) return [];

      const ownerIds = new Set(
        allCustomers
          .filter((c) => normalizeCanonicalPhone(c.phone) === targetPhone)
          .map((c) => c.id)
      );
      if (ownerIds.size > 1) return [];

      const bySerial = new Map<string, RegisteredProduct>();

      for (const job of serviceJobs.getAll()) {
        if (!job.brandId) continue;
        if (normalizeCanonicalPhone(job.customerPhone) !== targetPhone) continue;

        // Terra P2: a blank/whitespace-only serial number identifies no
        // physical unit — it must never collapse into a selectable product.
        const serial = job.serialNumber?.trim();
        if (!serial) continue;

        const existing = bySerial.get(serial);
        if (existing) {
          existing.previousServiceCount += 1;
          if (job.updatedAt > existing.lastServiceDate) {
            existing.lastServiceDate = job.updatedAt;
            existing.warrantyStatus = job.warranty ? 'in_warranty' : 'out_of_warranty';
          }
          continue;
        }

        bySerial.set(serial, {
          id: serial,
          brand: BRAND_NAMES[job.brandId],
          productName: job.product,
          model: '',
          serialNumber: serial,
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
