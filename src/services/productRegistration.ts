import type {
  ProductMasterEntry,
  RegisteredProduct,
  ServiceJob,
  WarrantyStatus,
} from '../types';
import type { ValidationResult } from '../validation/types';
import { VALID } from '../validation/types';

// F5d-65 — DECISIONS.md #037/#012: no Product Instance entity exists in any
// backend, and this task does not introduce one (see PROJECT_STATE.md /
// DATABASE_SCHEMA.md's own tracked gap). "Register New Product" therefore
// means only "collect product identity for this Service Job's intake" — the
// same product/productCategory/serialNumber free-text fields the Service Job
// already stores for an existing, derived RegisteredProduct. Nothing here is
// persisted independently; buildManualRegisteredProduct()'s output flows
// into the same NewServiceJobInput.product slot a selected ProductCard would.
//
// F5d-65 blocker fix (P1 #1): warrantyStatus is deliberately NOT a field on
// this type. An earlier cut carried it here with an 'out_of_warranty'
// default, while the form held the staff member's real radio selection in
// separate state — so a staff member choosing "in warranty" still produced
// warranty: false on the durable Service Job. Warranty is now a required,
// explicitly-passed argument to buildManualRegisteredProduct() instead:
// there is no second copy to drift from, and no default anywhere in this
// module, so an unselected warranty cannot silently become a real value.
export interface ManualProductEntry {
  brand: string;
  productName: string;
  model: string;
  category: string;
  serialNumber: string;
}

export function createEmptyManualProductEntry(): ManualProductEntry {
  return {
    brand: '',
    productName: '',
    model: '',
    category: '',
    serialNumber: '',
  };
}

// Warranty is required and has no default: a caller cannot construct a
// manual product without stating which of the two known WarrantyStatus
// values the staff member actually confirmed. The domain union itself is
// unchanged ('in_warranty' | 'out_of_warranty') — "not yet chosen" is form
// state (WarrantyStatus | null), never a persisted third value.
//
// A matched Product Master catalog entry (brand/product/model picked from
// the existing, already brand-neutral catalog — DECISIONS.md #030) carries
// its own real status; a fully free-text entry (the model_other escape
// hatch, BUSINESS_RULES.md) gets 'Legacy', the same fallback both existing
// repository derivations already use for a product with no catalog match.
export function buildManualRegisteredProduct(
  entry: ManualProductEntry,
  warrantyStatus: WarrantyStatus,
  matchedCatalogEntry?: ProductMasterEntry
): RegisteredProduct {
  const serial = entry.serialNumber.trim();
  return {
    // No stable natural key exists for a manual entry with a blank serial —
    // this id is a local selection token only (React key / "which card is
    // selected"), never sent to the Worker: NewServiceJobInput.product is
    // flattened into free-text productName/model/category/serialNumber by
    // buildServiceJobIntakePayload(), which never reads .id.
    id: serial || `manual-${crypto.randomUUID()}`,
    brand: entry.brand.trim(),
    productName: entry.productName.trim(),
    model: entry.model.trim(),
    serialNumber: serial,
    category: entry.category.trim(),
    status: matchedCatalogEntry?.status ?? 'Legacy',
    warrantyStatus,
    lastServiceDate: '—',
    previousServiceCount: 0,
  };
}

// The submit gate for manual registration, extracted as a pure function so
// "an unconfirmed warranty blocks submission" is a directly testable rule
// rather than something only reachable through a rendered component.
export function validateManualProductEntry(
  entry: ManualProductEntry,
  warrantyStatus: WarrantyStatus | null
): ValidationResult {
  const errors: Record<string, string> = {};
  if (!entry.productName.trim()) errors.productName = 'กรุณากรอกชื่อสินค้า';
  if (!entry.category.trim()) errors.category = 'กรุณากรอกหมวดหมู่';
  // No default is applied when this is null — the staff member must confirm
  // the unit's real warranty state before this path can complete.
  if (warrantyStatus === null) {
    errors.warrantyStatus = 'กรุณาตรวจสอบและเลือกสถานะการรับประกันของเครื่องนี้';
  }
  if (Object.keys(errors).length > 0) return { valid: false, errors };
  return VALID;
}

export type SerialHistoryCheck =
  { kind: 'clear' } | { kind: 'already-in-service-history' };

// F5d-65 blocker fix (P1 #2). An earlier cut decided whether a serial
// "belongs to" the selected customer by comparing normalized phone numbers,
// then either auto-selected that customer's existing product or declared a
// cross-customer conflict. That was invalid: BUSINESS_RULES.md explicitly
// allows two distinct customers to share one phone number ("a shared
// household phone is plausible"), and the historical Service Job model has
// no stable customer foreign key (Decision #039 — the phone join is an
// accepted *legacy* convenience, never an identity proof). Phone equality
// therefore cannot establish ownership, and a blank/unresolvable historical
// phone must not become an ownership exception either.
//
// This function makes no ownership claim at all. It answers only the
// question it can actually answer from already-loaded, already brand-scoped
// data: does this exact serial already appear anywhere in Service Job
// history? If it does, manual registration is blocked and staff are told to
// verify and select the existing customer/product through the normal search
// path instead. A blank serial is always clear — it identifies no physical
// unit, so it can neither match nor conflict (BUSINESS_RULES.md's own
// accepted "no serial → no history linkage" limitation, unchanged here).
//
// Known limitation, deliberately not papered over: this check sees only the
// Service Jobs currently loaded in the authenticated staff member's own
// brand-scoped cache, so it is advisory and client-side. Server-side
// enforcement is recorded as P2 hardening — it cannot be built safely today
// without either a phone-based ownership rule (rejected above) or schema
// expansion (out of F5d-65's approved scope).
export function checkSerialAgainstServiceHistory(
  serialNumber: string,
  allServiceJobs: ServiceJob[]
): SerialHistoryCheck {
  const serial = serialNumber.trim().toLowerCase();
  if (!serial) return { kind: 'clear' };

  const known = allServiceJobs.some(
    (job) => job.serialNumber.trim().toLowerCase() === serial
  );
  return known ? { kind: 'already-in-service-history' } : { kind: 'clear' };
}
