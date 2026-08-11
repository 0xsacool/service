// The shape a Universal Search result renders — a customer-identity summary
// assembled from Customer + marketplace channel + Service Job history, not a
// new persisted entity. See DECISIONS.md #011/#012 (Customer Master,
// marketplace channel contacts) for the real backend shape this stands in
// for until Sprint 3/4.
export interface CustomerSearchResult {
  id: string;
  name: string;
  phone: string;
  email: string;
  marketplace?: string;
  username?: string;
  orderNumber?: string;
  previousServiceJobs: number;
  lastVisit: string; // ISO date
}
