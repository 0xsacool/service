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

const browserWorkerFetchDependencies: WorkerFetchDependencies = { fetch };

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
