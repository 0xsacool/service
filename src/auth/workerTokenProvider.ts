export interface WorkerTokenProvider {
  getIdToken(forceRefresh?: boolean): Promise<string | null>;
  handlePersistentUnauthorized?(): Promise<void>;
}

export const unavailableWorkerTokenProvider: WorkerTokenProvider = {
  async getIdToken() {
    return null;
  },
};

export interface WorkerFetchDependencies {
  fetch: typeof fetch;
}

// F5d-55 — root cause of Gate 7.1's transport-level failure ("Failed to
// execute 'fetch' on 'Window': Illegal invocation"). `{ fetch }` copies the
// native fetch function reference onto a plain object without its required
// receiver. Chrome's native `fetch` is a WebIDL "unforgeable" method that
// only accepts Window (or another Window-like global) as `this`; invoking
// it as `dependencies.fetch(...)` calls it with `dependencies` — an
// ordinary plain object — as the receiver, which fails Chrome's internal
// brand check. `.bind(globalThis)` permanently rebinds the receiver to the
// real global object, so the bound function behaves correctly regardless
// of what object it's later attached to or called through.
const browserWorkerFetchDependencies: WorkerFetchDependencies = {
  fetch: globalThis.fetch.bind(globalThis),
};

export async function fetchWithWorkerToken(
  tokenProvider: WorkerTokenProvider,
  input: RequestInfo | URL,
  init: RequestInit,
  dependencies: WorkerFetchDependencies = browserWorkerFetchDependencies
): Promise<Response> {
  const send = async (forceRefresh: boolean): Promise<Response> => {
    const idToken = await tokenProvider.getIdToken(forceRefresh);
    if (!idToken) {
      throw new Error('Worker authorization is not configured for this session');
    }
    return await dependencies.fetch(input, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${idToken}`,
      },
    });
  };

  const initial = await send(false);
  if (initial.status !== 401) {
    return initial;
  }

  const refreshed = await send(true);
  if (refreshed.status === 401) {
    await tokenProvider.handlePersistentUnauthorized?.();
  }
  return refreshed;
}
