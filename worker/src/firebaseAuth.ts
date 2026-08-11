const FIREBASE_SIGNING_KEYS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

export interface VerifiedFirebaseToken {
  uid: string;
}

export interface FirebaseTokenVerifier {
  verify(token: string, projectId: string): Promise<VerifiedFirebaseToken>;
}

export interface FirebaseSigningKeyResponse {
  keys: ReadonlyMap<string, JsonWebKey>;
  maxAgeSeconds: number;
}

export interface FirebaseSigningKeyFetcher {
  fetch(): Promise<FirebaseSigningKeyResponse>;
}

export class FirebaseTokenVerificationError extends Error {
  constructor() {
    super('Firebase ID token verification failed');
    this.name = 'FirebaseTokenVerificationError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new FirebaseTokenVerificationError();
  }
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const decoded = atob(value.replace(/-/g, '+').replace(/_/g, '/') + padding);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function decodeJson(value: string): Record<string, unknown> {
  try {
    const decoded = new TextDecoder().decode(decodeBase64Url(value));
    const parsed: unknown = JSON.parse(decoded);
    if (!isRecord(parsed)) {
      throw new FirebaseTokenVerificationError();
    }
    return parsed;
  } catch (error) {
    if (error instanceof FirebaseTokenVerificationError) {
      throw error;
    }
    throw new FirebaseTokenVerificationError();
  }
}

function readCacheMaxAge(cacheControl: string | null): number {
  const match = /(?:^|,)\s*max-age=(\d+)/i.exec(cacheControl ?? '');
  return match ? Number.parseInt(match[1] ?? '0', 10) : 0;
}

export function createGoogleSigningKeyFetcher(
  fetchImpl: typeof fetch = fetch
): FirebaseSigningKeyFetcher {
  return {
    async fetch() {
      const response = await fetchImpl(FIREBASE_SIGNING_KEYS_URL);
      if (!response.ok) {
        throw new FirebaseTokenVerificationError();
      }
      const body: unknown = await response.json();
      if (!isRecord(body) || !Array.isArray(body.keys)) {
        throw new FirebaseTokenVerificationError();
      }

      const keys = new Map<string, JsonWebKey>();
      for (const value of body.keys) {
        if (
          isRecord(value) &&
          typeof value.kid === 'string' &&
          typeof value.kty === 'string' &&
          typeof value.n === 'string' &&
          typeof value.e === 'string'
        ) {
          keys.set(value.kid, {
            kty: value.kty,
            n: value.n,
            e: value.e,
            alg: typeof value.alg === 'string' ? value.alg : undefined,
            use: typeof value.use === 'string' ? value.use : undefined,
          });
        }
      }
      if (keys.size === 0) {
        throw new FirebaseTokenVerificationError();
      }
      return { keys, maxAgeSeconds: readCacheMaxAge(response.headers.get('Cache-Control')) };
    },
  };
}

interface CachedSigningKeys {
  keys: ReadonlyMap<string, JsonWebKey>;
  expiresAt: number;
}

export class FirebaseSigningKeyCache {
  private cached: CachedSigningKeys | null = null;
  private readonly keyFetcher: FirebaseSigningKeyFetcher;
  private readonly now: () => number;

  constructor(keyFetcher: FirebaseSigningKeyFetcher, now: () => number = () => Date.now()) {
    this.keyFetcher = keyFetcher;
    this.now = now;
  }

  async get(kid: string): Promise<JsonWebKey> {
    if (!this.cached || this.cached.expiresAt <= this.now()) {
      await this.refresh();
    }

    let key = this.cached?.keys.get(kid);
    if (!key) {
      await this.refresh();
      key = this.cached?.keys.get(kid);
    }
    if (!key) {
      throw new FirebaseTokenVerificationError();
    }
    return key;
  }

  private async refresh(): Promise<void> {
    try {
      const response = await this.keyFetcher.fetch();
      this.cached = {
        keys: response.keys,
        expiresAt: this.now() + response.maxAgeSeconds * 1000,
      };
    } catch {
      throw new FirebaseTokenVerificationError();
    }
  }
}

function isUnixTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function validateClaims(claims: Record<string, unknown>, projectId: string, now: number): string {
  const expectedIssuer = `https://securetoken.google.com/${projectId}`;
  if (
    claims.aud !== projectId ||
    claims.iss !== expectedIssuer ||
    typeof claims.sub !== 'string' ||
    claims.sub.length === 0 ||
    claims.sub.length > 128 ||
    !isUnixTimestamp(claims.exp) ||
    !isUnixTimestamp(claims.iat) ||
    !isUnixTimestamp(claims.auth_time) ||
    claims.exp <= now ||
    claims.iat > now ||
    claims.auth_time > now ||
    claims.iat > claims.exp ||
    claims.auth_time > claims.exp
  ) {
    throw new FirebaseTokenVerificationError();
  }
  return claims.sub;
}

export function readBearerToken(authorization: string | null): string | null {
  const match = /^Bearer ([^\s]+)$/.exec(authorization ?? '');
  return match?.[1] ?? null;
}

export function createFirebaseTokenVerifier(options: {
  keyCache?: FirebaseSigningKeyCache;
  now?: () => number;
} = {}): FirebaseTokenVerifier {
  const now = options.now ?? (() => Date.now());
  const keyCache =
    options.keyCache ?? new FirebaseSigningKeyCache(createGoogleSigningKeyFetcher(), now);

  return {
    async verify(token, projectId) {
      const parts = token.split('.');
      const [encodedHeader, encodedPayload, encodedSignature] = parts;
      if (
        parts.length !== 3 ||
        !encodedHeader ||
        !encodedPayload ||
        !encodedSignature
      ) {
        throw new FirebaseTokenVerificationError();
      }

      const header = decodeJson(encodedHeader);
      if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid.length === 0) {
        throw new FirebaseTokenVerificationError();
      }

      const key = await keyCache.get(header.kid);
      let verified = false;
      try {
        const cryptoKey = await crypto.subtle.importKey(
          'jwk',
          key,
          { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
          false,
          ['verify']
        );
        verified = await crypto.subtle.verify(
          { name: 'RSASSA-PKCS1-v1_5' },
          cryptoKey,
          decodeBase64Url(encodedSignature),
          new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
        );
      } catch {
        throw new FirebaseTokenVerificationError();
      }
      if (!verified) {
        throw new FirebaseTokenVerificationError();
      }

      const uid = validateClaims(
        decodeJson(encodedPayload),
        projectId,
        Math.floor(now() / 1000)
      );
      return { uid };
    },
  };
}

export const firebaseTokenVerifier = createFirebaseTokenVerifier();
