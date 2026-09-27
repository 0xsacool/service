import { JSDOM } from 'jsdom';

const GLOBAL_NAMES = [
  'window',
  'self',
  'document',
  'navigator',
  'location',
  'history',
  'HTMLElement',
  'Element',
  'Node',
  'Text',
  'Document',
  'DocumentFragment',
  'Event',
  'CustomEvent',
  'MouseEvent',
  'KeyboardEvent',
  'FocusEvent',
  'MutationObserver',
  'DOMRect',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
];

function installGlobal(name, value, restore) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  restore.push(() => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  });
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
}

function installInertPolyfill(window) {
  const descriptor = Object.getOwnPropertyDescriptor(
    window.HTMLElement.prototype,
    'inert'
  );
  if (descriptor) return () => {};

  Object.defineProperty(window.HTMLElement.prototype, 'inert', {
    configurable: true,
    get() {
      return this.hasAttribute('inert');
    },
    set(value) {
      if (value) this.setAttribute('inert', '');
      else this.removeAttribute('inert');
    },
  });

  return () => {
    delete window.HTMLElement.prototype.inert;
  };
}

function installVisibleLayoutShim(window) {
  const descriptor = Object.getOwnPropertyDescriptor(
    window.HTMLElement.prototype,
    'getClientRects'
  );

  Object.defineProperty(window.HTMLElement.prototype, 'getClientRects', {
    configurable: true,
    value() {
      if (this.hidden || this.style?.display === 'none') return [];
      return [
        {
          x: 0,
          y: 0,
          top: 0,
          right: 1,
          bottom: 1,
          left: 0,
          width: 1,
          height: 1,
          toJSON() {
            return this;
          },
        },
      ];
    },
  });

  return () => {
    if (descriptor) {
      Object.defineProperty(window.HTMLElement.prototype, 'getClientRects', descriptor);
    } else {
      delete window.HTMLElement.prototype.getClientRects;
    }
  };
}

function installMatchMedia(window) {
  const entries = new Map();

  window.matchMedia = (query) => {
    let entry = entries.get(query);
    if (!entry) {
      const listeners = new Set();
      const legacyListeners = new Set();
      entry = {
        matches: false,
        listeners,
        legacyListeners,
        mql: null,
      };
      entry.mql = {
        media: query,
        get matches() {
          return entry.matches;
        },
        onchange: null,
        addEventListener(type, listener) {
          if (type === 'change') listeners.add(listener);
        },
        removeEventListener(type, listener) {
          if (type === 'change') listeners.delete(listener);
        },
        addListener(listener) {
          legacyListeners.add(listener);
        },
        removeListener(listener) {
          legacyListeners.delete(listener);
        },
        dispatchEvent(event) {
          for (const listener of listeners) listener.call(entry.mql, event);
          for (const listener of legacyListeners) listener.call(entry.mql, event);
          entry.mql.onchange?.call(entry.mql, event);
          return true;
        },
      };
      entries.set(query, entry);
    }
    return entry.mql;
  };

  return {
    setMatches(query, matches) {
      const mql = window.matchMedia(query);
      const entry = entries.get(query);
      if (entry.matches === matches) return;
      entry.matches = matches;
      mql.dispatchEvent({ type: 'change', matches, media: query });
    },
  };
}

export function installDomTestEnvironment({ url = 'http://localhost/dashboard' } = {}) {
  const dom = new JSDOM('<!doctype html><html lang="th"><body></body></html>', {
    url,
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const restore = [];

  const restoreInert = installInertPolyfill(window);
  const restoreLayout = installVisibleLayoutShim(window);
  const media = installMatchMedia(window);

  const values = {
    window,
    self: window,
    document: window.document,
    navigator: window.navigator,
    location: window.location,
    history: window.history,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    Text: window.Text,
    Document: window.Document,
    DocumentFragment: window.DocumentFragment,
    Event: window.Event,
    CustomEvent: window.CustomEvent,
    MouseEvent: window.MouseEvent,
    KeyboardEvent: window.KeyboardEvent,
    FocusEvent: window.FocusEvent,
    MutationObserver: window.MutationObserver,
    DOMRect: window.DOMRect,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  };

  for (const name of GLOBAL_NAMES) installGlobal(name, values[name], restore);

  const actDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'IS_REACT_ACT_ENVIRONMENT'
  );
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  return {
    window,
    document: window.document,
    setMediaMatches: media.setMatches,
    async nextAnimationFrame() {
      await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
    },
    resetBody() {
      window.document.body.replaceChildren();
      window.document.title = '';
    },
    cleanup() {
      restoreLayout();
      restoreInert();
      for (const restoreGlobal of restore.reverse()) restoreGlobal();
      if (actDescriptor) {
        Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', actDescriptor);
      } else {
        delete globalThis.IS_REACT_ACT_ENVIRONMENT;
      }
      dom.window.close();
    },
  };
}
