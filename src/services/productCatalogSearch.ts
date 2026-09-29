import type { ProductMasterEntry } from '../types/productMaster.ts';

export const PRODUCT_CATALOG_SEARCH_LIMIT = 20;

function searchText(value: string | undefined): string {
  return (value ?? '').normalize('NFKC').trim().toLocaleLowerCase();
}

function matchRank(product: ProductMasterEntry, query: string): number {
  const model = searchText(product.model);
  const sku = searchText(product.sku);
  const name = searchText(product.name);
  const brand = searchText(product.brand);

  if (model.startsWith(query) || sku.startsWith(query)) return 0;
  if (model.includes(query) || sku.includes(query)) return 1;
  if (name.startsWith(query) || brand.startsWith(query)) return 2;
  return 3;
}

export function searchActiveProductCatalog(
  products: readonly ProductMasterEntry[],
  rawQuery: string,
  limit = PRODUCT_CATALOG_SEARCH_LIMIT
): ProductMasterEntry[] {
  const query = searchText(rawQuery);
  return products
    .filter((product) => product.status === 'Active')
    .filter((product) => {
      if (!query) return true;
      return [product.brand, product.model, product.sku, product.name]
        .map(searchText)
        .some((value) => value.includes(query));
    })
    .sort((a, b) => {
      if (query) {
        const rank = matchRank(a, query) - matchRank(b, query);
        if (rank !== 0) return rank;
      }
      return (
        a.brand.localeCompare(b.brand) ||
        a.model.localeCompare(b.model) ||
        (a.sku ?? '').localeCompare(b.sku ?? '') ||
        a.name.localeCompare(b.name)
      );
    })
    .slice(0, Math.max(1, limit));
}

export function productCatalogOptionLabel(product: ProductMasterEntry): string {
  return [
    product.model,
    product.sku ? `SKU ${product.sku}` : null,
    product.name,
    product.brand,
  ]
    .filter(Boolean)
    .join(' · ');
}
