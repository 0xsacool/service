import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { getFirestoreDb } from '../../lib/firebase/firebase';
import { customerEntries } from '../mockData/customers.mock';
import { CUSTOMERS_COLLECTION, toFirestoreFields } from '../firestore/customerMapping';

export interface SeedResult {
  seeded: boolean;
  count: number;
}

// Seed-once guard, same pattern as seedProductMasterFromMock.ts (Sprint F2):
// only writes when the 'customers' collection is genuinely empty (checked
// with a limit(1) query, not a full read), so calling this on every app
// start while backendKind is 'firestore' never duplicates data. Kept as an
// independent function (not a shared helper with the Product Master seed)
// so this sprint doesn't touch F2's already-validated migration code.
export async function seedCustomersIfEmpty(): Promise<SeedResult> {
  const firestore = getFirestoreDb();
  const existing = await getDocs(
    query(collection(firestore, CUSTOMERS_COLLECTION), limit(1))
  );
  if (!existing.empty) {
    return { seeded: false, count: 0 };
  }

  const batch = writeBatch(firestore);
  for (const entry of customerEntries) {
    const ref = doc(firestore, CUSTOMERS_COLLECTION, entry.id);
    batch.set(ref, {
      ...toFirestoreFields(entry),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
  await batch.commit();

  return { seeded: true, count: customerEntries.length };
}
