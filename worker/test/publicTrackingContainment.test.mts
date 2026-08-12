import { createWorkerHandler, type WorkerDependencies } from '../src/index.ts';
import { readFile } from 'node:fs/promises';
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

function createDisabledHandler(flag?: string): {
  handler: ReturnType<typeof createWorkerHandler>;
  env: Env;
  calls: { firestore: number; limiter: number };
} {
  const calls = { firestore: 0, limiter: 0 };
  const dependencies: WorkerDependencies = {
    tokenVerifier: { async verify() { throw new Error('not used'); } },
    createFirestoreClient: () => {
      calls.firestore += 1;
      throw new Error('Disabled Public Tracking must not construct a Firestore client');
    },
    publicTrackingRateLimiter: {
      async allow() {
        calls.limiter += 1;
        throw new Error('Disabled Public Tracking must not consult the limiter');
      },
    },
  };
  return {
    handler: createWorkerHandler(dependencies),
    env: {
      ATTACHMENTS_BUCKET: {} as R2Bucket,
      ALLOWED_ORIGINS: 'https://app.example.test',
      FIRESTORE_PROJECT_ID: 'test-project',
      ...(flag === undefined ? {} : { PUBLIC_TRACKING_ENABLED: flag }),
    },
    calls,
  };
}

async function expectDisabled(
  label: string,
  request: Request,
  flag?: string
): Promise<void> {
  const { handler, env, calls } = createDisabledHandler(flag);
  const response = await handler.fetch(request, env, {} as ExecutionContext);
  check(
    label,
    response.status === 404 &&
      (await response.text()) === JSON.stringify({ error: 'Not found' }) &&
      calls.firestore === 0 &&
      calls.limiter === 0
  );
}

console.log('Running Public Tracking deployment-containment regression test');

await expectDisabled(
  'legacy token route is disabled by default before parsing or lookup',
  new Request('https://worker.example/public/tracking/BRN-2026-000123', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'A'.repeat(43) }),
  })
);

await expectDisabled(
  'manual-code route is disabled by default before parsing or lookup',
  new Request('https://worker.example/public/tracking', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'SRV-2026-0810-K7M2QX' }),
  })
);

await expectDisabled(
  'only the exact explicit future opt-in value can enable Public Tracking',
  new Request('https://worker.example/public/tracking/BRN-2026-000123', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'A'.repeat(43) }),
  }),
  'TRUE'
);

const wranglerConfig = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
check(
  'the default deployment configuration contains no Public Tracking opt-in',
  !/^\s*PUBLIC_TRACKING_ENABLED\s*=\s*"true"\s*$/m.test(wranglerConfig)
);

if (failures > 0) {
  process.exitCode = 1;
  console.error(`Public Tracking containment regression test failed: ${failures} failure(s)`);
}
