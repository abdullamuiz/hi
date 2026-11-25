/** Opens the Devices panel from anywhere (Settings, a new sign-in notification). */
type State = { open: boolean; focus: string | null };
let state: State = { open: false, focus: null };
const subs = new Set<(s: State) => void>();

export function openDevices(focus: string | null = null) { state = { open: true, focus }; subs.forEach((f) => f(state)); }
export function closeDevices() { state = { open: false, focus: null }; subs.forEach((f) => f(state)); }
export function onDevicesUi(f: (s: State) => void) { subs.add(f); f(state); return () => { subs.delete(f); }; }
