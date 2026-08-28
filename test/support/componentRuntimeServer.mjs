import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// Phase 6R-B.2 (SF-5) — the Vite wiring that puts test/support/componentRuntime.mjs
// in front of `react`, `react/jsx-runtime` and `react-dom` for a suite that
// mounts real components.
//
// The alias list is deliberately an array of exact-match regexes, not the
// object form: an object alias of `react` also captures `react/jsx-runtime` as
// a prefix and rewrites it to <runtime>/jsx-runtime, which resolves to nothing.
//
// lucide-react has to be bundled rather than externalized. Vite externalizes
// node_modules for SSR by default, so an externalized icon package would reach
// for the real React through Node's own resolution, produce real React
// elements, and the runtime would refuse to render them.
const RUNTIME = fileURLToPath(new URL('./componentRuntime.mjs', import.meta.url));
const JSX_RUNTIME = fileURLToPath(new URL('./componentJsxRuntime.mjs', import.meta.url));
const REACT_DOM = fileURLToPath(new URL('./componentReactDom.mjs', import.meta.url));

export const COMPONENT_RUNTIME_PATH = RUNTIME;

export function createComponentRuntimeServer(cacheName) {
  return createServer({
    appType: 'custom',
    server: { middlewareMode: true, hmr: false },
    resolve: {
      alias: [
        { find: /^react\/jsx-dev-runtime$/, replacement: JSX_RUNTIME },
        { find: /^react\/jsx-runtime$/, replacement: JSX_RUNTIME },
        { find: /^react-dom$/, replacement: REACT_DOM },
        { find: /^react$/, replacement: RUNTIME },
      ],
    },
    ssr: { noExternal: ['lucide-react'] },
    // Nothing here is served to a browser; leaving discovery on makes the
    // client dependency optimizer chase react/jsx-runtime through the alias.
    optimizeDeps: { noDiscovery: true, include: [] },
    // These suites alter the Vite config, so they must not share
    // node_modules/.vite with the rest: root `node --test` runs test files
    // concurrently, and a config-triggered re-optimize would delete the shared
    // dep cache out from under whichever sibling suite is reading it. Each
    // suite passes its own name so two of them cannot collide either.
    cacheDir: join(tmpdir(), `service-component-runtime-${cacheName}`),
  });
}
