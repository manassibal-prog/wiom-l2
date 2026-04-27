import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { auth, getUser } from './db.js';
import { CONFIG } from './config.js';

export let currentUser = null;

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ hd: CONFIG.ALLOWED_DOMAIN });

export async function signIn() {
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

export async function signOutUser() {
  currentUser = null;
  await signOut(auth);
}

export function onAuthReady(callback) {
  return onAuthStateChanged(auth, async firebaseUser => {
    if (!firebaseUser) {
      currentUser = null;
      callback(null);
      return;
    }

    const email = firebaseUser.email;
    if (!email.endsWith(`@${CONFIG.ALLOWED_DOMAIN}`)) {
      await signOut(auth);
      callback(null, "unauthorized_domain");
      return;
    }

    const userDoc = await getUser(email);
    if (!userDoc || !userDoc.active) {
      await signOut(auth);
      callback(null, "no_user_doc");
      return;
    }

    currentUser = { email, ...userDoc };
    callback(currentUser);
  });
}
