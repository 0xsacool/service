import type { CustomerSearchResult, ServiceJob } from '../types';
import type {
  CustomersRepository,
  SearchRepository,
  ServiceJobsRepository,
} from './types';
import {
  matches,
  matchesChannelIdentity,
  matchesOrderNumber,
  matchesPhone,
  normalizeDigits,
} from './searchMatching';
import { normalizeCanonicalPhone } from './canonicalPhone';
import { compareServiceJobsByRecency, mostRecentJobWithContactChannel } from '../services/serviceJobHistory';
import { channelLabel } from '../services/serviceJobPresentation';

// Firestore implementation of SearchRepository (F5d-49). Built the same way
// as the Mock implementation (searchRepository.ts) and sharing its matching
// helpers, but reading real, already brand-scoped `customers`/`serviceJobs`
// repositories instead of mockServiceJobs/customerChannelMockByPhone — no
// new Firestore query, no independent brand check: both underlying
// repositories are already scoped to the authenticated staff's own brand
// (customers via `brandIds array-contains`, serviceJobs via `brandId ==`),
// so this module inherits that scoping by construction.
//
// F5d-69 / DECISIONS.md #041 — marketplace username and order number are
// now real fields on ServiceJob itself (contactChannelIdentity/orderNumber),
// so this dimension is genuinely supported here — no separate
// `customer_channel_contacts`/`product_instances` collection was ever
// created (#012/#013/#037 remain otherwise unimplemented), no new Firestore
// query, and no new index: every match is computed in memory against the
// already brand-scoped, already-loaded `serviceJobs` list this module reads
// for tracking/serial matching too. `marketplace`/`username`/`orderNumber`
// on the returned CustomerSearchResult are a deterministic *projection* of
// whichever Service Job actually matched (or, for a name/phone/tracking/
// serial match, the customer's own most recent job with a non-null
// contactChannel) — never a canonical customer-level value, since no such
// value exists (#013 stays only partially implemented).
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
// Leaves marketplace/username/orderNumber unset — search() below fills
// those in per result, since which job's data is "correct" to show depends
// on how (or whether) each customer actually matched this particular query.
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
  allJobs: ServiceJob[],
  customerSearchResults: CustomerSearchResult[]
): CustomerSearchResult[] {
  const matchedPhones = new Set<string>();
  for (const job of allJobs) {
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

function groupJobsByCanonicalPhone(allJobs: ServiceJob[]): Map<string, ServiceJob[]> {
  const byPhone = new Map<string, ServiceJob[]>();
  for (const job of allJobs) {
    const phone = normalizeCanonicalPhone(job.customerPhone);
    if (!phone) continue;
    const existing = byPhone.get(phone);
    if (existing) existing.push(job);
    else byPhone.set(phone, [job]);
  }
  return byPhone;
}

// Deterministic "which job matched" selection for a search dimension —
// createdAt DESC, then job id DESC (compareServiceJobsByRecency), never
// dependent on Map/array iteration order.
function findMostRecentMatch(
  jobs: ServiceJob[],
  predicate: (job: ServiceJob) => boolean
): ServiceJob | null {
  let best: ServiceJob | null = null;
  for (const job of jobs) {
    if (!predicate(job)) continue;
    if (!best || compareServiceJobsByRecency(job, best) < 0) best = job;
  }
  return best;
}

// The fallback projection for a customer matched by name/phone/tracking/
// serial — their own most recent job carrying a non-null contact channel,
// independent of what (if anything) about this query matched.
function fallbackChannelProjection(jobs: ServiceJob[]): Partial<CustomerSearchResult> {
  const recent = mostRecentJobWithContactChannel(jobs);
  if (!recent?.contactChannel) return {};
  return {
    marketplace: channelLabel(recent.contactChannel),
    username: recent.contactChannelIdentity ?? undefined,
  };
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

      const allJobs = serviceJobs.getAll();
      const customerSearchResults = buildCustomerSearchResults(customers, serviceJobs);
      const jobsByPhone = groupJobsByCanonicalPhone(allJobs);
      const jobsFor = (customer: CustomerSearchResult): ServiceJob[] => {
        const phone = normalizeCanonicalPhone(customer.phone);
        return phone ? (jobsByPhone.get(phone) ?? []) : [];
      };

      const directMatches = customerSearchResults.filter(
        (c) => matches(c.name, q) || matchesPhone(c.phone, q, qDigits)
      );
      const jobFieldMatches = findCustomerByJobField(q, allJobs, customerSearchResults);

      const results = new Map<string, CustomerSearchResult>();
      for (const c of [...directMatches, ...jobFieldMatches]) {
        results.set(c.id, { ...c, ...fallbackChannelProjection(jobsFor(c)) });
      }

      // Order number / channel identity matches. Each customer's own jobs
      // are checked independently of the two match sets above, and a match
      // here always overrides the generic "most recent channel" fallback
      // with the specific job that actually matched — a customer can match
      // (and project) both dimensions at once if two different jobs each
      // matched a different one.
      for (const c of customerSearchResults) {
        const jobs = jobsFor(c);
        if (jobs.length === 0) continue;
        const orderMatch = findMostRecentMatch(jobs, (job) => matchesOrderNumber(job.orderNumber, q));
        const identityMatch = findMostRecentMatch(jobs, (job) =>
          matchesChannelIdentity(job.contactChannelIdentity, q)
        );
        if (!orderMatch && !identityMatch) continue;
        const projection: Partial<CustomerSearchResult> = {};
        if (orderMatch) projection.orderNumber = orderMatch.orderNumber ?? undefined;
        if (identityMatch?.contactChannel) {
          projection.marketplace = channelLabel(identityMatch.contactChannel);
          projection.username = identityMatch.contactChannelIdentity ?? undefined;
        }
        const existing = results.get(c.id) ?? { ...c, ...fallbackChannelProjection(jobs) };
        results.set(c.id, { ...existing, ...projection });
      }

      return Array.from(results.values());
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
