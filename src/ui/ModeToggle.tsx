import { useEffect, useState } from 'preact/hooks';
import { applyTheme, currentMode, onThemeChange, toggledPrefs, type Mode } from '../lib/themes';
import { chooseTheme } from '../data/prefs';

/** Moon / half-circle button: switches the current palette between its light and dark version. */
export function ModeToggle({ uid, class: cls = 'icon-btn' }: { uid?: string; class?: string }) {
  const [mode, setMode] = useState<Mode>(currentMode);
  useEffect(() => onThemeChange((_id, m) => setMode(m)), []);
  const dark = mode === 'dark';

  const toggle = () => {
    const next = toggledPrefs();
    if (uid) chooseTheme(uid, next); else applyTheme(next);
  };

  return (
    <button type="button" class={cls} onClick={toggle} aria-pressed={dark}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title={dark ? 'Light mode' : 'Dark mode'}>
      {dark ? (
        // Half-filled circle: "switch back to light" (a sun would clash with the Sunny mood icon).
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="8.5" /><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none" />
        </svg>
      ) : (
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" />
        </svg>
      )}
    </button>
  );
}
