import type { BrandId } from './brand';

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  brandIds: BrandId[];
}
