import type { BrandId } from '../types';
import type { StaffProfile } from './staffProfile';

export interface FirebaseUserLike {
  uid: string;
  email: string | null;
  getIdToken(forceRefresh?: boolean): Promise<string>;
}

export type AuthSessionStatus =
  | 'mock'
  | 'loading'
  | 'signed-out'
  | 'profile-loading'
  | 'authorized'
  | 'denied'
  | 'unavailable';

export interface AuthSession {
  status: AuthSessionStatus;
  user: FirebaseUserLike | null;
  staffProfile: StaffProfile | null;
  error: string | null;
}

export function createSignedOutSession(): AuthSession {
  return { status: 'signed-out', user: null, staffProfile: null, error: null };
}

export function createMockSession(): AuthSession {
  return { status: 'mock', user: null, staffProfile: null, error: null };
}

export function createUnavailableSession(error: string): AuthSession {
  return { status: 'unavailable', user: null, staffProfile: null, error };
}

export async function resolveAuthenticatedSession(
  user: FirebaseUserLike,
  readProfile: (uid: string) => Promise<StaffProfile | null>
): Promise<AuthSession> {
  const staffProfile = await readProfile(user.uid);
  if (!staffProfile) {
    return {
      status: 'denied',
      user,
      staffProfile: null,
      error: 'This account is not authorized for staff access.',
    };
  }
  return { status: 'authorized', user, staffProfile, error: null };
}

export function getAuthorizedBrandId(session: AuthSession): BrandId | null {
  return session.status === 'authorized' ? (session.staffProfile?.brandId ?? null) : null;
}
