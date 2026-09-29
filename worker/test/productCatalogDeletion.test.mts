import {
  deleteProductSafely,
  ProductDeleteInUseError,
  ProductDeleteNotLegacyError,
  ProductDeleteReferenceUnknownError,
  type ProductCatalogDeletionDataAccess,
  type ProductDeleteRecord,
} from '../src/productCatalogDeletion.ts';
import {
  TransactionConflictError,
  type AllocationTransaction,
} from '../src/serviceJobCreation.ts';

let failures = 0;
function check(label: string, condition: boolean): void {
  if (condition) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.error(`  FAIL  ${label}`);
  }
}

class FakeStore implements ProductCatalogDeletionDataAccess {
  product: ProductDeleteRecord | null = {
    status: 'Legacy',
    referenceTrackingVersion: 1,
  };
  referenced = false;
  revision = 7;
  conflicts = 0;
  commits = 0;
  reads = 0;

  async beginServiceJobTransaction(): Promise<AllocationTransaction> {
    return { id: crypto.randomUUID() };
  }
  async getProductForDeletion() {
    this.reads += 1;
    return this.product;
  }
  async hasServiceJobProductReference() {
    return this.referenced;
  }
  async getProductCatalogState() {
    return { revision: this.revision };
  }
  async commitProductDeletion() {
    if (this.conflicts-- > 0) throw new TransactionConflictError();
    this.commits += 1;
  }
}

console.log('Running Product Catalog safe-delete domain tests');

{
  const store = new FakeStore();
  store.product = { status: 'Active', referenceTrackingVersion: 1 };
  await deleteProductSafely({ productId: 'p1', dataAccess: store })
    .then(() => check('Active product is never deleted', false))
    .catch((error) => check('Active product is rejected as not Legacy', error instanceof ProductDeleteNotLegacyError));
  check('Active rejection performs no delete commit', store.commits === 0);
}

{
  const store = new FakeStore();
  store.product = { status: 'Legacy', referenceTrackingVersion: null };
  await deleteProductSafely({ productId: 'p1', dataAccess: store })
    .then(() => check('pre-cutover product is never deleted', false))
    .catch((error) => check('pre-cutover product fails closed', error instanceof ProductDeleteReferenceUnknownError));
  check('pre-cutover rejection performs no delete commit', store.commits === 0);
}

{
  const store = new FakeStore();
  store.referenced = true;
  await deleteProductSafely({ productId: 'p1', dataAccess: store })
    .then(() => check('referenced product is never deleted', false))
    .catch((error) => check('referenced product is rejected', error instanceof ProductDeleteInUseError));
  check('referenced rejection performs no delete commit', store.commits === 0);
}

{
  const store = new FakeStore();
  await deleteProductSafely({ productId: 'p1', dataAccess: store });
  check('safe Legacy product deletes exactly once', store.commits === 1);
}

{
  const store = new FakeStore();
  store.conflicts = 1;
  const originalCommit = store.commitProductDeletion.bind(store);
  store.commitProductDeletion = async (...args) => {
    try {
      await originalCommit(...args);
    } catch (error) {
      store.referenced = true;
      throw error;
    }
  };
  await deleteProductSafely({ productId: 'p1', dataAccess: store })
    .then(() => check('retry never ignores a newly-created reference', false))
    .catch((error) => check('retry re-checks references after conflict', error instanceof ProductDeleteInUseError));
  check('conflicted delete did not commit', store.commits === 0);
  check('product was re-read on retry', store.reads === 2);
}

if (failures > 0) {
  console.error(`Product Catalog safe-delete domain tests failed: ${failures}`);
  process.exitCode = 1;
} else {
  console.log('Product Catalog safe-delete domain tests passed');
}
