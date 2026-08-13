import { useMemo, useState, useSyncExternalStore } from 'react';
import type { CustomerSearchResult } from '../types';
import { repositories } from '../repositories/repositoryProvider';
import { getDataVersion, subscribeToDataVersion } from '../repositories/dataVersion';

export interface UseUniversalSearchResult {
  query: string;
  setQuery: (query: string) => void;
  hasQuery: boolean;
  results: CustomerSearchResult[];
  recentSearches: string[];
  recentCustomers: CustomerSearchResult[];
  isLoading: false;
  error: null;
}

// Search is synchronous today (mock, in-memory or a live Firestore listener
// cache). `results` is computed with useMemo keyed on `query` and
// `dataVersion` so Phase 2 can swap this for a debounced async call to
// repositories.search.search() — replacing the useMemo with a debounced
// effect that sets isLoading — without changing what this hook returns or
// how UniversalSearch consumes it. Resolved through the Repository
// Provider — see repositoryProvider.ts.
//
// F5d-49B (Terra P1 remediation): a Firestore-mode `search()` call reads a
// live `onSnapshot` cache that can change without `query` ever changing —
// e.g. a new Service Job lands for an already-visible customer. Memoizing
// on `query` alone left that update invisible until the user typed
// something. `dataVersion` (bumped by firestoreCustomersRepository.ts /
// firestoreServiceJobRepository.ts inside their own snapshot handlers) is
// read here through `useSyncExternalStore` — React's built-in primitive for
// subscribing a component to an external mutable store — so this hook
// (and anything reading its `results`) re-renders whenever the underlying
// data actually changes, with no polling and no extra Firestore query.
// Mock mode never calls `bumpDataVersion()`, so this is a no-op there.
export function useUniversalSearch(): UseUniversalSearchResult {
  const [query, setQuery] = useState('');
  const dataVersion = useSyncExternalStore(
    subscribeToDataVersion,
    getDataVersion,
    getDataVersion
  );

  const results = useMemo(() => {
    // dataVersion is intentionally unread here — it's a recompute trigger
    // only, not a value the search call needs (see the comment above).
    void dataVersion;
    return repositories.search.search(query);
  }, [query, dataVersion]);

  return {
    query,
    setQuery,
    hasQuery: query.trim().length > 0,
    results,
    recentSearches: repositories.search.getRecentSearches(),
    recentCustomers: repositories.search.getRecentCustomers(),
    isLoading: false,
    error: null,
  };
}
