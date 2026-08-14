export const CANONICAL_BRAND_IDS = ['bruno-thailand', 'join-lux-club'] as const;

export type BrandId = (typeof CANONICAL_BRAND_IDS)[number];

const brandCodes: Readonly<Record<BrandId, string>> = {
  'bruno-thailand': 'BRN',
  'join-lux-club': 'JLC',
};

const brandNames: Readonly<Record<BrandId, string>> = {
  'bruno-thailand': 'BRUNO THAILAND',
  'join-lux-club': 'JOIN LUX CLUB',
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

export function getBrandName(brandId: BrandId): string {
  return brandNames[brandId];
}

export function getBrandDisplayLabel(brandId: BrandId): string {
  return `${getBrandName(brandId)} · ${getBrandCode(brandId)}`;
}
