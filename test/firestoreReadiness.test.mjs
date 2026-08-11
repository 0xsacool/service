import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const readSource = async (path) =>
  await readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Firestore Service Job listener is scoped to the validated brand', async () => {
  const source = await readSource('src/repositories/firestoreServiceJobRepository.ts');
  assert.match(source, /where\('brandId', '==', brandId\)/);
  assert.doesNotMatch(
    source,
    /onSnapshot\(\s*collection\(firestore, SERVICE_JOBS_COLLECTION\)/
  );
});

test('Firestore attachment reads are job-scoped and retain deleted filtering', async () => {
  const source = await readSource('src/repositories/firestoreAttachmentsRepository.ts');
  assert.match(source, /where\('jobId', '==', jobId\)/);
  assert.match(source, /attachment\.deletedAt === null/);
  assert.match(source, /getForJobIncludingDeleted/);
});

test('Firestore repositories no longer import or invoke automatic seed writes', async () => {
  const paths = [
    'src/repositories/firestoreServiceJobRepository.ts',
    'src/repositories/firestoreCustomersRepository.ts',
    'src/repositories/firestoreProductMasterRepository.ts',
  ];
  for (const path of paths) {
    const source = await readSource(path);
    assert.doesNotMatch(source, /seed[A-Z][A-Za-z]*IfEmpty/);
  }
});

test('public tracking does not read Firestore or expose sensitive fields', async () => {
  const source = await readSource('src/features/tracking/publicTracking.ts');
  assert.doesNotMatch(
    source,
    /firestore|useServiceJobs|customerName|customerPhone|customerEmail|serialNumber|photos/
  );
  assert.match(source, /trackingReference/);
  assert.match(source, /status/);
  assert.match(source, /publicTimeline/);
});
