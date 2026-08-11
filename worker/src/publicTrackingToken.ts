export const PUBLIC_TRACKING_TOKEN_BYTES = 32;

const BASE64_URL_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!BASE64_URL_TOKEN_PATTERN.test(value)) return null;
  try {
    const padded = `${value.replace(/-/g, '+').replace(/_/g, '/')}=`;
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes.byteLength === PUBLIC_TRACKING_TOKEN_BYTES ? bytes : null;
  } catch {
    return null;
  }
}

export interface IssuedPublicTrackingToken {
  token: string;
  tokenHash: string;
}

export function isValidPublicTrackingToken(value: unknown): value is string {
  return typeof value === 'string' && fromBase64Url(value) !== null;
}

export function generatePublicTrackingToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(PUBLIC_TRACKING_TOKEN_BYTES)));
}

export async function hashPublicTrackingToken(token: string): Promise<string> {
  const tokenBytes = fromBase64Url(token);
  if (!tokenBytes) throw new Error('Invalid public tracking token');
  const digest = await crypto.subtle.digest('SHA-256', tokenBytes);
  return toBase64Url(new Uint8Array(digest));
}

export async function issuePublicTrackingToken(): Promise<IssuedPublicTrackingToken> {
  const token = generatePublicTrackingToken();
  return { token, tokenHash: await hashPublicTrackingToken(token) };
}

export async function rotatePublicTrackingToken(): Promise<IssuedPublicTrackingToken> {
  return await issuePublicTrackingToken();
}

export function revokePublicTrackingToken(): null {
  return null;
}

export function constantTimeEqualPublicTrackingHashes(
  expectedHash: string,
  actualHash: string
): boolean {
  const expected = fromBase64Url(expectedHash);
  const actual = fromBase64Url(actualHash);
  if (!expected || !actual) return false;

  let difference = 0;
  for (let index = 0; index < PUBLIC_TRACKING_TOKEN_BYTES; index += 1) {
    difference |= expected[index]! ^ actual[index]!;
  }
  return difference === 0;
}

export async function verifyPublicTrackingToken(
  token: string,
  storedHash: string | null
): Promise<boolean> {
  if (!storedHash || !isValidPublicTrackingToken(token)) return false;
  return constantTimeEqualPublicTrackingHashes(
    storedHash,
    await hashPublicTrackingToken(token)
  );
}
