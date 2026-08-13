import {
  collection,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { getFirestoreDb } from '../lib/firebase/firebase';
import type { BrandId, Customer } from '../types';
import type { CustomersRepository } from './types';
import { fromFirestoreData, CUSTOMERS_COLLECTION } from './firestore/customerMapping';
import { bumpDataVersion } from './dataVersion';
import {
  describeFirestoreInitError,
  recordFirestoreInitFailure,
} from './firestoreInitDiagnostics';

// Same synchronous-facade-over-async-backend design as
// firestoreProductMasterRepository.ts (DECISIONS.md #018) — CustomersRepository's
// getAll() is synchronous, so this factory awaits the first server-confirmed
// Firestore snapshot before resolving, then every call reads a live local
// cache kept current by onSnapshot. Simpler than the Product Master version:
// CustomersRepository is read-only (no create/update), so there's no
// optimistic-write/background-failure concern to handle here.
export async function createFirestoreCustomersRepository(
  staffBrandId: BrandId
): Promise<CustomersRepository> {
  const firestore = getFirestoreDb();
  let customers: Customer[] = [];

  // Seed before listening, same ordering rationale as Product Master
  // (DECISIONS.md #018 / firestoreProductMasterRepository.ts): if the
  // listener attached first, its first server-confirmed snapshot could land
  // on a genuinely-empty collection moments before the seed's write commits.
  // Captured rather than discarded, from day one this time (Sprint F2.1
  // hardening had to retrofit this onto the Product Master repository —
  // applying that lesson directly here). No active teardown path exists yet;
  // see DECISIONS.md #018 for why that's fine for a session-scoped singleton.
  let unsubscribe: Unsubscribe | undefined;

  await new Promise<void>((resolveFirstSnapshot) => {
    let settled = false;
    unsubscribe = onSnapshot(
      query(
        collection(firestore, CUSTOMERS_COLLECTION),
        where('brandIds', 'array-contains', staffBrandId)
      ),
      (snapshot) => {
        customers = snapshot.docs.flatMap((docSnap) => {
          const customer = fromFirestoreData(docSnap.id, docSnap.data());
          return customer ? [customer] : [];
        });
        // F5d-49B: signals any external-store subscriber (Universal Search)
        // that fresh data has landed, independent of the first-snapshot
        // resolve below — this fires on every subsequent snapshot too.
        bumpDataVersion();
        // Only resolve on a server-confirmed snapshot, not Firestore's
        // possibly-stale first cached event — confirmed live for Product
        // Master (DECISIONS.md #018) that resolving early leaves getAll()
        // permanently wrong for the repository's lifetime.
        if (!settled && !snapshot.metadata.fromCache) {
          settled = true;
          resolveFirstSnapshot();
        }
      },
      (err) => {
        console.error('[firestoreCustomersRepository] snapshot listener failed:', err);
        recordFirestoreInitFailure(
          describeFirestoreInitError(
            err,
            'customers',
            settled ? 'listener' : 'initial-listener'
          )
        );
        if (!settled) {
          settled = true;
          resolveFirstSnapshot();
        }
      }
    );
  });
  void unsubscribe; // captured, not called — no teardown path exists yet

  return {
    getAll() {
      return customers;
    },
  };
}
