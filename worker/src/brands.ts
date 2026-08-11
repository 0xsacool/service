export const CANONICAL_BRAND_IDS = ['bruno-thailand', 'join-lux-club'] as const;

export type BrandId = (typeof CANONICAL_BRAND_IDS)[number];

export function isCanonicalBrandId(value: unknown): value is BrandId {
  return typeof value === 'string' && (CANONICAL_BRAND_IDS as readonly string[]).includes(value);
}
