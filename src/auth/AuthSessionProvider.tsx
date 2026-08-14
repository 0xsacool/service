import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import { backendKind } from '../config/backend';
import {
  activateFirestoreRepositories,
  resetRepositoriesForSession,
} from '../repositories/repositoryProvider';
import { getFirebaseAuth } from '../lib/firebase/firebase';
import {
  createMockSession,
  createSignedOutSession,
  createUnavailableSession,
  resolveAuthenticatedSession,
  type AuthSession,
  type FirebaseUserLike,
} from './authSession';
import { createFirestoreStaffProfileReader } from './staffProfile';
import { AuthSessionContext, type AuthSessionContextValue } from './authSessionContext';
import type { WorkerTokenProvider } from './workerTokenProvider';

function toFirebaseUserLike(user: User): FirebaseUserLike {
  return {
    uid: user.uid,
    email: user.email,
    getIdToken: (forceRefresh) => user.getIdToken(forceRefresh),
  };
}

export function AuthSessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AuthSession>(() =>
    backendKind === 'mock'
      ? createMockSession()
      : { ...createSignedOutSession(), status: 'loading' }
  );
  const currentUser = useRef<User | null>(null);

  const signOutCurrentUser = useCallback(async (): Promise<void> => {
    currentUser.current = null;
    resetRepositoriesForSession();
    if (backendKind === 'firestore') {
      await signOut(getFirebaseAuth());
    }
  }, []);

  const workerTokenProvider = useMemo<WorkerTokenProvider>(
    () => ({
      async getIdToken(forceRefresh) {
        return currentUser.current
          ? await currentUser.current.getIdToken(forceRefresh)
          : null;
      },
      async handlePersistentUnauthorized() {
        await signOutCurrentUser();
      },
    }),
    [signOutCurrentUser]
  );

  useEffect(() => {
    if (backendKind === 'mock') return;

    if (backendKind !== 'firestore') {
      let active = true;
      resetRepositoriesForSession();
      queueMicrotask(() => {
        if (active) {
          setSession(createUnavailableSession('การตั้งค่าระบบยืนยันตัวตนไม่พร้อมใช้งาน'));
        }
      });
      return () => {
        active = false;
      };
    }

    let active = true;
    let unsubscribe: (() => void) | undefined;
    try {
      const auth = getFirebaseAuth();
      const reader = createFirestoreStaffProfileReader();
      unsubscribe = onAuthStateChanged(auth, (user) => {
        currentUser.current = user;
        if (!user) {
          resetRepositoriesForSession();
          if (active) setSession(createSignedOutSession());
          return;
        }
        if (active) {
          setSession({
            status: 'profile-loading',
            user: toFirebaseUserLike(user),
            staffProfile: null,
            error: null,
          });
        }
        void resolveAuthenticatedSession(
          toFirebaseUserLike(user),
          reader.getOwnProfile
        ).then(
          async (next) => {
            if (!active || currentUser.current?.uid !== user.uid) return;
            if (next.status !== 'authorized' || !next.staffProfile) {
              resetRepositoriesForSession();
              setSession(next);
              return;
            }
            try {
              await activateFirestoreRepositories(
                next.staffProfile.brandId,
                workerTokenProvider
              );
              if (active && currentUser.current?.uid === user.uid) setSession(next);
            } catch {
              resetRepositoriesForSession();
              if (active && currentUser.current?.uid === user.uid) {
                setSession(
                  createUnavailableSession(
                    'ไม่สามารถเตรียมข้อมูลเจ้าหน้าที่ได้ กรุณาลองใหม่ภายหลัง'
                  )
                );
              }
            }
          },
          () => {
            resetRepositoriesForSession();
            if (active && currentUser.current?.uid === user.uid) {
              setSession(
                createUnavailableSession(
                  'ไม่สามารถตรวจสอบสิทธิ์เจ้าหน้าที่ได้ กรุณาลองใหม่ภายหลัง'
                )
              );
            }
          }
        );
      });
    } catch {
      resetRepositoriesForSession();
      queueMicrotask(() => {
        if (active) {
          setSession(createUnavailableSession('การตั้งค่าระบบยืนยันตัวตนไม่พร้อมใช้งาน'));
        }
      });
    }
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [workerTokenProvider]);

  const value: AuthSessionContextValue = {
    ...session,
    async signIn(email, password) {
      if (backendKind !== 'firestore') return;
      await signInWithEmailAndPassword(getFirebaseAuth(), email, password);
    },
    signOut: signOutCurrentUser,
    workerTokenProvider,
  };

  return (
    <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>
  );
}
