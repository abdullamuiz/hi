/** Opening-screen preference. Kept on this device only, because index.html reads it before the app loads. */
export type SplashStyle = 'animated' | 'still';

const KEY = 'hi.splash';

export function splashStyle(): SplashStyle {
  try { return localStorage.getItem(KEY) === 'still' ? 'still' : 'animated'; } catch { return 'animated'; }
}

export function setSplashStyle(style: SplashStyle) {
  try {
    if (style === 'still') localStorage.setItem(KEY, 'still');
    else localStorage.removeItem(KEY);
  } catch { /* private mode: falls back to animated */ }
}

/** Tell the opening screen (index.html) the app has something to show. */
export function splashReady() {
  (window as unknown as { __hiReady?: () => void }).__hiReady?.();
}
