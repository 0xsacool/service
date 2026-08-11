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
import { productMasterEntries } from '../mockData/productMaster.mock';
import {
  PRODUCTS_COLLECTION,
  toFirestoreFields,
} from '../firestore/productMasterMapping';

export interface SeedResult {
  seeded: boolean;
  count: number;
}

// Seed-once guard: only writes when the 'products' collection is genuinely
// empty (checked with a limit(1) query, not a full read), so calling this
// on every app start while backendKind is 'firestore' never duplicates data
// — Sprint F2's explicit "seed only once, never duplicate" requirement.
// Not a separate CLI script deliberately: running it as a side effect of
// the Firestore repository's own instantiation means no new UI trigger or
// component is needed to invoke it.
export async function seedProductMasterIfEmpty(): Promise<SeedResult> {
  const firestore = getFirestoreDb();
  const existing = await getDocs(
    query(collection(firestore, PRODUCTS_COLLECTION), limit(1))
  );
  if (!existing.empty) {
    return { seeded: false, count: 0 };
  }

  const batch = writeBatch(firestore);
  for (const entry of productMasterEntries) {
    const ref = doc(firestore, PRODUCTS_COLLECTION, entry.id);
    batch.set(ref, {
      ...toFirestoreFields(entry),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
  await batch.commit();

  return { seeded: true, count: productMasterEntries.length };
}
