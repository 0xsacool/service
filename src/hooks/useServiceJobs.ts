import type { ServiceJob } from '../types';
import { repositories } from '../repositories/repositoryProvider';

export interface UseServiceJobsResult {
  serviceJobs: ServiceJob[];
  isLoading: false;
  error: null;
}

// Reads through the Repository Provider, currently resolving to the Mock
// Repository set (see repositoryProvider.ts). The return shape
// ({ data, isLoading, error }) is deliberately async-ready — a future
// Firestore-backed provider swaps in real queries without changing how any
// component consumes this hook.
export function useServiceJobs(): UseServiceJobsResult {
  return {
    serviceJobs: repositories.serviceJobs.getAll(),
    isLoading: false,
    error: null,
  };
}
