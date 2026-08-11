// Configuration abstraction — Sprint F0 introduced this as a hard-coded
// stub; Sprint F2 wires it to an env var now that there's a second backend
// (Firestore Product Master) worth switching to. Defaults to 'mock' when
// unset, so nothing about the app's default behavior changes for anyone who
// hasn't explicitly opted in — this is the single place repositoryProvider.ts
// reads the active backend from.
export type BackendKind = 'mock' | 'firestore';

export type BackendConfiguration =
  | { valid: true; kind: BackendKind; error: null }
  | { valid: false; kind: null; error: string };

export function resolveBackendConfiguration(
  raw: string | undefined,
  isProduction: boolean
): BackendConfiguration {
  if (raw === 'firestore') return { valid: true, kind: 'firestore', error: null };
  if (!isProduction && (raw === undefined || raw === '' || raw === 'mock')) {
    return { valid: true, kind: 'mock', error: null };
  }
  if (isProduction && raw === 'mock') {
    return {
      valid: false,
      kind: null,
      error: 'Production requires VITE_BACKEND_KIND=firestore.',
    };
  }
  return {
    valid: false,
    kind: null,
    error: 'Backend configuration is missing or invalid.',
  };
}

export const backendConfiguration = resolveBackendConfiguration(
  import.meta.env.VITE_BACKEND_KIND,
  import.meta.env.PROD
);

export const backendKind = backendConfiguration.kind;

// F5d-33/F5d-34 — config fail-closed hardening. This app has two
// independent backend axes (business data via backend.ts, file bytes via
// filesBackend.ts); either one being invalid must block the same way. Kept
// generic (not importing filesBackend.ts here) so this file's only
// responsibility stays "the business-data axis" — App.tsx composes the two
// results together before handing one BackendConfiguration to the gate.
export function combineBackendConfigurations(
  primary: BackendConfiguration,
  ...others: readonly { valid: boolean; error: string | null }[]
): BackendConfiguration {
  if (!primary.valid) return primary;
  for (const other of others) {
    if (!other.valid && other.error) {
      return { valid: false, kind: null, error: other.error };
    }
  }
  return primary;
}
