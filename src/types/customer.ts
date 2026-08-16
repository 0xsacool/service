import type { BrandId } from './brand';

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  brandIds: BrandId[];
}

// F5d-65 — the fields staff enter for a walk-in customer who doesn't exist
// yet. Deliberately just these three (BUSINESS_RULES.md "Intake Workflow &
// Required Fields": name + phone required, email optional) — no marketplace/
// channel fields, no address, nothing a durable Customer document doesn't
// already carry. Held as client-side pending state only until Save & Print;
// see services/serviceJobCreation.ts's IntakeCustomer for how this combines
// with an already-existing CustomerSearchResult under one discriminated type.
export interface NewCustomerDraft {
  name: string;
  phone: string;
  email: string;
}

export function createEmptyNewCustomerDraft(): NewCustomerDraft {
  return { name: '', phone: '', email: '' };
}
