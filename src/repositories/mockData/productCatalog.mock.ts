// Instance-level facts only — which serial number is which catalog product
// (a productMasterRepository id) and when it was purchased. Brand/name/
// model/category/warrantyMonths/status all now live on the Product Master
// entry itself (productMaster.mock.ts) rather than being duplicated here,
// per DECISIONS.md #012/#015's products vs. product_instances split. No
// service job carries a product's actual purchase date, so purchaseDate
// stays hand-authored, illustrative data here.
export interface ProductInstanceCatalogEntry {
  productId: string;
  purchaseDate: string; // ISO date
}

export const productInstanceCatalogBySerial: Record<string, ProductInstanceCatalogEntry> =
  {
    F2LX9PM3KQH7: { productId: 'apple-iphone-15-pro-max', purchaseDate: '2025-01-15' },
    C02XK1PQLVDQ: { productId: 'apple-macbook-air-m3-13', purchaseDate: '2026-03-01' },
    'AP2-7741-2930': { productId: 'apple-airpods-pro-2', purchaseDate: '2026-05-01' },
    'AW10-5519-8842': { productId: 'apple-watch-series-10', purchaseDate: '2024-06-01' },
    DMPXQ9L2NHYT: { productId: 'apple-ipad-air-11', purchaseDate: '2024-11-01' },
    F38QJ1MPLK2W: { productId: 'apple-iphone-14', purchaseDate: '2023-09-01' },
    C02ZK4NML9PQ: { productId: 'apple-macbook-pro-14-m4', purchaseDate: '2025-06-01' },
  };

// A customer can have a product registered (e.g. linked from a marketplace
// purchase) that has never actually been serviced — the "Others" ordering
// tier. There's no service job to derive this from, so it's a small
// satellite dataset keyed by the customer id (today the same value as their
// phone — see customerSearch.mock.ts), not derived from serviceJobs.mock.ts.
export interface UnservicedProductInstanceMock {
  serialNumber: string;
  productId: string;
  purchaseDate: string;
}

export const unservicedProductInstancesByCustomerId: Record<
  string,
  UnservicedProductInstanceMock[]
> = {
  '(415) 555-0182': [
    {
      serialNumber: 'IPD10-8801-2214',
      productId: 'apple-ipad-10th-gen',
      purchaseDate: '2026-02-01',
    },
  ],
};
