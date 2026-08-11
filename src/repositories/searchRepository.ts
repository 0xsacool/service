import type { CustomerSearchResult } from '../types';
import type { SearchRepository } from './types';
import { mockServiceJobs } from './mockData/serviceJobs.mock';
import { customerChannelMockByPhone } from './mockData/customerSearch.mock';
import { repositories } from './repositoryProvider';

// Sprint F3.1: customer identity (id/name/phone/email) now comes from
// CustomerRepository via the Repository Provider — repositories.customers —
// instead of this module independently re-deriving it from mockServiceJobs.
// This makes CustomerRepository the single source of truth for customer
// identity in search results: when backendKind is 'firestore', search
// reflects the live Firestore customer list, same as every other
// CustomerRepository consumer, with no change to this file's exported shape.
//
// Enrichment fields — previousServiceJobs/lastVisit (job history) and
// marketplace/username/orderNumber (channel contact) — still come from
// mockServiceJobs/customerChannelMockByPhone, since neither is part of
// CustomerRepository's scope and Service Jobs are explicitly not migrated
// this sprint. Joined by phone number, the same key both CustomerRepository
// implementations use as the record/document id (see customers.mock.ts,
// seedCustomersFromMock.ts) — so the join is correct regardless of which
// backend repositories.customers currently resolves to.
//
// Reading repositories from repositoryProvider.ts here is a circular import
// (repositoryProvider.ts imports searchRepository.ts to build the Mock
// provider) but a safe one: this module only reads the `repositories`
// binding lazily, inside search()/getRecentCustomers() — never at its own
// top level — so by the time either runs, repositoryProvider.ts's top-level
// `await createRepositoryProvider()` has always already resolved it.

interface JobStats {
  previousServiceJobs: number;
  lastVisit: string; // ISO date
}

function deriveJobStatsByPhone(): Map<string, JobStats> {
  const stats = new Map<string, JobStats>();
  for (const job of mockServiceJobs) {
    const existing = stats.get(job.customerPhone);
    if (existing) {
      existing.previousServiceJobs += 1;
      if (job.updatedAt > existing.lastVisit) existing.lastVisit = job.updatedAt;
    } else {
      stats.set(job.customerPhone, { previousServiceJobs: 1, lastVisit: job.updatedAt });
    }
  }
  return stats;
}

// Rebuilt on every call rather than cached once at module load — negligible
// cost at this data size, and it means results always reflect
// CustomerRepository's current state (e.g. a live Firestore snapshot
// update) without needing separate cache-invalidation logic.
function buildCustomerSearchResults(): CustomerSearchResult[] {
  const jobStatsByPhone = deriveJobStatsByPhone();
  const results: CustomerSearchResult[] = [];
  for (const customer of repositories.customers.getAll()) {
    const stats = jobStatsByPhone.get(customer.phone);
    // No service job history for this customer — matches prior behavior,
    // which only ever surfaced customers derived from job records.
    if (!stats) continue;
    const channel = customerChannelMockByPhone[customer.phone];
    results.push({
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      marketplace: channel?.marketplace,
      username: channel?.username,
      orderNumber: channel?.orderNumber,
      previousServiceJobs: stats.previousServiceJobs,
      lastVisit: stats.lastVisit,
    });
  }
  return results;
}

// Tracking number (service job id) and serial number both resolve to the
// customer who owns that job — searching either one is how a staff member
// identifies "who sent this in" from the physical unit or receipt.
function findCustomerByJobField(
  query: string,
  customerSearchResults: CustomerSearchResult[]
): CustomerSearchResult[] {
  const matchedPhones = new Set<string>();
  for (const job of mockServiceJobs) {
    if (matches(job.id, query) || matches(job.serialNumber, query)) {
      matchedPhones.add(job.customerPhone);
    }
  }
  return customerSearchResults.filter((c) => matchedPhones.has(c.phone));
}

function normalizeDigits(value: string): string {
  return value.replace(/\D/g, '');
}

function matches(haystack: string | undefined, query: string): boolean {
  if (!haystack) return false;
  return haystack.toLowerCase().includes(query);
}

function matchesPhone(phone: string, query: string, queryDigits: string): boolean {
  if (matches(phone, query)) return true;
  return queryDigits.length > 0 && normalizeDigits(phone).includes(queryDigits);
}

// Recent-searches has no real session or persistence layer yet (no backend,
// no auth — see PROJECT_STATE.md), so this is an illustrative mock read
// standing in for that future query, not tracked activity.
const recentSearches = ['0182', 'Robert Hayes', 'maggie.chen88'];

export const searchRepository: SearchRepository = {
  search(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const qDigits = normalizeDigits(q);

    const customerSearchResults = buildCustomerSearchResults();

    const directMatches = customerSearchResults.filter(
      (c) =>
        matches(c.name, q) ||
        matchesPhone(c.phone, q, qDigits) ||
        matches(c.marketplace, q) ||
        matches(c.username, q) ||
        matches(c.orderNumber, q)
    );

    const jobFieldMatches = findCustomerByJobField(q, customerSearchResults);

    const byId = new Map<string, CustomerSearchResult>();
    for (const c of [...directMatches, ...jobFieldMatches]) {
      byId.set(c.id, c);
    }
    return Array.from(byId.values());
  },

  getRecentSearches() {
    return recentSearches;
  },

  getRecentCustomers() {
    return buildCustomerSearchResults()
      .sort((a, b) => (a.lastVisit < b.lastVisit ? 1 : -1))
      .slice(0, 3);
  },
};
