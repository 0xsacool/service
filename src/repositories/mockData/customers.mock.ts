import { isCanonicalBrandId, type Customer } from '../../types';
import { mockServiceJobs } from './serviceJobs.mock';

// Derived from service job records rather than hand-authored, so mock customer
// data can never drift out of sync with the service jobs that reference it —
// same derivation customersRepository.ts always used, moved here (Sprint F3)
// so seedCustomersFromMock.ts has a plain fixture array to read, matching the
// productMasterEntries / productMaster.mock.ts split the Firestore Product
// Master migration established.
function deriveCustomers(): Customer[] {
  const byPhone = new Map<string, Customer>();
  for (const job of mockServiceJobs) {
    const existing = byPhone.get(job.customerPhone);
    if (!existing) {
      byPhone.set(job.customerPhone, {
        id: job.customerPhone,
        name: job.customerName,
        phone: job.customerPhone,
        email: job.customerEmail,
        brandIds: job.brandId && isCanonicalBrandId(job.brandId) ? [job.brandId] : [],
      });
    } else if (
      job.brandId &&
      isCanonicalBrandId(job.brandId) &&
      !existing.brandIds.includes(job.brandId)
    ) {
      existing.brandIds.push(job.brandId);
    }
  }
  return Array.from(byPhone.values()).filter((customer) => customer.brandIds.length > 0);
}

export const customerEntries: Customer[] = deriveCustomers();
