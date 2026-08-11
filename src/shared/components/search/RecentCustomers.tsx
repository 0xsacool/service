import { Users } from 'lucide-react';
import type { CustomerSearchResult } from '../../../types';
import { CustomerResultCard } from './CustomerResultCard';

export function RecentCustomers({
  customers,
  onSelectCustomer,
}: {
  customers: CustomerSearchResult[];
  onSelectCustomer?: (customer: CustomerSearchResult) => void;
}) {
  if (customers.length === 0) return null;

  return (
    <div>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-neutral-500">
        <Users className="h-4 w-4" />
        ลูกค้าที่ค้นหาล่าสุด
      </h3>
      <div className="space-y-3">
        {customers.map((customer) => (
          <CustomerResultCard
            key={customer.id}
            customer={customer}
            onSelect={onSelectCustomer}
          />
        ))}
      </div>
    </div>
  );
}
