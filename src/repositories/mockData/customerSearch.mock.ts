// Illustrative marketplace/order enrichment, keyed by the same phone number
// used as the customer key in customersRepository.ts. Channel names match
// the `channel` values documented for `customer_channel_contacts` in
// DATABASE_SCHEMA.md (shopee/lazada/tiktok_shop/facebook/line/store/website).
// Not every customer has a marketplace identity on file — walk-in customers
// realistically don't — so this map only covers a subset of the 7 mock
// customers derived in serviceJobs.mock.ts.
export interface CustomerChannelMock {
  marketplace: string;
  username: string;
  orderNumber: string;
}

export const customerChannelMockByPhone: Record<string, CustomerChannelMock> = {
  '(415) 555-0182': {
    marketplace: 'Shopee',
    username: 'maggie.chen88',
    orderNumber: '250731SHP04821',
  },
  '(415) 555-0144': {
    marketplace: 'LINE',
    username: 'robhayes_sf',
    orderNumber: '250802LN00193',
  },
  '(415) 555-0166': {
    marketplace: 'Lazada',
    username: 'sofia.r',
    orderNumber: '250805LZD7710',
  },
  '(415) 555-0125': {
    marketplace: 'TikTok Shop',
    username: 'htanaka_official',
    orderNumber: '250801TT3355',
  },
};
