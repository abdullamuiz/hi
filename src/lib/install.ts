/**
 * "Install Hi" across browsers.
 * - Chrome, Edge, Opera, Samsung Internet (desktop + Android): the browser's own prompt,
 *   captured from `beforeinstallprompt` and shown from our button.
 * - Safari on Mac: File → Add to Dock. Safari on iPhone/iPad: Share → Add to Home Screen.
 * - Firefox desktop has no install; Firefox on Android does (menu → Install).
 */
type PromptEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

let deferred: PromptEvent | null = null;
let installedNow = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

/** Call once, as early as possible: the event can fire before the app renders. */
export function captureInstallPrompt() {
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // keep it for our button instead of the browser's mini-bar
    deferred = e as PromptEvent;
    emit();
  });
  addEventListener('appinstalled', () => { deferred = null; installedNow = true; emit(); });
}

export function onInstallChange(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

export type InstallHow =
  | 'installed'     // running as the installed app (or just installed)
  | 'prompt'        // we can show the browser's install dialog
  | 'ios'           // Safari/any browser on iPhone/iPad: Share → Add to Home Screen
  | 'safari-mac'    // Safari 17+ on Mac: File → Add to Dock
  | 'firefox'       // Firefox desktop: not supported
  | 'firefox-android'
  | 'chromium'      // Chrome/Edge without a prompt yet (already installed elsewhere, or still deciding)
  | 'other';

export function installHow(ua = navigator.userAgent, standalone = isStandaloneNow()): InstallHow {
  if (standalone || installedNow) return 'installed';
  if (deferred) return 'prompt';
  const touchMac = /Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1;
  if (/iP(hone|ad|od)/.test(ua) || touchMac) return 'ios';
  if (/Firefox\//.test(ua)) return /Android/.test(ua) ? 'firefox-android' : 'firefox';
  if (/(Chrome|Chromium|Edg|OPR|SamsungBrowser)\//.test(ua)) return 'chromium';
  if (/Macintosh/.test(ua) && /Safari\//.test(ua)) return 'safari-mac';
  return 'other';
}

export function isStandaloneNow() {
  return matchMedia('(display-mode: standalone)').matches
    || matchMedia('(display-mode: window-controls-overlay)').matches
    || (navigator as any).standalone === true;
}

/** Show the browser's install dialog. Resolves true if the person accepted. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const e = deferred;
  deferred = null; // a prompt can only be used once
  await e.prompt();
  const { outcome } = await e.userChoice;
  emit();
  return outcome === 'accepted';
}

/** Plain-language steps for browsers without a prompt. */
export const INSTALL_STEPS: Record<Exclude<InstallHow, 'installed' | 'prompt'>, string> = {
  ios: 'Tap the Share button, then "Add to Home Screen".',
  'safari-mac': 'In Safari\'s menu bar choose File → "Add to Dock".',
  firefox: 'Firefox on computers can\'t install web apps. Open Hi in Chrome, Edge or Safari to install it.',
  'firefox-android': 'Tap the ⋮ menu, then "Install".',
  chromium: 'Click the install icon at the right of the address bar, or open the ⋮ menu → "Cast, save and share" → "Install page as app". (In Edge: ⋯ menu → Apps → "Install this site as an app".)',
  other: 'Look for "Install app" or "Add to Home Screen" in your browser\'s menu.',
};
