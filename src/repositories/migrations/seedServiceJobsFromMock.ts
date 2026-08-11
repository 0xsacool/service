import { collection, doc, getDocs, limit, query, writeBatch } from 'firebase/firestore';
import { getFirestoreDb } from '../../lib/firebase/firebase';
import { mockServiceJobs } from '../mockData/serviceJobs.mock';
import {
  SERVICE_JOBS_COLLECTION,
  toFirestoreFields,
} from '../firestore/serviceJobMapping';

export interface SeedResult {
  seeded: boolean;
  count: number;
}

// Seed-once guard, same pattern as seedProductMasterFromMock.ts (Sprint F2)
// and seedCustomersFromMock.ts (Sprint F3): only writes when the
// 'serviceJobs' collection is genuinely empty (checked with a limit(1)
// query, not a full read), so calling this on every app start while
// backendKind is 'firestore' never duplicates data. Kept as an independent
// function (not a shared helper with the F2/F3 seeds) so this sprint
// doesn't touch their already-validated migration code. No serverTimestamp()
// here — createdAt/updatedAt are real ServiceJob fields already present on
// every mock record, not persistence metadata to generate.
export async function seedServiceJobsIfEmpty(): Promise<SeedResult> {
  const firestore = getFirestoreDb();
  const existing = await getDocs(
    query(collection(firestore, SERVICE_JOBS_COLLECTION), limit(1))
  );
  if (!existing.empty) {
    return { seeded: false, count: 0 };
  }

  const batch = writeBatch(firestore);
  for (const entry of mockServiceJobs) {
    const ref = doc(firestore, SERVICE_JOBS_COLLECTION, entry.id);
    batch.set(ref, toFirestoreFields(entry));
  }
  await batch.commit();

  return { seeded: true, count: mockServiceJobs.length };
}
