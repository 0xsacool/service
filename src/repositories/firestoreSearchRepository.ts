import type { CustomerSearchResult } from '../types';
import type {
  CustomersRepository,
  SearchRepository,
  ServiceJobsRepository,
} from './types';
import { matches, matchesPhone, normalizeDigits } from './searchMatching';
import { normalizeCanonicalPhone } from './canonicalPhone';

// Firestore implementation of SearchRepository (F5d-49). Built the same way
// as the Mock implementation (searchRepository.ts) and sharing its matching
// helpers, but reading real, already brand-scoped `customers`/`serviceJobs`
// repositories instead of mockServiceJobs/customerChannelMockByPhone — no
// new Firestore query, no independent brand check: both underlying
// repositories are already scoped to the authenticated staff's own brand
// (customers via `brandIds array-contains`, serviceJobs via `brandId ==`),
// so this module inherits that scoping by construction.
//
// Marketplace username and order number (DATABASE_SCHEMA.md
// `customer_channel_contacts` / `product_instances.order_reference`) have
// no Firestore collection at all — no Product Instance or channel-contact
// entity has ever been migrated (DECISIONS.md #012/#013/#037). Those two
// search dimensions are therefore genuinely unsupported here: every result
// leaves `marketplace`/`username`/`orderNumber` undefined rather than
// inventing a value.
//
// F5d-49B (Terra P1 remediation): a customer's Firestore document ID is
// identity only, never a phone number. Service Job job-history attribution
// (used for `previousServiceJobs`/`lastVisit`, and for resolving a
// tracking-/serial-number query back to its owning customer) joins through
// one canonical normalization rule (`normalizeCanonicalPhone`), never
// through document IDs or raw string equality. A missing/blank phone on
// either side never matches anything. If more than one scoped customer
// normalizes to the same canonical phone, that phone is treated as
// unresolved: none of the colliding customers are shown in search at all,
// rather than guessing which one "really" owns the shared history.

interface JobStats {
  previousServiceJobs: number;
  lastVisit: string; // ISO date
}

function deriveJobStatsByCanonicalPhone(
  serviceJobs: ServiceJobsRepository
): Map<string, JobStats> {
  const stats = new Map<string, JobStats>();
  for (const job of serviceJobs.getAll()) {
    const phone = normalizeCanonicalPhone(job.customerPhone);
    if (!phone) continue;
    const existing = stats.get(phone);
    if (existing) {
      existing.previousServiceJobs += 1;
      if (job.updatedAt > existing.lastVisit) existing.lastVisit = job.updatedAt;
    } else {
      stats.set(phone, { previousServiceJobs: 1, lastVisit: job.updatedAt });
    }
  }
  return stats;
}

// Canonical phones shared by more than one scoped customer — these are
// excluded from every result set below (Terra P1: duplicate-phone
// fail-closed), never merged and never arbitrarily attributed to one of
// the colliding customers.
function findAmbiguousCanonicalPhones(customers: CustomersRepository): Set<string> {
  const ownerCounts = new Map<string, number>();
  for (const customer of customers.getAll()) {
    const phone = normalizeCanonicalPhone(customer.phone);
    if (!phone) continue;
    ownerCounts.set(phone, (ownerCounts.get(phone) ?? 0) + 1);
  }
  const ambiguous = new Set<string>();
  for (const [phone, count] of ownerCounts) {
    if (count > 1) ambiguous.add(phone);
  }
  return ambiguous;
}

// Rebuilt on every call, same rationale as the Mock implementation: reflects
// the live Firestore snapshot without separate cache-invalidation logic.
function buildCustomerSearchResults(
  customers: CustomersRepository,
  serviceJobs: ServiceJobsRepository
): CustomerSearchResult[] {
  const jobStatsByPhone = deriveJobStatsByCanonicalPhone(serviceJobs);
  const ambiguousPhones = findAmbiguousCanonicalPhones(customers);
  const results: CustomerSearchResult[] = [];
  for (const customer of customers.getAll()) {
    const phone = normalizeCanonicalPhone(customer.phone);
    if (!phone) continue;
    if (ambiguousPhones.has(phone)) continue;
    const stats = jobStatsByPhone.get(phone);
    // No service job history for this customer — same behavior as Mock:
    // only customers derivable from real job records are surfaced. Every
    // customer document that exists today was itself seeded from Service
    // Job data, so this excludes nothing that could otherwise be selected.
    if (!stats) continue;
    results.push({
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      marketplace: undefined,
      username: undefined,
      orderNumber: undefined,
      previousServiceJobs: stats.previousServiceJobs,
      lastVisit: stats.lastVisit,
    });
  }
  return results;
}

// Tracking number (Service Job id) and serial number both resolve to the
// customer who owns that job — same lookup Mock provides, joined through
// the same canonical phone as everything else in this module.
function findCustomerByJobField(
  query: string,
  serviceJobs: ServiceJobsRepository,
  customerSearchResults: CustomerSearchResult[]
): CustomerSearchResult[] {
  const matchedPhones = new Set<string>();
  for (const job of serviceJobs.getAll()) {
    if (matches(job.id, query) || matches(job.serialNumber, query)) {
      const phone = normalizeCanonicalPhone(job.customerPhone);
      if (phone) matchedPhones.add(phone);
    }
  }
  return customerSearchResults.filter((c) => {
    const phone = normalizeCanonicalPhone(c.phone);
    return phone !== null && matchedPhones.has(phone);
  });
}

export function createFirestoreSearchRepository(
  customers: CustomersRepository,
  serviceJobs: ServiceJobsRepository
): SearchRepository {
  return {
    search(query) {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      const qDigits = normalizeDigits(q);

      const customerSearchResults = buildCustomerSearchResults(customers, serviceJobs);

      const directMatches = customerSearchResults.filter(
        (c) => matches(c.name, q) || matchesPhone(c.phone, q, qDigits)
      );

      const jobFieldMatches = findCustomerByJobField(
        q,
        serviceJobs,
        customerSearchResults
      );

      const byId = new Map<string, CustomerSearchResult>();
      for (const c of [...directMatches, ...jobFieldMatches]) {
        byId.set(c.id, c);
      }
      return Array.from(byId.values());
    },

    // No session/persistence layer exists for tracked search history in
    // either backend (see Mock's own comment) — Firestore mode does not
    // invent one; unlike Mock's illustrative placeholder strings, this
    // returns nothing rather than fabricated "recent" terms.
    getRecentSearches() {
      return [];
    },

    getRecentCustomers() {
      return buildCustomerSearchResults(customers, serviceJobs)
        .sort((a, b) => (a.lastVisit < b.lastVisit ? 1 : -1))
        .slice(0, 3);
    },
  };
}
