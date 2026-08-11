import type { CustomerSearchResult } from '../../../types';
import { useUniversalSearch } from '../../../hooks/useUniversalSearch';
import { SearchInput } from './SearchInput';
import { SearchResults } from './SearchResults';
import { SearchEmptyState } from './SearchEmptyState';
import { SearchNoResults } from './SearchNoResults';
import { SearchLoadingState } from './SearchLoadingState';

export interface UniversalSearchProps {
  onSelectCustomer?: (customer: CustomerSearchResult) => void;
  onCreateNewCustomer?: (query: string) => void;
  placeholder?: string;
  className?: string;
}

// Search foundation shared across every screen that needs to resolve "who is
// this" from a single input — Dashboard, New Service Job, Customer
// Directory, Product Directory, Service Jobs, Tracking (SPRINT_ROADMAP.md
// Sprint 2B). Phase 1 builds and validates the component in isolation; each
// screen's own integration is a later phase, so onSelectCustomer and
// onCreateNewCustomer are left for the consuming page to wire up.
export function UniversalSearch({
  onSelectCustomer,
  onCreateNewCustomer,
  placeholder,
  className = '',
}: UniversalSearchProps) {
  const {
    query,
    setQuery,
    hasQuery,
    results,
    recentSearches,
    recentCustomers,
    isLoading,
  } = useUniversalSearch();

  return (
    <div className={className}>
      <SearchInput value={query} onChange={setQuery} placeholder={placeholder} />
      <div className="mt-6">
        {isLoading ? (
          <SearchLoadingState />
        ) : !hasQuery ? (
          <SearchEmptyState
            recentSearches={recentSearches}
            recentCustomers={recentCustomers}
            onSelectRecentSearch={setQuery}
            onSelectCustomer={onSelectCustomer}
          />
        ) : results.length > 0 ? (
          <SearchResults results={results} onSelectCustomer={onSelectCustomer} />
        ) : (
          <SearchNoResults
            query={query}
            onCreateNew={() => onCreateNewCustomer?.(query)}
          />
        )}
      </div>
    </div>
  );
}
