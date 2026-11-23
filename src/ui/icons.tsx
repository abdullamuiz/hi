import type { MoodId } from '../types';

type P = { size?: number };
const base = { 'aria-hidden': true, fill: 'none', viewBox: '0 0 24 24', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } as const;

/** The "Hi" speech-bubble logo (public/icons/logo.svg). */
export const Logo = ({ size = 48 }: P) => (
  <img src="./icons/logo.svg" width={size} height={size} alt="" aria-hidden="true" style={{ display: 'block' }} />
);
export const DropIcon = ({ size = 18, color = 'currentColor' }: P & { color?: string }) => (
  <svg {...base} width={size} height={size} stroke={color} stroke-width="2"><path d="M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z" /></svg>
);
export const BookmarkIcon = ({ size = 20 }: P) => (
  <svg {...base} width={size} height={size} stroke="currentColor" stroke-width="2"><path d="M6 3h12v18l-6-4-6 4z" /></svg>
);
export const PlusIcon = () => (
  <svg {...base} width="20" height="20" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14" /></svg>
);
export const PhotoIcon = () => (
  <svg {...base} width="20" height="20" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.8" /><path d="M21 16l-5-5-8 8" /></svg>
);
export const SendIcon = () => (
  <svg {...base} width="20" height="20" stroke="currentColor" stroke-width="2.2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);
export const CloseIcon = () => (
  <svg {...base} width="18" height="18" stroke="#FFFFFF" stroke-width="2.2"><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const PlayIcon = () => (
  <svg aria-hidden="true" width="52" height="52" viewBox="0 0 52 52"><circle cx="26" cy="26" r="25" fill="#FFFFFF" fill-opacity="0.16" /><path d="M21 16l16 10-16 10z" fill="#FFFFFF" /></svg>
);
export const LinkIcon = () => (
  <svg {...base} width="40" height="40" stroke="#FFFFFF" stroke-width="1.8"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" /><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" /></svg>
);
export const GoogleIcon = () => (
  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
);

export function MoodIcon({ mood, size = 22 }: { mood: MoodId; size?: number }) {
  switch (mood) {
    case 'sunny':
      return <svg {...base} width={size} height={size} style={{ stroke: 'var(--sun)' }} stroke-width="2"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
    case 'cloudy':
      return <svg {...base} width={size} height={size} style={{ stroke: 'var(--cloud)' }} stroke-width="2"><path d="M7 18h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3.5 3.5 0 0 0 7 18z" /></svg>;
    case 'foggy':
      return <svg {...base} width={size} height={size} style={{ stroke: 'var(--cloud)' }} stroke-width="2"><path d="M4 9h16M6 13h12M4 17h16" /></svg>;
    case 'stormy':
      return <svg {...base} width={size} height={size} style={{ stroke: 'var(--storm)' }} stroke-width="2"><path d="M7 15a4 4 0 0 1 .5-8A6 6 0 0 1 19 9a3.5 3.5 0 0 1-1 6.9" /><path d="M13 12l-3 5h4l-3 5" /></svg>;
  }
}

export const MOODS: { id: MoodId; label: string; desc: string }[] = [
  { id: 'sunny', label: 'Sunny', desc: 'Good day, up for anything' },
  { id: 'cloudy', label: 'Cloudy', desc: 'A bit meh' },
  { id: 'foggy', label: 'Foggy', desc: 'Tired, replies will be slow' },
  { id: 'stormy', label: 'Stormy', desc: 'Rough day, be gentle' },
];
