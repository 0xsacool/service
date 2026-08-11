import { useMemo, useState } from 'react';
import type { CustomerSearchResult } from '../types';
import { repositories } from '../repositories/repositoryProvider';

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

// Search is synchronous today (mock, in-memory). `results` is computed with
// useMemo keyed on `query` specifically so Phase 2 can swap this for a
// debounced async call to repositories.search.search() — replacing the
// useMemo with a debounced effect that sets isLoading — without changing
// what this hook returns or how UniversalSearch consumes it. Resolved
// through the Repository Provider — see repositoryProvider.ts.
export function useUniversalSearch(): UseUniversalSearchResult {
  const [query, setQuery] = useState('');

  const results = useMemo(() => repositories.search.search(query), [query]);

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
