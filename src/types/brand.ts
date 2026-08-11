export const CANONICAL_BRAND_IDS = ['bruno-thailand', 'join-lux-club'] as const;

export type BrandId = (typeof CANONICAL_BRAND_IDS)[number];

const brandCodes: Readonly<Record<BrandId, string>> = {
  'bruno-thailand': 'BRN',
  'join-lux-club': 'JLC',
};

export function isCanonicalBrandId(value: unknown): value is BrandId {
  return (
    typeof value === 'string' &&
    (CANONICAL_BRAND_IDS as readonly string[]).includes(value)
  );
}

export function getBrandCode(brandId: BrandId): string {
  return brandCodes[brandId];
}
