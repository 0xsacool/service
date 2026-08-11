// Photos, videos, PDFs, and common office document types — the four
// business categories from the approved F5 proposal (requirement 1). Plain
// allowlist, not load-bearing architecture — adjust freely.
export const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

// Conservative default for a foundation sprint. Cloudflare Workers request
// bodies have their own platform-level ceiling regardless of this constant;
// this just fails fast with a clear, attributable reason instead of an
// opaque platform error. Revisit once real video file sizes are known (see
// Risks in the approved F5 proposal).
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

export function isAllowedContentType(contentType: string | null): contentType is string {
  if (contentType === null) return false;
  const type = contentType.split(';')[0]?.trim() ?? '';
  return ALLOWED_CONTENT_TYPES.has(type);
}

// Content-Length can be missing or spoofed, so this is only the fast-reject
// path — limitStream() below is the real enforcement, applied to the actual
// bytes as they're consumed.
export function exceedsDeclaredSize(contentLength: string | null): boolean {
  if (!contentLength) return false;
  const declared = Number(contentLength);
  return Number.isFinite(declared) && declared > MAX_FILE_SIZE_BYTES;
}

export class FileTooLargeError extends Error {
  constructor() {
    super('FILE_TOO_LARGE');
  }
}

// R2Bucket.put() requires a value with a known length — an arbitrary
// ReadableStream (even one piped through a TransformStream) doesn't carry
// one, and the Workers R2 binding rejects it outright ("Provided readable
// stream must have a known length"). So the real size guard has to read
// the body into memory up to maxBytes and hand put() a definite-length
// Uint8Array, rather than streaming through an unbounded pass-through.
// Enforced against actual bytes read, not the client-supplied
// Content-Length (see exceedsDeclaredSize's fast-path comment above) —
// this cancels the read and throws the moment the true byte count crosses
// the cap, so a dishonest or missing Content-Length can't bypass it.
export async function readBodyWithLimit(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new FileTooLargeError();
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}
