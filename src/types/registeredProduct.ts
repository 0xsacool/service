import type { ProductStatus } from './productMaster';

export type WarrantyStatus = 'in_warranty' | 'out_of_warranty';

// A customer-scoped "product identity" read — what the Product Identity
// step (Sprint 2B Phase 3) needs to render a confident-identification card.
// Stands in for the real Product Instance entity (DECISIONS.md #012) until
// Sprint 3/4; `id`/`serialNumber` are the same value today since a serial
// number is the only stable identifier a physical unit has in mock data.
//
// Warranty is modeled as its own attribute (purchaseDate + warrantyMonths,
// with warrantyExpiresAt derived from them) rather than copied from a
// service job's warranty flag, wherever a real purchase record backs it —
// a service job records what was true *at that visit*, not the product's
// actual warranty term. purchaseDate/warrantyMonths/warrantyExpiresAt are
// optional because no Product Instance entity exists in Firestore yet
// (F5d-48): Mock mode always populates them from its purchase fixtures;
// the Firestore read path (derived only from real Service Job history —
// see firestoreRegisteredProductsRepository.ts) leaves them genuinely
// absent rather than inventing a purchase date, and sets warrantyStatus
// directly from the customer's most recently recorded intake instead.
export interface RegisteredProduct {
  id: string;
  brand: string;
  productName: string;
  model: string;
  serialNumber: string;
  category: string;
  status: ProductStatus;
  purchaseDate?: string; // ISO date — absent when no purchase record backs this entry
  warrantyMonths?: number; // absent when no purchase record backs this entry
  warrantyExpiresAt?: string; // ISO date, derived: purchaseDate + warrantyMonths, when both are known
  warrantyStatus: WarrantyStatus;
  lastServiceDate: string; // ISO date, or '—' if never serviced
  previousServiceCount: number;
}
