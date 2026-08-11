import type { CustomerSearchResult } from '../../../types';
import { CustomerResultCard } from './CustomerResultCard';

export function SearchResults({
  results,
  onSelectCustomer,
}: {
  results: CustomerSearchResult[];
  onSelectCustomer?: (customer: CustomerSearchResult) => void;
}) {
  return (
    <div className="stagger space-y-3">
      {results.map((customer) => (
        <CustomerResultCard
          key={customer.id}
          customer={customer}
          onSelect={onSelectCustomer}
        />
      ))}
    </div>
  );
}
