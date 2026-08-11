import { backendConfiguration } from './backend';

// Sibling to backend.ts's BackendKind, but deliberately independent of it —
// not a third value bolted onto BackendKind. Firestore (business data) and
// the Cloudflare Worker/R2 (file bytes) are two separate backend systems
// per the approved F5 architecture proposal; conflating their toggles under
// one flag would make it impossible to, say, run Mock business data
// alongside a real Worker for attachment testing, or vice versa. Resolves
// the "worth deciding" open question flagged in that proposal's Required
// Application Changes section, in favor of keeping the two axes separate.
export type FilesBackendKind = 'mock' | 'worker';

export type FilesBackendConfiguration =
  | { valid: true; kind: FilesBackendKind; error: null }
  | { valid: false; kind: null; error: string };

// F5d-33/F5d-34 — fail-closed hardening. A missing/unset VITE_FILES_BACKEND
// previously always defaulted to 'mock', including in a production build
// where the business backend is Firestore: Service Jobs would be durable
// and shared while attachments silently stayed in-memory and per-session —
// a downgrade with no error, not a crash. Mirrors backend.ts's
// resolveBackendConfiguration: Mock stays the safe, unconditional default
// everywhere except the one combination (production + a durable business
// backend) where a missing files backend is actually a misconfiguration.
export function resolveFilesBackendConfiguration(
  raw: string | undefined,
  isProduction: boolean,
  businessBackendKind: 'mock' | 'firestore' | null
): FilesBackendConfiguration {
  if (raw === 'worker') return { valid: true, kind: 'worker', error: null };

  const productionNeedsDurableFiles = isProduction && businessBackendKind === 'firestore';

  if (
    !productionNeedsDurableFiles &&
    (raw === undefined || raw === '' || raw === 'mock')
  ) {
    return { valid: true, kind: 'mock', error: null };
  }
  if (productionNeedsDurableFiles) {
    return {
      valid: false,
      kind: null,
      error:
        'Production with a durable Service Job backend requires VITE_FILES_BACKEND=worker.',
    };
  }
  return {
    valid: false,
    kind: null,
    error: 'Files backend configuration is invalid.',
  };
}

export const filesBackendConfiguration = resolveFilesBackendConfiguration(
  import.meta.env.VITE_FILES_BACKEND,
  import.meta.env.PROD,
  backendConfiguration.kind
);

export const filesBackendKind: FilesBackendKind | null = filesBackendConfiguration.kind;
