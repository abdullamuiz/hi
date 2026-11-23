import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { applyTheme, currentTheme, isThemeId, type ThemeId } from '../lib/themes';

/** Pull this person's saved theme (from another device) and apply it. */
export async function syncThemeFromAccount(uid: string) {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    const t = snap.data()?.theme;
    if (isThemeId(t) && t !== currentTheme()) applyTheme(t);
  } catch { /* offline or not yet created: keep the local choice */ }
}

export function chooseTheme(uid: string, id: ThemeId) {
  applyTheme(id);
  return setDoc(doc(db, 'users', uid), { theme: id }, { merge: true }).catch(() => {});
}
