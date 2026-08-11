import { readFile } from 'node:fs/promises';
import { createWorkerHandler, type WorkerDependencies } from '../src/index.ts';
import type { Env } from '../src/env.ts';
import type { FirestoreClient } from '../src/firestoreClient.ts';

let failures = 0;

function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}`);
  }
}

const env: Env = {
  ATTACHMENTS_BUCKET: {} as R2Bucket,
  ALLOWED_ORIGINS: 'http://localhost:5173',
  FIRESTORE_PROJECT_ID: 'luxace-service',
};

let scheduledCalls = 0;
const dependencies: WorkerDependencies = {
  tokenVerifier: { async verify() { throw new Error('not used'); } },
  createFirestoreClient: () => ({}) as FirestoreClient,
  async runRetentionSweep() {
    scheduledCalls += 1;
    return { attachmentsScanned: 0, attachmentsUpdated: 0, errors: 0, aborted: false };
  },
};

console.log('Running Cron deployment-safety regression test');
const handler = createWorkerHandler(dependencies);
const fetchResponse = await handler.fetch(
  new Request('https://worker.example/scheduled', { method: 'POST' }),
  env,
  {} as ExecutionContext
);
check('fetch cannot invoke scheduled retention work', fetchResponse.status === 404 && scheduledCalls === 0);
await handler.scheduled(
  { cron: '0 3 * * *', scheduledTime: 0, noRetry() {} } as ScheduledController,
  env,
  {} as ExecutionContext
);
check('scheduled handler remains callable only by its scheduler interface', scheduledCalls === 1);

const wranglerConfig = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
check('default Worker configuration contains no Cron trigger', !/^\s*\[triggers\]/m.test(wranglerConfig));

const indexSource = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
check('deletion executor remains unwired from the Worker entrypoint', !indexSource.includes('deletionExecutor'));

if (failures > 0) process.exitCode = 1;
