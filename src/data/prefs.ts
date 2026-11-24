import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { applyTheme, currentPrefs, normalisePrefs, type ThemePrefs } from '../lib/themes';

/** Pull this person's saved theme (from another device) and apply it. */
export async function syncThemeFromAccount(uid: string) {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    const t = normalisePrefs(snap.data()?.theme);
    const c = currentPrefs();
    if (t && (t.palette !== c.palette || t.mode !== c.mode)) applyTheme(t);
  } catch { /* offline or not yet created: keep the local choice */ }
}

export function chooseTheme(uid: string, prefs: ThemePrefs) {
  applyTheme(prefs);
  return setDoc(doc(db, 'users', uid), { theme: prefs }, { merge: true }).catch(() => {});
}
