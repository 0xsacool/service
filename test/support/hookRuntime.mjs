// Phase 6R-A.2 — a minimal React-hooks dispatcher used ONLY by tests, aliased
// over the `react` specifier so the real, unmodified D24/D25 hooks can be
// mounted and driven in Node. This project has no DOM shim, no
// react-test-renderer, and no testing-library, and the phase forbids installing
// one; this is the narrowest seam that still exercises the hooks themselves
// rather than a projection of them.
//
// It is a purpose-built test double for React's dispatcher, NOT React. It
// implements exactly the five hooks the D24/D25 hooks use, and it deliberately
// schedules re-renders on a microtask (never synchronously inside a state
// setter) because that is what reproduces the same-tick decision race the
// production latch has to defeat.

let currentFiber = null;

function slot() {
  if (!currentFiber) throw new Error('hook called outside a mounted render');
  const index = currentFiber.cursor;
  currentFiber.cursor += 1;
  if (index >= currentFiber.slots.length) currentFiber.slots.push({});
  return currentFiber.slots[index];
}

function sameDeps(previous, next) {
  if (previous === undefined || next === undefined) return false;
  return previous.length === next.length &&
    previous.every((value, index) => Object.is(value, next[index]));
}

export function useState(initial) {
  const cell = slot();
  const fiber = currentFiber;
  if (!('value' in cell)) {
    cell.value = typeof initial === 'function' ? initial() : initial;
    cell.set = (next) => {
      const resolved = typeof next === 'function' ? next(cell.value) : next;
      if (Object.is(resolved, cell.value)) return;
      cell.value = resolved;
      fiber.scheduleRender();
    };
  }
  return [cell.value, cell.set];
}

export function useRef(initial) {
  const cell = slot();
  if (!('ref' in cell)) cell.ref = { current: initial };
  return cell.ref;
}

export function useMemo(factory, deps) {
  const cell = slot();
  if (!('value' in cell) || !sameDeps(cell.deps, deps)) {
    cell.deps = deps;
    cell.value = factory();
  }
  return cell.value;
}

export function useCallback(callback, deps) {
  const cell = slot();
  if (!('value' in cell) || !sameDeps(cell.deps, deps)) {
    cell.deps = deps;
    cell.value = callback;
  }
  return cell.value;
}

export function useEffect(effect, deps) {
  const cell = slot();
  const changed = !('deps' in cell) || !sameDeps(cell.deps, deps);
  cell.deps = deps;
  if (changed) {
    cell.effect = effect;
    currentFiber.pendingEffects.push(cell);
  }
}

function runRender(fiber) {
  fiber.cursor = 0;
  const previous = currentFiber;
  currentFiber = fiber;
  try {
    fiber.result = fiber.hook(fiber.props);
    fiber.renders += 1;
  } finally {
    currentFiber = previous;
  }
  const pending = fiber.pendingEffects;
  fiber.pendingEffects = [];
  for (const cell of pending) {
    if (typeof cell.cleanup === 'function') cell.cleanup();
    cell.cleanup = cell.effect();
  }
}

export function mountHook(hook, props) {
  const fiber = {
    hook,
    props,
    slots: [],
    cursor: 0,
    pendingEffects: [],
    result: null,
    renders: 0,
    scheduled: false,
    unmounted: false,
  };
  fiber.scheduleRender = () => {
    if (fiber.unmounted || fiber.scheduled) return;
    fiber.scheduled = true;
    queueMicrotask(() => {
      fiber.scheduled = false;
      if (!fiber.unmounted) runRender(fiber);
    });
  };
  runRender(fiber);
  return {
    result: () => fiber.result,
    renders: () => fiber.renders,
    rerender(nextProps) {
      fiber.props = nextProps;
      runRender(fiber);
    },
    unmount() {
      fiber.unmounted = true;
      for (const cell of fiber.slots) {
        if (typeof cell.cleanup === 'function') {
          cell.cleanup();
          cell.cleanup = null;
        }
      }
    },
    // Drains microtasks and timers repeatedly: a resolved fetch schedules a
    // render, which may schedule further work, so one turn is not enough.
    async flush(rounds = 8) {
      for (let round = 0; round < rounds; round += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    },
  };
}

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveWith, rejectWith) => {
    resolve = resolveWith;
    reject = rejectWith;
  });
  // The rejection is always asserted by the caller; this keeps an unhandled
  // rejection from tearing down the process before the assertion runs.
  promise.catch(() => {});
  return { promise, resolve, reject };
}

export default { useCallback, useEffect, useMemo, useRef, useState };
