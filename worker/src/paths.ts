export const ATTACHMENT_CATEGORIES = ['before', 'after', 'documents', 'report'] as const;
export type AttachmentCategory = (typeof ATTACHMENT_CATEGORIES)[number];

export function isAttachmentCategory(value: string): value is AttachmentCategory {
  return (ATTACHMENT_CATEGORIES as readonly string[]).includes(value);
}

// Reused as-is from ServiceJob.id / the Firestore serviceJobs document id
// (see the approved F5 proposal) — permissive enough for tracking numbers
// like "BRN-2026-000123" while ruling out anything that isn't a plain path
// segment, since this becomes an R2 key component directly.
const SAFE_SEGMENT = /^[a-zA-Z0-9_-]+$/;

export function isSafeJobId(jobId: string): boolean {
  return SAFE_SEGMENT.test(jobId);
}

export function sanitizeFileName(fileName: string): string {
  const sanitized = fileName.trim().replace(/[^a-zA-Z0-9.\-_]+/g, '_');
  return sanitized || 'file';
}

// service-jobs/{jobId}/{category}/{uuid}-{sanitizedFileName} — the approved
// F5 path convention. The uuid prefix is always generated here, never
// accepted from the caller, so two uploads named "photo.jpg" never collide
// and a client can't influence the final key beyond its own job/category/
// filename choice.
export function generateAttachmentPath(
  jobId: string,
  category: AttachmentCategory,
  fileName: string
): string {
  const uniqueName = `${crypto.randomUUID()}-${sanitizeFileName(fileName)}`;
  return `service-jobs/${jobId}/${category}/${uniqueName}`;
}

// Applied to every GET/DELETE key, not just what this Worker itself
// generates on upload — keeps the whole Worker scope-locked to the F5a
// convention rather than trusting a caller-supplied key blindly. R2 keys
// are opaque strings in a flat namespace (no real directory traversal
// concept), but a strict allowlist pattern is still cheap, predictable
// defense in depth.
const ATTACHMENT_KEY_PATTERN = new RegExp(
  `^service-jobs/([a-zA-Z0-9_-]+)/(${ATTACHMENT_CATEGORIES.join('|')})/([a-zA-Z0-9._-]+)$`
);

export function isValidAttachmentKey(key: string): boolean {
  return ATTACHMENT_KEY_PATTERN.test(key);
}

export function getServiceJobIdFromAttachmentKey(key: string): string | null {
  const match = ATTACHMENT_KEY_PATTERN.exec(key);
  return match?.[1] ?? null;
}
