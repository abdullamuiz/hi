/**
 * Update checks for the installed app, which has no address bar or reload button.
 * dist/version.json holds the id of the latest published build; if it differs from
 * the build we're running, a newer version is available.
 */
export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

export async function newerVersionAvailable(): Promise<boolean> {
  if (import.meta.env.DEV) return false;
  try {
    const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return false;
    const { build } = await res.json();
    return typeof build === 'string' && build !== BUILD_ID;
  } catch {
    return false; // offline
  }
}

/** Check now, whenever the app comes back to the foreground, and every 15 minutes. */
export function watchForUpdates(onUpdate: () => void): () => void {
  let done = false;
  const check = async () => {
    if (done || document.visibilityState !== 'visible') return;
    if (await newerVersionAvailable()) { done = true; onUpdate(); }
  };
  check();
  const t = setInterval(check, 15 * 60_000);
  document.addEventListener('visibilitychange', check);
  addEventListener('online', check);
  return () => { clearInterval(t); document.removeEventListener('visibilitychange', check); removeEventListener('online', check); };
}

/** Fetch the new service worker (if any) and reload onto the latest version. */
export async function reloadApp() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
  } catch { /* ignore */ }
  location.reload();
}

/** e.g. "24 Nov, 09:14" for Settings. */
export function buildLabel(): string {
  const d = new Date(BUILD_ID);
  return isNaN(+d) ? BUILD_ID : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
