// Phase 6R-B.2 (SF-5) — the `react/jsx-runtime` half of the componentRuntime
// alias set. Vite's automatic JSX transform emits imports from this specifier
// (and from react/jsx-dev-runtime in dev), so it has to resolve to the same
// element factory the renderer reconciles, not to real React's.
export { Fragment, jsx, jsxs, jsxDEV } from './componentRuntime.mjs';
