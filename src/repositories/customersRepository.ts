import type { CustomersRepository } from './types';
import { customerEntries } from './mockData/customers.mock';

// Sprint F3: the Mock implementation of CustomersRepository — kept alongside
// firestoreCustomersRepository.ts (see repositoryProvider.ts) as the default,
// zero-config backend. customerEntries is derived from service job records;
// see customers.mock.ts.
export const customersRepository: CustomersRepository = {
  getAll() {
    return customerEntries;
  },
};
