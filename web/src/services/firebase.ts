import { initializeApp } from "firebase/app";
import {
  initializeAuth,
  browserPopupRedirectResolver,
  GoogleAuthProvider,
  inMemoryPersistence,
  setPersistence,
  signInWithPopup,
  signOut,
  reauthenticateWithPopup,
  deleteUser,
} from "firebase/auth";
import {
  getFirestore,
  memoryLocalCache,
  initializeFirestore,
} from "firebase/firestore";
const values = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};
const supplied = Object.values(values).every(Boolean);
const partial = Object.values(values).some(Boolean) && !supplied;
function initialize() {
  if (!supplied) return null;
  try {
    const app = initializeApp(values);
    const auth = initializeAuth(app, {
      persistence: inMemoryPersistence,
      popupRedirectResolver: browserPopupRedirectResolver,
    });
    initializeFirestore(app, { localCache: memoryLocalCache() });
    return { auth, db: getFirestore(app) };
  } catch {
    return null;
  } // Fail closed to labeled demo, never expose configuration/error payloads.
}
const services = initialize();
export const configError = partial || (supplied && !services);
export const configured = services !== null;
export const auth = services?.auth ?? null;
export const db = services?.db ?? null;
const provider = () => {
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ prompt: "select_account" });
  return p;
};
export async function login() {
  if (!auth) throw new Error("Firebase is not configured");
  await setPersistence(auth, inMemoryPersistence);
  await signInWithPopup(auth, provider());
}
export async function logout() {
  if (auth) await signOut(auth);
}
export async function confirmIdentity() {
  if (!auth?.currentUser) throw new Error("Sign in first");
  await reauthenticateWithPopup(auth.currentUser, provider());
}
export async function removeAuthAccount() {
  if (!auth?.currentUser) throw new Error("Sign in first");
  await deleteUser(auth.currentUser);
}
