import type { Env } from './env.ts';

function parseAllowedOrigins(env: Env): string[] {
  return env.ALLOWED_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function resolveCorsOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  return parseAllowedOrigins(env).includes(origin) ? origin : null;
}

// Only ever grants the exact requesting Origin back when it's on the
// allowlist — never '*' — since a future phase may need cookies/credentials
// here, and '*' is incompatible with that. No origin match just means no
// CORS headers, which the browser itself then blocks reading; the Worker
// still processes the request either way (this is a browser-side read
// restriction, not a server-side authorization check — see README's
// pre-auth note).
export function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = resolveCorsOrigin(request, env);
  const headers: Record<string, string> = { Vary: 'Origin' };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, DELETE, OPTIONS';
    // Authorization carries the Firebase ID token on every authenticated
    // route (files, and now POST /service-jobs); Idempotency-Key is
    // required on POST /service-jobs. Both are non-CORS-safelisted request
    // headers, so a browser preflight denies the actual request unless the
    // Worker explicitly allows them here (F5d-33/F5d-34 B-3).
    headers['Access-Control-Allow-Headers'] =
      'Content-Type, X-File-Name, Authorization, Idempotency-Key';
  }
  return headers;
}

export function handleOptions(request: Request, env: Env): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export function withCors(response: Response, request: Request, env: Env): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(request, env))) {
    headers.set(key, value);
  }
  return new Response(response.body, { status: response.status, headers });
}
