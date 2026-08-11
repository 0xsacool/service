import { corsHeaders, handleOptions, withCors } from '../src/cors.ts';
import type { Env } from '../src/env.ts';

// F5d-33/F5d-34 B-3 regression: authenticated browser calls (every /files/*
// route, and the new POST /service-jobs) send Authorization; POST
// /service-jobs also sends Idempotency-Key. Neither is CORS-safelisted, so
// a browser preflight (OPTIONS) that doesn't echo them back in
// Access-Control-Allow-Headers makes the browser block the real request
// before it's ever sent — the Worker never even sees it. No existing test
// exercised a preflight at all.

const env: Env = {
  ATTACHMENTS_BUCKET: {} as R2Bucket,
  ALLOWED_ORIGINS: 'http://localhost:5173,https://app.example.test',
  FIRESTORE_PROJECT_ID: 'test-project',
};

let failures = 0;
function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}`);
  }
}

function preflightRequest(origin: string | null): Request {
  const headers = new Headers();
  if (origin) headers.set('Origin', origin);
  return new Request('http://worker.test/service-jobs', { method: 'OPTIONS', headers });
}

console.log('Running Worker CORS preflight regression test');

{
  const response = handleOptions(preflightRequest('http://localhost:5173'), env);
  const allowHeaders = response.headers.get('Access-Control-Allow-Headers') ?? '';
  check('preflight succeeds with 204 for an allowed origin', response.status === 204);
  check('preflight allows Authorization', /(^|,\s*)Authorization(\s*,|$)/i.test(allowHeaders));
  check(
    'preflight allows Idempotency-Key',
    /(^|,\s*)Idempotency-Key(\s*,|$)/i.test(allowHeaders)
  );
  check('preflight still allows Content-Type', /Content-Type/i.test(allowHeaders));
  check('preflight still allows X-File-Name', /X-File-Name/i.test(allowHeaders));
  check(
    'preflight echoes the exact requesting allowed origin',
    response.headers.get('Access-Control-Allow-Origin') === 'http://localhost:5173'
  );
  check(
    'preflight allows the methods this Worker actually serves',
    (response.headers.get('Access-Control-Allow-Methods') ?? '').includes('POST')
  );
}

{
  const response = handleOptions(preflightRequest('https://not-allowed.test'), env);
  check(
    'preflight from a disallowed origin gets no CORS headers, never wildcard',
    response.headers.get('Access-Control-Allow-Origin') === null
  );
  check(
    'a disallowed origin never receives the allowed-headers list either',
    response.headers.get('Access-Control-Allow-Headers') === null
  );
}

{
  const headers = corsHeaders(preflightRequest(null), env);
  check(
    'a request with no Origin header gets no Access-Control-Allow-Origin',
    !('Access-Control-Allow-Origin' in headers)
  );
}

{
  const response = withCors(
    new Response('ok', { status: 200 }),
    preflightRequest('https://app.example.test'),
    env
  );
  check(
    'withCors preserves the wrapped response status/body while adding headers',
    response.status === 200 &&
      response.headers.get('Access-Control-Allow-Origin') === 'https://app.example.test'
  );
}

if (failures) process.exitCode = 1;
