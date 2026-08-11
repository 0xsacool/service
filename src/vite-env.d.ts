/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Unset (or anything other than 'firestore') means 'mock' — see
  // src/config/backend.ts. Optional because running without it is the
  // normal, expected case, unlike the required Firebase vars below.
  readonly VITE_BACKEND_KIND?: string;
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string;
  readonly VITE_FIREBASE_APP_ID: string;
  // F5b — independent of VITE_BACKEND_KIND, see src/config/filesBackend.ts.
  // Both optional: unset means 'mock' / the local wrangler dev default.
  readonly VITE_FILES_BACKEND?: string;
  readonly VITE_FILES_WORKER_URL?: string;
  readonly VITE_PUBLIC_TRACKING_WORKER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
