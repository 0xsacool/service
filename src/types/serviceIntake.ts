export interface PhotoEvidence {
  id: string;
  dataUrl: string;
  fileName: string;
}

// The staff-facing intake draft captured before a Service Job is created —
// purely client-side state while Customer and Product identity are already
// confirmed. Nothing here is persisted yet; Sprint 4 is what turns this into
// a saved ServiceJob record.
export interface ServiceIntakeData {
  problemDescription: string;
  problemChips: string[];
  accessories: string[];
  internalNotes: string;
  photos: PhotoEvidence[];
}
