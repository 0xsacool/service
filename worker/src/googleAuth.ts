import type { Env } from './env.ts';

// F5d-5 — Workers-native Google service-account authentication. Built on
// only what the Workers runtime natively provides (fetch, crypto.subtle) —
// no firebase-admin, no @google-cloud/firestore, no Node-only auth library.
// This is the "Option 3" architecture from the F5d review: a JWT-bearer
// assertion (RFC 7523) signed with the service account's private key,
// exchanged for a short-lived OAuth2 access token, used as a Bearer token
// on Firestore REST calls. No credential of any kind is created or used
// here in F5d-5 — see getAccessToken()'s emulator short-circuit below, and
// worker/README.md for exactly what becomes a real Cloudflare secret later.

const DEFAULT_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const FIRESTORE_SCOPE = 'https://www.googleapis.com/auth/datastore';
// Refresh this many seconds before the token's real expiry, so a request
// that starts just before expiry doesn't get a token that dies mid-flight.
const EXPIRY_SAFETY_MARGIN_SECONDS = 60;

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

// Module-scope, not per-request — Workers isolates commonly persist across
// multiple invocations, and caching a short-lived access token for its
// actual lifetime (instead of re-signing a JWT and re-exchanging it on
// every single call) is the standard, recommended pattern here. Worst case
// on a cold isolate: one extra token exchange. There is no correctness risk
// from reusing this across requests within the same isolate — the token
// itself is time-scoped, not user- or request-scoped.
let cachedToken: CachedToken | null = null;

// F5d-10.3 — a Cloudflare secret installed via a piped stdin transfer
// (F5d-9) was found to carry one leading whitespace character (confirmed
// read-only in F5d-10.2), making the JWT's `iss` claim byte-unequal to
// the real service account and causing Google's token endpoint to return
// `invalid_grant: "Invalid grant: account not found"`. Normalizing here,
// at the one point this value enters the JWT, protects against this
// whole class of secret-installation whitespace artifact — not just the
// specific incident already fixed by re-installing the secret cleanly.
export function normalizeServiceAccountEmail(email: string): string {
  return email.trim();
}

function base64UrlEncode(input: string | ArrayBuffer): string {
  const bytes =
    typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Google service-account keys are PKCS#8 PEM. crypto.subtle.importKey needs
// the raw DER bytes, not the PEM text — strip the header/footer/whitespace
// and base64-decode what's left.
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pemBody = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(pemBody);
  const der = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    der[i] = binary.charCodeAt(i);
  }
  return crypto.subtle.importKey(
    'pkcs8',
    der.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

// RFC 7523 JWT-bearer assertion: header.claims signed with the service
// account's private key, RS256. This is what gets exchanged for an access
// token below — it is never itself sent to Firestore.
async function signServiceAccountAssertion(
  email: string,
  privateKeyPem: string,
  tokenEndpoint: string,
  now: Date
): Promise<string> {
  const key = await importPrivateKey(privateKeyPem);
  const issuedAtSeconds = Math.floor(now.getTime() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: email,
    scope: FIRESTORE_SCOPE,
    aud: tokenEndpoint,
    iat: issuedAtSeconds,
    exp: issuedAtSeconds + 3600,
  };
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claims))}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

interface TokenEndpointResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

async function exchangeAssertionForToken(
  assertion: string,
  tokenEndpoint: string
): Promise<TokenEndpointResponse> {
  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google token endpoint returned ${response.status}: ${body}`);
  }
  return (await response.json()) as TokenEndpointResponse;
}

// Returns null when talking to the Firestore Emulator — the emulator never
// validates bearer tokens and (per this project's existing firestore.rules,
// reused unmodified for local emulator config, see firebase.json) evaluates
// `allow read, write: if true` for serviceJobAttachments regardless of
// request.auth. No real Google token exchange ever happens in that path,
// by design — this sprint creates no real credential of any kind. See
// firestoreClient.ts for how a null token translates to "send no
// Authorization header."
//
// Throws if GOOGLE_SERVICE_ACCOUNT_EMAIL/PRIVATE_KEY are missing and this
// isn't the emulator path — i.e. calling this against real Firestore
// without a real configured credential fails loudly rather than silently
// sending an unauthenticated request.
export async function getAccessToken(
  env: Env,
  now: Date = new Date()
): Promise<string | null> {
  if (env.FIRESTORE_EMULATOR_HOST) {
    return null;
  }

  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    throw new Error(
      'Missing GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY and ' +
        'FIRESTORE_EMULATOR_HOST is not set — this Worker has no way to authenticate ' +
        'to Firestore. See worker/README.md.'
    );
  }

  if (
    cachedToken &&
    cachedToken.expiresAtMs > now.getTime() + EXPIRY_SAFETY_MARGIN_SECONDS * 1000
  ) {
    return cachedToken.accessToken;
  }

  const tokenEndpoint = env.GOOGLE_TOKEN_ENDPOINT ?? DEFAULT_TOKEN_ENDPOINT;
  const assertion = await signServiceAccountAssertion(
    normalizeServiceAccountEmail(env.GOOGLE_SERVICE_ACCOUNT_EMAIL),
    env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    tokenEndpoint,
    now
  );
  const tokenResponse = await exchangeAssertionForToken(assertion, tokenEndpoint);

  cachedToken = {
    accessToken: tokenResponse.access_token,
    expiresAtMs: now.getTime() + tokenResponse.expires_in * 1000,
  };
  return cachedToken.accessToken;
}

// Test-only escape hatch — clears the module-scope cache so a test run
// doesn't observe a token cached by a previous, differently-configured run
// within the same process. Not used by any production code path.
export function __resetAccessTokenCacheForTests(): void {
  cachedToken = null;
}
