import { useSyncExternalStore } from 'react';
import type { ServiceJob } from '../types';
import { repositories } from '../repositories/repositoryProvider';
import { getDataVersion, subscribeToDataVersion } from '../repositories/dataVersion';

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
//
// F5d-70 Phase 2A — subscribes to the same shared dataVersion external store
// useUniversalSearch already uses (dataVersion.ts), so this hook re-renders
// whenever a Firestore repository's live cache changes (onSnapshot bump, or
// a direct authoritative cache write after create/update/issuance). The
// numeric version is used purely as an invalidation token — getAll()'s
// array is never passed to useSyncExternalStore as the snapshot itself,
// since a fresh array on every call would never satisfy Object.is and would
// defeat the point of the external store. serviceJobs below is a plain read
// taken during render, after React has observed the version change.
export function useServiceJobs(): UseServiceJobsResult {
  useSyncExternalStore(subscribeToDataVersion, getDataVersion, getDataVersion);
  return {
    serviceJobs: repositories.serviceJobs.getAll(),
    isLoading: false,
    error: null,
  };
}
