import type { ChannelId } from './serviceJob';

export interface PhotoEvidence {
  id: string;
  dataUrl: string;
  fileName: string;
}

// The staff-facing intake draft captured before a Service Job is created —
// purely client-side state while Customer and Product identity are already
// confirmed. Nothing here is persisted yet; Sprint 4 is what turns this into
// a saved ServiceJob record.
//
// F5d-69 — contactChannelIdentity/orderNumber/purchaseDate/orderDeliveredDate/
// externalEvidenceUrl/externalEvidenceNote are plain editable strings here
// (never `| null`), matching every other free-text intake field
// (problemDescription, internalNotes) — trimming and blank-to-null
// collapsing happen exactly once, at payload-build time
// (buildServiceJobIntakePayload in services/serviceJobCreation.ts), not
// scattered across each field's onChange handler. orderVerification is
// deliberately absent: it is never directly edited during intake (staff
// corrects it later on Service Job Details), always derived from
// orderNumber's presence at payload-build time.
export interface ServiceIntakeData {
  problemDescription: string;
  problemChips: string[];
  accessories: string[];
  internalNotes: string;
  photos: PhotoEvidence[];
  contactChannel: ChannelId | null;
  contactChannelIdentity: string;
  orderNumber: string;
  purchaseDate: string;
  orderDeliveredDate: string;
  externalEvidenceUrl: string;
  externalEvidenceNote: string;
}
