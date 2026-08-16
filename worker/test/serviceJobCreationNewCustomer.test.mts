import {
  allocateServiceJob,
  parseServiceJobCreateRequest,
  TransactionConflictError,
  type AllocationTransaction,
  type NewCustomerAllocation,
  type ServiceJobCreationDataAccess,
} from '../src/serviceJobCreation.ts';
import type { ServiceJob } from '../../src/types/serviceJob.ts';

let failures = 0;
function check(name: string, value: boolean) {
  if (value) console.log(`  PASS  ${name}`);
  else {
    failures += 1;
    console.error(`  FAIL  ${name}`);
  }
}

// F5d-65 — approved architecture: new-customer creation is Worker-only, part
// of the same atomic Service Job transaction, using an opaque generated id
// (never a phone-keyed one), with brandId always derived server-side. This
// file proves the request parser fails closed on malformed/ambiguous shapes
// (Category C) and the allocator's identity/atomicity guarantees
// (Categories D/F/E) using a fake, in-memory ServiceJobCreationDataAccess —
// no network, no real Firestore.

const rawIntake = {
  customerName: 'Walk-in Customer',
  customerPhone: '0891234567',
  customerEmail: '',
  product: 'Product',
  productCategory: 'Other',
  serialNumber: '',
  problemDescription: 'Broken',
  problemChips: [],
  accessories: [],
  internalNotes: '',
  photos: [],
  warranty: false,
};

// --- C: request-shape validation ------------------------------------------

check(
  'a well-formed existing-customer request parses',
  parseServiceJobCreateRequest({
    intake: rawIntake,
    customer: { kind: 'existing', customerId: 'cust-1' },
  }) !== null
);
check(
  'a well-formed new-customer request parses',
  parseServiceJobCreateRequest({ intake: rawIntake, customer: { kind: 'new' } }) !== null
);
// Legacy compatibility: Worker and frontend deploy through separate,
// sequential gates in this project (confirmed by this project's own rollout
// history — Gate 7's Worker deploy landed before F5d-61/62's frontend
// deploy), so a newly deployed Worker must keep accepting the exact body a
// still-live older frontend sends: `{ intake }`, no `customer` key at all.
{
  const parsed = parseServiceJobCreateRequest({ intake: rawIntake });
  check('the legacy { intake }-only body (no customer key) is still accepted', parsed !== null);
  check(
    'a legacy request is treated as an existing customer with no id — never a new-customer branch',
    parsed?.customer.kind === 'existing' && parsed.customer.customerId === ''
  );
}
check('an empty body is rejected', parseServiceJobCreateRequest({}) === null);
check(
  'a 2-key body with intake plus an unrelated key (not customer) is rejected',
  parseServiceJobCreateRequest({ intake: rawIntake, somethingElse: true }) === null
);
check(
  'an existing branch missing customerId is rejected',
  parseServiceJobCreateRequest({ intake: rawIntake, customer: { kind: 'existing' } }) ===
    null
);
check(
  'an existing branch with a blank customerId is rejected',
  parseServiceJobCreateRequest({
    intake: rawIntake,
    customer: { kind: 'existing', customerId: '' },
  }) === null
);
check(
  'a new branch that also smuggles a customerId is rejected (ambiguous mixed state)',
  parseServiceJobCreateRequest({
    intake: rawIntake,
    customer: { kind: 'new', customerId: 'cust-1' },
  }) === null
);
check(
  'an unknown kind is rejected',
  parseServiceJobCreateRequest({
    intake: rawIntake,
    customer: { kind: 'both', customerId: 'cust-1' },
  }) === null
);
check(
  'a non-object customer value is rejected',
  parseServiceJobCreateRequest({ intake: rawIntake, customer: 'new' }) === null
);
check(
  'an extra top-level key beyond intake/customer is rejected',
  parseServiceJobCreateRequest({
    intake: rawIntake,
    customer: { kind: 'new' },
    extra: true,
  }) === null
);

// --- E: brandId can never be client-supplied -------------------------------
// Neither branch of the selector has a brandId field at all — a client
// attempting to smuggle one in is just an unexpected key, caught by the same
// allowlist-discipline rejection as any other malformed shape.
check(
  'a client-supplied brandId on the new-customer branch is rejected outright',
  parseServiceJobCreateRequest({
    intake: rawIntake,
    customer: { kind: 'new', brandId: 'join-lux-club' },
  }) === null
);

// --- D/F: allocator identity + atomicity, via a fake data access ----------

class FakeStore implements ServiceJobCreationDataAccess {
  jobs = new Map<string, ServiceJob>();
  keys = new Map<string, string>();
  customers = new Map<string, NewCustomerAllocation>();
  tracking = 0;
  requests = 0;
  conflicts = 0;
  commitAttempts = 0;
  successfulCommits = 0;
  async beginServiceJobTransaction(): Promise<AllocationTransaction> {
    return { id: crypto.randomUUID() };
  }
  async getIntakeKey(_: AllocationTransaction, id: string) {
    return this.keys.get(id) ?? null;
  }
  async getSequence(
    _: AllocationTransaction,
    __: 'bruno-thailand' | 'join-lux-club',
    type: 'tracking_number' | 'service_request'
  ) {
    return type === 'tracking_number' ? this.tracking : this.requests;
  }
  async getServiceJob(_: AllocationTransaction, id: string) {
    return this.jobs.get(id) ?? null;
  }
  async serviceJobExists(_: AllocationTransaction, id: string) {
    return this.jobs.has(id);
  }
  async commitServiceJobCreation(
    _: AllocationTransaction,
    input: {
      key: string;
      job: ServiceJob;
      trackingSequence: number;
      serviceRequestSequence: number;
      newCustomer: NewCustomerAllocation | null;
    }
  ) {
    this.commitAttempts += 1;
    if (this.conflicts-- > 0) throw new TransactionConflictError();
    if (this.jobs.has(input.job.id) || this.keys.has(input.key))
      throw new TransactionConflictError();
    // Models the real atomic :commit: every write below lands together, or
    // (via the throws above) none of them do — there is no code path here
    // that writes the Service Job without also writing newCustomer, or
    // vice versa, matching firestoreClient.ts's single-request commit.
    this.jobs.set(input.job.id, input.job);
    this.keys.set(input.key, input.job.id);
    this.tracking = input.trackingSequence;
    this.requests = input.serviceRequestSequence;
    if (input.newCustomer) this.customers.set(input.newCustomer.id, input.newCustomer);
    this.successfulCommits += 1;
  }
}

{
  const store = new FakeStore();
  const first = await allocateServiceJob({
    brandId: 'bruno-thailand',
    key: '11111111-1111-4111-8111-111111111111',
    intake: rawIntake,
    customer: { kind: 'new' },
    dataAccess: store,
    now: () => new Date('2026-08-16T04:00:00.000Z'),
  });
  check(
    'a new-customer allocation writes exactly one customer alongside the Service Job',
    store.customers.size === 1 && store.jobs.has(first.id)
  );
  const [createdCustomer] = [...store.customers.values()];
  check(
    'the created customer id is an opaque UUID, never the phone number',
    createdCustomer !== undefined &&
      createdCustomer.id !== rawIntake.customerPhone &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        createdCustomer.id
      )
  );
  check(
    'the created customer carries the authenticated staff brand, matching the request brandId',
    createdCustomer?.brandId === 'bruno-thailand'
  );
  check(
    'the created customer name/phone/email mirror the intake payload exactly',
    createdCustomer?.name === rawIntake.customerName &&
      createdCustomer?.phone === rawIntake.customerPhone &&
      createdCustomer?.email === rawIntake.customerEmail
  );

  // F: idempotent retry of the exact same attempt must not allocate a
  // second customer — the intake-key check short-circuits before any new
  // customer id is ever generated.
  const replay = await allocateServiceJob({
    brandId: 'bruno-thailand',
    key: '11111111-1111-4111-8111-111111111111',
    intake: rawIntake,
    customer: { kind: 'new' },
    dataAccess: store,
  });
  check(
    'idempotent replay of a new-customer attempt returns the same job and creates no second customer',
    replay.id === first.id && store.customers.size === 1 && store.successfulCommits === 1
  );
}

{
  // D: two distinct new-customer attempts sharing the exact same phone
  // number (BUSINESS_RULES.md — "a shared household phone is plausible")
  // must never be structurally forced onto the same customer document.
  const store = new FakeStore();
  const sharedPhoneIntake = { ...rawIntake, customerPhone: '0800000000' };
  const first = await allocateServiceJob({
    brandId: 'bruno-thailand',
    key: '22222222-2222-4222-8222-222222222222',
    intake: sharedPhoneIntake,
    customer: { kind: 'new' },
    dataAccess: store,
  });
  const second = await allocateServiceJob({
    brandId: 'bruno-thailand',
    key: '33333333-3333-4333-8333-333333333333',
    intake: sharedPhoneIntake,
    customer: { kind: 'new' },
    dataAccess: store,
  });
  check(
    'two customers sharing a phone number get two distinct opaque ids, not one shared document',
    first.id !== second.id && store.customers.size === 2
  );
}

{
  // B (regression): the existing-customer path is completely unchanged —
  // omitting `customer` entirely (every pre-F5d-65 caller) still writes no
  // customer document at all.
  const store = new FakeStore();
  await allocateServiceJob({
    brandId: 'bruno-thailand',
    key: '44444444-4444-4444-8444-444444444444',
    intake: rawIntake,
    dataAccess: store,
  });
  check(
    'omitting customer (pre-existing callers) writes no customer document',
    store.customers.size === 0
  );

  const storeExplicit = new FakeStore();
  await allocateServiceJob({
    brandId: 'bruno-thailand',
    key: '55555555-5555-4555-8555-555555555555',
    intake: rawIntake,
    customer: { kind: 'existing', customerId: 'cust-1' },
    dataAccess: storeExplicit,
  });
  check(
    'an explicit existing-customer selector writes no customer document',
    storeExplicit.customers.size === 0
  );
}

{
  // F: a transaction conflict retries the whole atomic write-set — a
  // partially-committed customer is structurally impossible (the fake
  // store's commit either records both job+customer or neither).
  const store = new FakeStore();
  store.conflicts = 1;
  const job = await allocateServiceJob({
    brandId: 'bruno-thailand',
    key: '66666666-6666-4666-8666-666666666666',
    intake: rawIntake,
    customer: { kind: 'new' },
    dataAccess: store,
  });
  check(
    'a retried new-customer attempt still lands exactly one customer, never a partial one',
    store.customers.size === 1 && store.jobs.has(job.id) && store.commitAttempts === 2
  );
}

if (failures) process.exitCode = 1;
