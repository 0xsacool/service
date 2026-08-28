import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// Phase 6R-B.3 (Phase 4R.6R finding R6R-SF2) — the Vite wiring that lets a
// Node test load the REAL concrete AttachmentsRepository implementations and
// call getDownloadUrl() for real, so the caller-owned disposable-object-URL
// contract in src/repositories/types.ts is proven by behavior rather than
// asserted by a comment.
//
// The Worker-backed repository is a factory that awaits
// createFirestoreAttachmentMetadataStore() before it is usable, which would
// mean a live Firestore. That store is metadata bookkeeping only — it has no
// part in the download URL contract — so it is the one module aliased away
// here, to the in-memory double below. Byte transport (fetchWithWorkerToken)
// and URL creation are the unmodified production code paths.
//
// Same cacheDir discipline as componentRuntimeServer.mjs: this suite changes
// the Vite config, so it must not share node_modules/.vite with the rest.
const METADATA_STUB = fileURLToPath(
  new URL('./attachmentMetadataStoreStub.mjs', import.meta.url)
);

export function createRepositoryRuntimeServer(cacheName) {
  return createServer({
    appType: 'custom',
    server: { middlewareMode: true, hmr: false },
    resolve: {
      alias: [{ find: /firestoreAttachmentsRepository$/, replacement: METADATA_STUB }],
    },
    optimizeDeps: { noDiscovery: true, include: [] },
    cacheDir: join(tmpdir(), `service-repository-runtime-${cacheName}`),
  });
}
