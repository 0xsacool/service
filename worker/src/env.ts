export interface Env {
  ATTACHMENTS_BUCKET: R2Bucket;
  // Comma-separated list of browser origins allowed to call this Worker,
  // configured in wrangler.toml's [vars] (or overridden via .dev.vars
  // locally). Not a secret — see cors.ts.
  ALLOWED_ORIGINS: string;

  // F5d-5 — Firestore access config. See googleAuth.ts/firestoreClient.ts.
  // FIRESTORE_PROJECT_ID is public (wrangler.toml [vars], mirrors
  // VITE_FIREBASE_PROJECT_ID already being public). FIRESTORE_EMULATOR_HOST
  // is local-dev-only (.dev.vars) — when set, googleAuth.ts skips the real
  // Google token exchange entirely and firestoreClient.ts targets the
  // emulator instead of real Firestore. GOOGLE_SERVICE_ACCOUNT_EMAIL/
  // GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY are unset in this sprint — no real
  // service account exists yet. In production these three become
  // `wrangler secret put` values, never wrangler.toml entries. See
  // worker/README.md's "Firestore access" section for the full picture,
  // including which of these are secrets and which aren't.
  FIRESTORE_PROJECT_ID: string;
  FIRESTORE_EMULATOR_HOST?: string;
  GOOGLE_SERVICE_ACCOUNT_EMAIL?: string;
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?: string;
  // Override for the Google OAuth2 token endpoint — only ever set in tests,
  // to point at a local mock instead of https://oauth2.googleapis.com/token
  // (the default when unset). Never needed in production or in normal
  // emulator-only local dev.
  GOOGLE_TOKEN_ENDPOINT?: string;
}
