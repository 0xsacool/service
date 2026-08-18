import type { ChannelId, OrderVerification } from '../types';

export interface ServiceEventMetadataDraft {
  contactChannel: ChannelId | null;
  contactChannelIdentity: string | null;
  orderNumber: string | null;
  orderVerification: OrderVerification | null;
}

// F5d-69 / DECISIONS.md #041 — the same two cross-field invariants the
// Worker resolves at creation (resolveIntakeMetadata,
// worker/src/serviceJobCreation.ts) and Firestore Rules re-enforce on every
// later edit (validServiceEventMetadataInvariants): an identity cannot
// outlive the channel it belongs to (and 'phone' never carries its own —
// the customer's canonical phone already is that identity), and a
// verification state is meaningless without an order number, while an
// order number with no stated verification defaults to 'unverified'. Both
// the New Service Job intake payload (serviceJobCreation.ts) and the
// Service Job Details save path (serviceJobUpdate.ts) resolve through this
// one function so a client-side bug can never persist a state the
// server-side boundaries would have refused anyway — this is UX-only
// defense-in-depth, never the actual security boundary.
export function resolveServiceEventMetadataInvariants<T extends ServiceEventMetadataDraft>(
  draft: T
): T {
  const contactChannelIdentity =
    draft.contactChannel === null || draft.contactChannel === 'phone'
      ? null
      : draft.contactChannelIdentity;
  const orderVerification =
    draft.orderNumber === null ? null : (draft.orderVerification ?? 'unverified');
  return { ...draft, contactChannelIdentity, orderVerification };
}
