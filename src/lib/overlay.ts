/**
 * Full-screen overlays (the photo viewer) that the phone's back gesture should close
 * without leaving the chat. Opening one adds a history entry; going back closes it.
 */
const stack: Array<() => void> = [];

export function openOverlay(close: () => void) {
  stack.push(close);
  try { history.pushState({ ...(history.state || {}), hiOverlay: stack.length }, '', location.href); } catch { /* ignore */ }
}

/** Close the top overlay (from a button): goes back, which runs its close. */
export function closeOverlay() {
  if (!stack.length) return;
  if (history.state?.hiOverlay) history.back();
  else stack.pop()?.();
}

/** Call first in popstate handlers: true when the back gesture closed an overlay. */
export function handleOverlayPop(): boolean {
  const close = stack.pop();
  if (!close) return false;
  close();
  return true;
}

/** An overlay unmounted some other way: forget it (and its history entry stays harmlessly). */
export function forgetOverlay(close: () => void) {
  const i = stack.lastIndexOf(close);
  if (i >= 0) stack.splice(i, 1);
}
