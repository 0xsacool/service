import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getAuth, type Auth } from 'firebase/auth';

// Sprint F1 connected the SDK; Sprint F2 made initialization lazy. Reason:
// repositoryProvider.ts statically imports every repository module — Mock
// and Firestore alike — so any Firestore repository that itself statically
// imports this module means merely running the app (even with
// backendKind === 'mock', no .env at all) pulls this module in. If
// initializeApp()/the env-var check ran eagerly at module load like Sprint
// F1 originally had it, every Mock-mode run would crash on startup with a
// "Firebase configuration is missing" error it has no reason to hit. Lazy
// getters mean importing this module is always side-effect-free — the
// env-var validation and initialization only run the first time something
// actually calls getFirestoreDb()/getFirebaseAuth(), i.e. only when a
// Firestore-backed repository is actually instantiated.

interface FirebaseEnvConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

const REQUIRED_ENV_VARS: readonly (keyof ImportMetaEnv)[] = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
];

// Fails fast with a message a developer can act on immediately, rather than
// letting `initializeApp` fail later with an opaque "invalid-api-key" or
// similar Firebase-internal error once something finally calls Firestore/Auth.
function readFirebaseEnvConfig(): FirebaseEnvConfig {
  const env = import.meta.env;
  const missing = REQUIRED_ENV_VARS.filter((key) => !env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Firebase configuration is missing: ${missing.join(', ')}.\n\n` +
        `Copy .env.example to .env in the project root and fill in your ` +
        `Firebase web app's config values (Firebase Console → Project ` +
        `Settings → General → Your apps → SDK setup and configuration), ` +
        `then restart the dev server.`
    );
  }

  return {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  };
}

let cachedApp: FirebaseApp | null = null;

function getFirebaseApp(): FirebaseApp {
  if (!cachedApp) {
    cachedApp = initializeApp(readFirebaseEnvConfig());
  }
  return cachedApp;
}

let cachedFirestore: Firestore | null = null;

export function getFirestoreDb(): Firestore {
  if (!cachedFirestore) {
    cachedFirestore = getFirestore(getFirebaseApp());
  }
  return cachedFirestore;
}

let cachedAuth: Auth | null = null;

export function getFirebaseAuth(): Auth {
  if (!cachedAuth) {
    cachedAuth = getAuth(getFirebaseApp());
  }
  return cachedAuth;
}
