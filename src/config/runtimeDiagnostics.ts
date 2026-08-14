import { backendConfiguration, type BackendKind } from './backend';
import { filesBackendConfiguration, type FilesBackendKind } from './filesBackend';
import { filesWorkerUrlConfiguration } from './workerUrl';

// F5d-54 — root cause: Gate 7.1's manual rehearsal appeared to succeed
// (produced BRN-2026-000001/SR-2026-000001) but was actually running the
// Mock create path, because the operator had no way to see the active
// runtime backend from the running app. Mock's Service Job ID formatting
// deliberately mirrors the real BRN-YYYY-NNNNNN/SR-YYYY-NNNNNN shape
// (serviceJobsRepository.ts), so a Mock-created result is not visually
// distinguishable from a Firestore+Worker one by its ID alone. This module
// is the single source of truth every runtime indicator (UI badge, dev
// console) reads from — never a second, independently-computed check.
//
// Deliberately exposes only backendKind/filesBackend/workerConfigured/
// firebaseProject — never VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN,
// VITE_FIREBASE_APP_ID, VITE_FIREBASE_MESSAGING_SENDER_ID, or
// VITE_FILES_WORKER_URL's actual value. A Firebase project ID is a public
// identifier (it appears in the app's own URLs), not a credential.
export interface RuntimeDiagnostics {
  backendKind: BackendKind | null;
  filesBackend: FilesBackendKind | null;
  workerConfigured: boolean;
  firebaseProject: string | null;
}

interface RawRuntimeInputs {
  backendValid: boolean;
  backendKind: BackendKind | null;
  filesBackendValid: boolean;
  filesBackendKind: FilesBackendKind | null;
  workerUrl: string | undefined;
  firebaseProjectId: string | undefined;
}

// Split from getRuntimeDiagnostics() below purely so tests can exercise
// every input combination directly, the same way backend.ts's
// resolveBackendConfiguration(raw, isProduction) is tested — without this,
// a test could only ever observe whatever backend/files-backend combination
// happens to be in the local .env at test time.
export function computeRuntimeDiagnostics(inputs: RawRuntimeInputs): RuntimeDiagnostics {
  const backendKind = inputs.backendValid ? inputs.backendKind : null;
  return {
    backendKind,
    filesBackend: inputs.filesBackendValid ? inputs.filesBackendKind : null,
    workerConfigured:
      typeof inputs.workerUrl === 'string' && inputs.workerUrl.trim().length > 0,
    // Only meaningful once Firestore is actually the active backend —
    // otherwise nothing reads it, so reporting it unconditionally would
    // just be noise (and, in Mock mode, a project ID that describes
    // infrastructure nothing in the running session is touching).
    firebaseProject:
      backendKind === 'firestore' &&
      typeof inputs.firebaseProjectId === 'string' &&
      inputs.firebaseProjectId.trim().length > 0
        ? inputs.firebaseProjectId
        : null,
  };
}

export function getRuntimeDiagnostics(): RuntimeDiagnostics {
  return computeRuntimeDiagnostics({
    backendValid: backendConfiguration.valid,
    backendKind: backendConfiguration.valid ? backendConfiguration.kind : null,
    filesBackendValid: filesBackendConfiguration.valid,
    filesBackendKind: filesBackendConfiguration.valid
      ? filesBackendConfiguration.kind
      : null,
    workerUrl:
      filesWorkerUrlConfiguration.valid && filesWorkerUrlConfiguration.baseUrl
        ? filesWorkerUrlConfiguration.baseUrl
        : undefined,
    firebaseProjectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  });
}

export type CreatePath = 'mock' | 'firestore-worker';

export interface CreatePathAssertion {
  ok: boolean;
  path: CreatePath;
  reasons: readonly string[];
}

// Objective 3: makes the Service Job create path provably observable before
// the fact, from the exact same configuration useCreateServiceJob.ts and
// repositoryProvider.ts already branch on — a read, never a mutation, and
// never a hardcoded Gate 7.1 ID. "ok: true" is the only state in which a
// created result can be trusted as a real Firestore+Worker write; anything
// else (including 'mock', which is a legitimate, expected development
// state, not an error) must never be presented as production-equivalent.
export function computeCreatePathAssertion(
  diagnostics: RuntimeDiagnostics
): CreatePathAssertion {
  if (diagnostics.backendKind !== 'firestore') {
    return {
      ok: false,
      path: 'mock',
      reasons: ['backendKind is "mock", not "firestore"'],
    };
  }
  const reasons: string[] = [];
  if (diagnostics.filesBackend !== 'worker') {
    reasons.push('filesBackend is not "worker"');
  }
  if (!diagnostics.workerConfigured) {
    reasons.push('VITE_FILES_WORKER_URL is not configured');
  }
  return { ok: reasons.length === 0, path: 'firestore-worker', reasons };
}

export function assertFirestoreWorkerCreatePath(): CreatePathAssertion {
  return computeCreatePathAssertion(getRuntimeDiagnostics());
}
