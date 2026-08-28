// Phase 6R-B.2 (SF-5) — the `react-dom` half of the componentRuntime alias
// set. Modal renders through createPortal when a document exists; there is no
// DOM here, so the portal renders in place, which is what lets a mounted
// modal's controls be found and clicked.
export function createPortal(children) {
  return children;
}

export function flushSync(callback) {
  return callback();
}

export default { createPortal, flushSync };
