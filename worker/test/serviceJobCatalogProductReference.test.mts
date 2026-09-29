import {
  allocateServiceJob,
  CatalogProductUnavailableError,
  parseServiceJobIntake,
  TransactionConflictError,
  type AllocationTransaction,
  type ServiceJobCreationDataAccess,
} from '../src/serviceJobCreation.ts';
import type { ServiceJob } from '../../src/types/serviceJob.ts';

let failures = 0;
function check(label: string, condition: boolean): void {
  if (condition) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.error(`  FAIL  ${label}`);
  }
}

const raw = {
  intake: {
    customerName: 'QA',
    customerPhone: '1',
    customerEmail: '',
    product: 'Mini Rice Cooker BOE127',
    productCategory: 'Kitchen',
    serialNumber: 'S',
    catalogProductId: 'product-1',
    problemDescription: '',
    problemChips: [],
    accessories: [],
    internalNotes: '',
    photos: [],
    warranty: false,
  },
};

const parsed = parseServiceJobIntake(raw);
check('catalogProductId is accepted as a bounded stable id', parsed?.catalogProductId === 'product-1');
check(
  'unsafe catalogProductId is rejected',
  parseServiceJobIntake({
    intake: { ...raw.intake, catalogProductId: 'products/product-1' },
  }) === null
);

class FakeStore implements ServiceJobCreationDataAccess {
  jobs = new Map<string, ServiceJob>();
  keys = new Map<string, string>();
  status: 'Active' | 'Legacy' | null = 'Active';
  tracking = 0;
  requests = 0;
  commits = 0;
  conflicts = 0;
  statusReads = 0;
  async beginServiceJobTransaction(): Promise<AllocationTransaction> {
    return { id: crypto.randomUUID() };
  }
  async getIntakeKey(_: AllocationTransaction, id: string) {
    return this.keys.get(id) ?? null;
  }
  async getSequence(_: AllocationTransaction, __: any, type: 'tracking_number' | 'service_request') {
    return type === 'tracking_number' ? this.tracking : this.requests;
  }
  async getServiceJob(_: AllocationTransaction, id: string) {
    return this.jobs.get(id) ?? null;
  }
  async serviceJobExists(_: AllocationTransaction, id: string) {
    return this.jobs.has(id);
  }
  async getCatalogProductStatus() {
    this.statusReads += 1;
    return this.status;
  }
  async commitServiceJobCreation(
    _: AllocationTransaction,
    input: {
      key: string;
      job: ServiceJob;
      trackingSequence: number;
      serviceRequestSequence: number;
    }
  ) {
    if (this.conflicts-- > 0) {
      this.status = 'Legacy';
      throw new TransactionConflictError();
    }
    this.jobs.set(input.job.id, input.job);
    this.keys.set(input.key, input.job.id);
    this.tracking = input.trackingSequence;
    this.requests = input.serviceRequestSequence;
    this.commits += 1;
  }
}

if (!parsed) throw new Error('catalog intake did not parse');

console.log('Running Service Job stable Product-reference tests');

{
  const store = new FakeStore();
  const job = await allocateServiceJob({
    brandId: 'bruno-thailand',
    key: '61111111-1111-4111-8111-111111111111',
    intake: parsed,
    dataAccess: store,
    now: () => new Date('2026-09-29T08:00:00Z'),
  });
  check('new Service Job persists the stable catalogProductId', job.catalogProductId === 'product-1');
  check('Active Product is checked before creation', store.statusReads === 1);
  check('valid Product selection commits exactly once', store.commits === 1);
}

{
  const store = new FakeStore();
  store.status = 'Legacy';
  await allocateServiceJob({
    brandId: 'bruno-thailand',
    key: '62222222-2222-4222-8222-222222222222',
    intake: parsed,
    dataAccess: store,
  })
    .then(() => check('Legacy Product never creates a new Service Job', false))
    .catch((error) =>
      check('Legacy Product fails with catalog unavailable', error instanceof CatalogProductUnavailableError)
    );
  check('Legacy Product rejection performs no Service Job commit', store.commits === 0);
}

{
  const store = new FakeStore();
  store.conflicts = 1;
  await allocateServiceJob({
    brandId: 'bruno-thailand',
    key: '63333333-3333-4333-8333-333333333333',
    intake: parsed,
    dataAccess: store,
  })
    .then(() => check('retry never creates a job after Product becomes Legacy', false))
    .catch((error) =>
      check('transaction retry re-checks current Product status', error instanceof CatalogProductUnavailableError)
    );
  check('conflict retry performed a second Product status read', store.statusReads === 2);
  check('conflict path left no Service Job commit', store.commits === 0);
}

if (failures > 0) {
  console.error(`Service Job stable Product-reference tests failed: ${failures}`);
  process.exitCode = 1;
} else {
  console.log('Service Job stable Product-reference tests passed');
}
