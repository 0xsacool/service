import { createContext, useContext } from 'react';
import type { AuthSession } from './authSession';
import type { WorkerTokenProvider } from './workerTokenProvider';
import { unavailableWorkerTokenProvider } from './workerTokenProvider';
import { createUnavailableSession } from './authSession';

export interface AuthSessionContextValue extends AuthSession {
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  workerTokenProvider: WorkerTokenProvider;
}

const unavailableContext: AuthSessionContextValue = {
  ...createUnavailableSession('Authentication is unavailable.'),
  async signIn() {
    throw new Error('Authentication is unavailable.');
  },
  async signOut() {},
  workerTokenProvider: unavailableWorkerTokenProvider,
};

export const AuthSessionContext =
  createContext<AuthSessionContextValue>(unavailableContext);

export function useAuthSession(): AuthSessionContextValue {
  return useContext(AuthSessionContext);
}
