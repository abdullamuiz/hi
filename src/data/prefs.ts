import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { applyTheme, currentPrefs, normalisePrefs, type ThemePrefs } from '../lib/themes';

// Bumped whenever the person picks a theme here, so a slower download of the saved
// theme can't undo a choice made while it was loading.
let localChanges = 0;

/** Pull this person's saved theme (from another device) and apply it. */
export async function syncThemeFromAccount(uid: string) {
  const startedAt = localChanges;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (localChanges !== startedAt) return;
    const t = normalisePrefs(snap.data()?.theme);
    const c = currentPrefs();
    if (t && (t.palette !== c.palette || t.mode !== c.mode)) applyTheme(t);
  } catch { /* offline or not yet created: keep the local choice */ }
}

export function chooseTheme(uid: string, prefs: ThemePrefs) {
  localChanges++;
  applyTheme(prefs);
  return setDoc(doc(db, 'users', uid), { theme: prefs }, { merge: true }).catch(() => {});
}
