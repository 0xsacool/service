// Phase 6R-B.2 (SF-5) — a minimal React element renderer used ONLY by tests,
// aliased over `react`, `react/jsx-runtime` and `react-dom` so the real,
// unmodified Approval Console components can be mounted and driven in Node.
//
// test/support/hookRuntime.mjs solved the same problem one layer lower: it is
// a dispatcher for the five hooks the D24/D25 hooks use, and it cannot render
// a component, because a component reaches for JSX, forwardRef, useId,
// useLayoutEffect and createPortal as well. That limitation is exactly what
// left the evidence lifecycle, the search-mode transitions and the approve/
// reject modals covered only by one-shot SSR markup and source regexes, which
// is what Phase 4R.6 found insufficient. This file closes that gap without a
// new dependency.
//
// It is a purpose-built test double for React, NOT React. It renders function
// components (plus forwardRef/memo wrappers, Fragments, context providers and
// portals) into a plain host-element tree, reconciles that tree by position so
// hook state survives a re-render, and schedules re-renders on a microtask —
// never synchronously inside a state setter — because that is what reproduces
// the same-tick races the production latches have to defeat.
//
// There is no DOM. Refs to host elements stay null, which is deliberate: it is
// also what makes Modal's focus-trap effect bail out at its own `if (!overlay
// || !dialog) return` guard instead of touching document APIs that do not
// exist here. Tests that need focus/inert behavior are not in scope for this
// harness and are not claimed anywhere in this phase.

const ELEMENT = Symbol.for('test.element');
const FORWARD_REF = Symbol.for('test.forwardRef');
const MEMO = Symbol.for('test.memo');
const PROVIDER = Symbol.for('test.provider');
const CONSUMER = Symbol.for('test.consumer');

export const Fragment = Symbol.for('test.fragment');
export const StrictMode = Fragment;

let currentFiber = null;
let currentRoot = null;
let idCounter = 0;

function makeElement(type, config, maybeKey) {
  const props = {};
  let key = maybeKey === undefined ? null : String(maybeKey);
  let ref = null;
  for (const name of Object.keys(config ?? {})) {
    if (name === 'key') {
      key = config[name] === null || config[name] === undefined ? key : String(config[name]);
    } else if (name === 'ref') {
      ref = config[name];
    } else {
      props[name] = config[name];
    }
  }
  return { $$typeof: ELEMENT, type, props, key, ref };
}

export function jsx(type, config, key) {
  return makeElement(type, config, key);
}
export const jsxs = jsx;
export const jsxDEV = jsx;

export function createElement(type, config, ...children) {
  const element = makeElement(type, config);
  if (children.length === 1) element.props.children = children[0];
  else if (children.length > 1) element.props.children = children;
  return element;
}

export function isValidElement(value) {
  return Boolean(value) && value.$$typeof === ELEMENT;
}

export function forwardRef(render) {
  return { $$typeof: FORWARD_REF, render };
}

export function memo(type) {
  return { $$typeof: MEMO, type };
}

export function createContext(defaultValue) {
  const context = { _currentValue: defaultValue };
  context.Provider = { $$typeof: PROVIDER, context };
  context.Consumer = { $$typeof: CONSUMER, context };
  return context;
}

// --- hooks -----------------------------------------------------------------

function slot() {
  if (!currentFiber) throw new Error('hook called outside a mounted render');
  const index = currentFiber.cursor;
  currentFiber.cursor += 1;
  if (index >= currentFiber.slots.length) currentFiber.slots.push({});
  return currentFiber.slots[index];
}

function sameDeps(previous, next) {
  if (previous === undefined || next === undefined) return false;
  return (
    previous.length === next.length &&
    previous.every((value, index) => Object.is(value, next[index]))
  );
}

export function useState(initial) {
  const cell = slot();
  const root = currentRoot;
  if (!('value' in cell)) {
    cell.value = typeof initial === 'function' ? initial() : initial;
    cell.set = (next) => {
      const resolved = typeof next === 'function' ? next(cell.value) : next;
      if (Object.is(resolved, cell.value)) return;
      cell.value = resolved;
      root.scheduleRender();
    };
  }
  return [cell.value, cell.set];
}

export function useReducer(reducer, initialArg, init) {
  const cell = slot();
  const root = currentRoot;
  if (!('value' in cell)) {
    cell.value = init ? init(initialArg) : initialArg;
    cell.dispatch = (action) => {
      const resolved = reducer(cell.value, action);
      if (Object.is(resolved, cell.value)) return;
      cell.value = resolved;
      root.scheduleRender();
    };
  }
  return [cell.value, cell.dispatch];
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
  return useMemo(() => callback, deps);
}

export function useEffect(effect, deps) {
  const cell = slot();
  const changed = !('deps' in cell) || !sameDeps(cell.deps, deps);
  cell.deps = deps;
  if (changed) {
    cell.effect = effect;
    currentRoot.pendingEffects.push(cell);
  }
}

export const useLayoutEffect = useEffect;
export const useInsertionEffect = useEffect;

export function useId() {
  const cell = slot();
  if (!('id' in cell)) {
    idCounter += 1;
    cell.id = `:t${idCounter}:`;
  }
  return cell.id;
}

export function useContext(context) {
  return context._currentValue;
}

export function useSyncExternalStore(subscribe, getSnapshot) {
  const cell = slot();
  const root = currentRoot;
  if (!('unsubscribe' in cell)) {
    cell.unsubscribe = subscribe(() => root.scheduleRender());
    cell.cleanup = () => cell.unsubscribe?.();
  }
  return getSnapshot();
}

export class Component {
  constructor(props) {
    this.props = props;
    this.state = {};
  }
  setState() {}
  render() {
    return null;
  }
}

// --- rendering -------------------------------------------------------------

function normalizeChildren(children) {
  const flat = [];
  const push = (value) => {
    if (Array.isArray(value)) {
      value.forEach(push);
      return;
    }
    if (value === null || value === undefined || value === false || value === true) return;
    flat.push(value);
  };
  push(children);
  return flat;
}

function elementKey(element, index) {
  if (typeof element !== 'object') return `text:${index}`;
  return `${element.key ?? index}`;
}

function unmountFiber(fiber) {
  if (!fiber) return;
  for (const cell of fiber.slots ?? []) {
    if (typeof cell.cleanup === 'function') {
      cell.cleanup();
      cell.cleanup = null;
    }
  }
  for (const child of fiber.children ?? []) unmountFiber(child);
}

function reuse(previous, element) {
  if (!previous || typeof element !== 'object') {
    return previous && typeof element !== 'object' && previous.kind === 'text'
      ? previous
      : null;
  }
  if (previous.kind === 'text') return null;
  return previous.type === element.type && previous.key === (element.key ?? previous.key)
    ? previous
    : null;
}

function renderElement(element, previous, root) {
  if (element === null || element === undefined || element === false || element === true) {
    unmountFiber(previous);
    return null;
  }

  if (typeof element === 'string' || typeof element === 'number') {
    if (previous && previous.kind !== 'text') unmountFiber(previous);
    return { kind: 'text', text: String(element), children: [], slots: [] };
  }

  if (Array.isArray(element)) {
    return renderChildrenFiber(element, previous, root);
  }

  const { type, props } = element;
  const matched = reuse(previous, element);
  if (previous && !matched) unmountFiber(previous);

  if (type === Fragment) {
    return {
      kind: 'fragment',
      type,
      key: element.key,
      children: reconcileChildren(props.children, matched?.children ?? [], root),
      slots: [],
    };
  }

  if (typeof type === 'string') {
    return {
      kind: 'host',
      type,
      key: element.key,
      props,
      children: reconcileChildren(props.children, matched?.children ?? [], root),
      slots: [],
    };
  }

  if (type && type.$$typeof === PROVIDER) {
    const context = type.context;
    const outer = context._currentValue;
    context._currentValue = props.value;
    const children = reconcileChildren(props.children, matched?.children ?? [], root);
    context._currentValue = outer;
    return { kind: 'provider', type, key: element.key, children, slots: [] };
  }

  if (type && type.$$typeof === CONSUMER) {
    const rendered = props.children(type.context._currentValue);
    return {
      kind: 'consumer',
      type,
      key: element.key,
      children: reconcileChildren(rendered, matched?.children ?? [], root),
      slots: [],
    };
  }

  if (type && type.$$typeof === MEMO) {
    return renderElement({ ...element, type: type.type }, matched, root);
  }

  // A real-React forward_ref/memo object reaching here means some module in
  // the tree resolved the real `react` instead of this runtime — almost always
  // a node_modules package Vite externalized for SSR. Fail loudly rather than
  // rendering a silently empty subtree that a test could then mis-assert on.
  if (typeof type !== 'function' && type?.$$typeof !== FORWARD_REF) {
    throw new Error(
      `componentRuntime cannot render element type ${String(type?.$$typeof ?? typeof type)} — ` +
        'the module that created it did not resolve through the runtime alias ' +
        '(add its package to ssr.noExternal).'
    );
  }
  const fiber = matched ?? { kind: 'component', type, key: element.key, slots: [], children: [] };
  fiber.props = props;
  fiber.cursor = 0;
  const previousFiber = currentFiber;
  currentFiber = fiber;
  let rendered;
  try {
    rendered =
      type.$$typeof === FORWARD_REF
        ? type.render(props, element.ref ?? null)
        : type(props);
  } finally {
    currentFiber = previousFiber;
  }
  fiber.children = reconcileChildren(rendered, fiber.children, root);
  return fiber;
}

function reconcileChildren(children, previousChildren, root) {
  const list = normalizeChildren(children);
  const result = [];
  const used = new Set();
  list.forEach((child, index) => {
    const key = elementKey(child, index);
    let previous = null;
    for (let i = 0; i < previousChildren.length; i += 1) {
      if (used.has(i)) continue;
      const candidate = previousChildren[i];
      if (candidate && candidate.matchKey === key) {
        previous = candidate;
        used.add(i);
        break;
      }
    }
    const fiber = renderElement(child, previous, root);
    if (fiber) {
      fiber.matchKey = key;
      result.push(fiber);
    }
  });
  previousChildren.forEach((candidate, index) => {
    if (!used.has(index) && !result.includes(candidate)) unmountFiber(candidate);
  });
  return result;
}

function renderChildrenFiber(children, previous, root) {
  return {
    kind: 'fragment',
    children: reconcileChildren(children, previous?.children ?? [], root),
    slots: [],
  };
}

// --- host tree + queries ---------------------------------------------------

function toHostNodes(fiber) {
  if (!fiber) return [];
  if (fiber.kind === 'text') return [fiber.text];
  if (fiber.kind === 'host') {
    return [
      {
        type: fiber.type,
        props: fiber.props,
        children: fiber.children.flatMap(toHostNodes),
      },
    ];
  }
  return fiber.children.flatMap(toHostNodes);
}

function nodeText(node) {
  if (typeof node === 'string') return node;
  return node.children.map(nodeText).join('');
}

function walk(nodes, visit) {
  for (const node of nodes) {
    if (typeof node === 'string') continue;
    visit(node);
    walk(node.children, visit);
  }
}

export function mountComponent(element) {
  const root = {
    element,
    fiber: null,
    pendingEffects: [],
    scheduled: false,
    unmounted: false,
    renders: 0,
  };

  const runRender = () => {
    const previousRoot = currentRoot;
    currentRoot = root;
    try {
      root.fiber = renderElement(root.element, root.fiber, root);
      root.renders += 1;
    } finally {
      currentRoot = previousRoot;
    }
    const pending = root.pendingEffects;
    root.pendingEffects = [];
    for (const cell of pending) {
      if (typeof cell.cleanup === 'function') cell.cleanup();
      cell.cleanup = cell.effect();
    }
  };

  root.scheduleRender = () => {
    if (root.unmounted || root.scheduled) return;
    root.scheduled = true;
    queueMicrotask(() => {
      root.scheduled = false;
      if (!root.unmounted) runRender();
    });
  };

  runRender();

  const nodes = () => toHostNodes(root.fiber);

  const findAll = (predicate) => {
    const found = [];
    walk(nodes(), (node) => {
      if (predicate(node)) found.push(node);
    });
    return found;
  };

  const controller = {
    renders: () => root.renders,
    nodes,
    text: () => nodes().map(nodeText).join(''),
    findAll,
    find(predicate) {
      const [first] = findAll(predicate);
      return first ?? null;
    },
    byRole(role, name) {
      return findAll(
        (node) =>
          (node.props.role === role || (role === 'button' && node.type === 'button')) &&
          (name === undefined || nodeText(node).includes(name))
      );
    },
    byText(text) {
      return findAll((node) => nodeText(node).includes(text));
    },
    button(label) {
      return (
        findAll((node) => node.type === 'button' && nodeText(node).includes(label))[0] ?? null
      );
    },
    field(tag) {
      return findAll((node) => node.type === tag)[0] ?? null;
    },
    async click(node) {
      if (!node) throw new Error('click() received no node');
      if (node.props.disabled) throw new Error('click() on a disabled control');
      node.props.onClick?.({ preventDefault() {}, stopPropagation() {} });
      await controller.flush();
    },
    clickSync(node) {
      node.props.onClick?.({ preventDefault() {}, stopPropagation() {} });
    },
    async type(node, value) {
      if (!node) throw new Error('type() received no node');
      node.props.onChange?.({ target: { value } });
      await controller.flush();
    },
    async rerender(nextElement) {
      root.element = nextElement;
      runRender();
      await controller.flush();
    },
    unmount() {
      root.unmounted = true;
      unmountFiber(root.fiber);
      root.fiber = null;
    },
    // Drains microtasks and timers repeatedly: a resolved promise schedules a
    // render, which may schedule further work, so one turn is not enough.
    async flush(rounds = 8) {
      for (let round = 0; round < rounds; round += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    },
  };

  return controller;
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

export default {
  Component,
  Fragment,
  StrictMode,
  createContext,
  createElement,
  forwardRef,
  isValidElement,
  jsx,
  jsxDEV,
  jsxs,
  memo,
  useCallback,
  useContext,
  useEffect,
  useId,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
};
