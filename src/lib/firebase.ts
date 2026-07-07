import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAnalytics, isSupported, type Analytics } from "firebase/analytics";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID as string | undefined,
};

const requiredConfig = {
  apiKey: firebaseConfig.apiKey,
  authDomain: firebaseConfig.authDomain,
  projectId: firebaseConfig.projectId,
  storageBucket: firebaseConfig.storageBucket,
  messagingSenderId: firebaseConfig.messagingSenderId,
  appId: firebaseConfig.appId,
};

export const isFirebaseConfigured = Object.values(requiredConfig).every(Boolean);

let app: FirebaseApp | null = null;
let analyticsPromise: Promise<Analytics | null> | null = null;

if (isFirebaseConfigured) {
  app = initializeApp(firebaseConfig);
}

export function getFirebaseApp() {
  if (!app) {
    throw new Error("Firebase is not configured. Copy .env.example to .env.local and add your Firebase web app config.");
  }

  return app;
}

export const auth = isFirebaseConfigured ? getAuth(getFirebaseApp()) : null;
export const db = isFirebaseConfigured ? getFirestore(getFirebaseApp()) : null;
export const storage = isFirebaseConfigured ? getStorage(getFirebaseApp()) : null;

export function getFirebaseAnalytics() {
  if (!isFirebaseConfigured || !firebaseConfig.measurementId) {
    return Promise.resolve(null);
  }

  analyticsPromise ??= isSupported().then((supported) => (supported ? getAnalytics(getFirebaseApp()) : null));
  return analyticsPromise;
}
