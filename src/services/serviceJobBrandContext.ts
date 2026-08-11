import { backendKind } from '../config/backend';
import type { BrandId } from '../types';

export function resolveNewServiceJobBrandId(): BrandId | null {
  return backendKind === 'mock' ? 'bruno-thailand' : null;
}
