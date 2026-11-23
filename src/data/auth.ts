import {
  GoogleAuthProvider, isSignInWithEmailLink, sendSignInLinkToEmail, signInWithEmailLink,
  signInWithPopup, signInWithRedirect, signOut as fbSignOut,
} from 'firebase/auth';
import { auth } from '../firebase';
import { isStandalone } from './push';

const EMAIL_KEY = 'drops.emailForSignIn';

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider);
  } catch (e: any) {
    // Installed apps and strict browsers often block popups: fall back to a redirect.
    if (isStandalone() || ['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/cancelled-popup-request'].includes(e?.code)) {
      await signInWithRedirect(auth, provider);
    } else {
      throw e;
    }
  }
}

export async function sendEmailLink(email: string) {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  await sendSignInLinkToEmail(auth, email, { url: url.toString(), handleCodeInApp: true });
  try { localStorage.setItem(EMAIL_KEY, email); } catch { /* ignore */ }
}

export const looksLikeSignInLink = (link: string) => isSignInWithEmailLink(auth, link);

export function rememberedEmail(): string {
  try { return localStorage.getItem(EMAIL_KEY) || ''; } catch { return ''; }
}

export async function finishEmailLink(email: string, link: string) {
  await signInWithEmailLink(auth, email.trim(), link.trim());
  try { localStorage.removeItem(EMAIL_KEY); } catch { /* ignore */ }
  if (location.search.includes('oobCode')) history.replaceState(null, '', location.pathname);
}

export const signOut = () => fbSignOut(auth);
