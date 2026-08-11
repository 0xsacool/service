import type { ProductStatus } from './productMaster';

export type WarrantyStatus = 'in_warranty' | 'out_of_warranty';

// A customer-scoped "product identity" read — what the Product Identity
// step (Sprint 2B Phase 3) needs to render a confident-identification card.
// Stands in for the real Product Instance entity (DECISIONS.md #012) until
// Sprint 3/4; `id`/`serialNumber` are the same value today since a serial
// number is the only stable identifier a physical unit has in mock data.
//
// Warranty is modeled as its own attribute (purchaseDate + warrantyMonths,
// with warrantyExpiresAt/warrantyStatus derived from them) rather than
// copied from a service job's warranty flag — a service job records what
// was true *at that visit*, not the product's actual warranty term.
export interface RegisteredProduct {
  id: string;
  brand: string;
  productName: string;
  model: string;
  serialNumber: string;
  category: string;
  status: ProductStatus;
  purchaseDate: string; // ISO date
  warrantyMonths: number;
  warrantyExpiresAt: string; // ISO date, derived: purchaseDate + warrantyMonths
  warrantyStatus: WarrantyStatus; // derived: warrantyExpiresAt vs. now
  lastServiceDate: string; // ISO date, or '—' if never serviced
  previousServiceCount: number;
}
