import type { ServiceJob } from '../types';

// F5d-70 Phase 5B — pure, framework-free helpers backing the approved
// conflict policy for ServiceJobDetails: LOCAL LAST WRITE WINS, DIRTY
// FIELDS ONLY. A field/group tracks the newest persisted claim only while
// pristine (the local draft still equals what was last shown for that
// field); once the user has diverged from that, incoming persisted data
// must never overwrite the local draft. Kept dependency-free so the policy
// itself is directly unit-testable without mounting React.

// Notes are compared by content, not reference: every Firestore onSnapshot
// event reconstructs fresh ServiceJob objects (including fresh arrays) for
// every document in the query result, even ones whose data didn't actually
// change — so `===` would misreport an untouched notes array as dirty on
// every unrelated Service Job's update.
export function notesEqual(a: ServiceJob['notes'], b: ServiceJob['notes']): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((note, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      note.author === other.author &&
      note.date === other.date &&
      note.text === other.text
    );
  });
}

// Generic single-field reconciliation: if the local draft still equals what
// was last shown (`previous`), it is pristine and adopts the fresh value
// (`next`); otherwise the user has diverged from it, so the local override
// is preserved untouched. `isEqual` defaults to `===`, sufficient for every
// primitive/enum field this is used for; notes uses notesEqual instead.
export function reconcileField<T>(
  local: T,
  previous: T,
  next: T,
  isEqual: (a: T, b: T) => boolean = (a, b) => a === b
): T {
  return isEqual(local, previous) ? next : local;
}
