// F5d-49B (Terra P1 remediation): the smallest explicit signal needed to
// make a `useMemo`/`useSyncExternalStore`-based hook re-run when a
// Firestore repository's live `onSnapshot` cache changes, without the
// React-Context-based repository store this project deliberately doesn't
// have (DECISIONS.md #017) and without polling. Firestore repositories call
// `bumpDataVersion()` from inside their own `onSnapshot` callback, right
// after updating their local cache — see firestoreCustomersRepository.ts /
// firestoreServiceJobRepository.ts. Consumers read `getDataVersion()`
// through `useSyncExternalStore`; React re-renders them whenever the
// version changes, same as any other external store.
//
// One shared counter across every Firestore-backed repository, not one per
// collection — simpler, and every current consumer (Universal Search) reads
// both customers and Service Jobs together anyway, so a coarser signal
// costs nothing and avoids two separate subscriptions.

let version = 0;
const listeners = new Set<() => void>();

export function bumpDataVersion(): void {
  version += 1;
  for (const listener of listeners) listener();
}

export function getDataVersion(): number {
  return version;
}

export function subscribeToDataVersion(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
