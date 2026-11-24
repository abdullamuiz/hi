import type { MoodId } from '../types';

type P = { size?: number };
const base = { 'aria-hidden': true, fill: 'none', viewBox: '0 0 24 24', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } as const;

/** The "Hi" speech-bubble logo: teal in light mode, navy in dark mode (CSS picks one). */
export const Logo = ({ size = 48 }: P) => (
  <span class="logo" aria-hidden="true">
    <img class="logo-light" src="./icons/bubble-teal.svg" width={size} height={size} alt="" />
    <img class="logo-dark" src="./icons/bubble-navy.svg" width={size} height={size} alt="" />
  </span>
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

/**
 * Mood weather as faces: a smiling sun, a "meh" cloud, a sleepy fog blob and a
 * frustrated storm cloud. Colours come from the theme (--sun, --cloud, --storm).
 */
export function MoodIcon({ mood, size = 22 }: { mood: MoodId; size?: number }) {
  const common = { 'aria-hidden': true as const, width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'stroke-width': 1.7, 'stroke-linecap': 'round' as const, 'stroke-linejoin': 'round' as const };
  switch (mood) {
    case 'sunny': {
      const c = 'var(--sun)';
      return (
        <svg {...common} style={{ stroke: c }}>
          <circle cx="12" cy="12" r="5.6" />
          <path d="M12 1.8v2.2M12 20v2.2M4.8 4.8l1.5 1.5M17.7 17.7l1.5 1.5M1.8 12H4M20 12h2.2M4.8 19.2l1.5-1.5M17.7 6.3l1.5-1.5" />
          <circle cx="10" cy="11" r="0.95" style={{ fill: c, stroke: 'none' }} />
          <circle cx="14" cy="11" r="0.95" style={{ fill: c, stroke: 'none' }} />
          <path d="M9.6 13.4q2.4 2.5 4.8 0" />
        </svg>
      );
    }
    case 'cloudy': {
      const c = 'var(--cloud)';
      return (
        <svg {...common} style={{ stroke: c }}>
          <path d="M6.8 19.5h10.4a4.3 4.3 0 0 0 .5-8.57A6 6 0 0 0 6.3 9.6a4.96 4.96 0 0 0 .5 9.9z" />
          <circle cx="10" cy="14" r="0.95" style={{ fill: c, stroke: 'none' }} />
          <circle cx="14.2" cy="14" r="0.95" style={{ fill: c, stroke: 'none' }} />
          <path d="M10.2 16.8h3.8" />
        </svg>
      );
    }
    case 'foggy': {
      const c = 'var(--cloud)';
      // A soft fog "ghost" with a wavy hem, sleepy closed eyes, a little yawn and a z.
      return (
        <svg {...common} style={{ stroke: c }}>
          <path d="M5 16.2V12a7 7 0 0 1 14 0v4.2c-1.17 1-2.33 1-3.5 0s-2.33-1-3.5 0-2.33 1-3.5 0-2.33-1-3.5 0z" />
          <path d="M8.2 10.6c.7.9 2 .9 2.7 0M13.1 10.6c.7.9 2 .9 2.7 0" stroke-width="1.4" />
          <circle cx="12" cy="13.5" r="0.8" style={{ fill: c, stroke: 'none' }} />
          <path d="M8 20.3h8" />
          <path d="M18.3 2.6h2.2l-2.2 2.4h2.2" stroke-width="1.3" />
        </svg>
      );
    }
    case 'stormy': {
      const c = 'var(--storm)';
      return (
        <svg {...common} style={{ stroke: c }}>
          <path d="M7 15.2h10.6a3.6 3.6 0 0 0 .3-7.18A6 6 0 0 0 6.6 6.4 4.4 4.4 0 0 0 7 15.2z" />
          <path d="M8.6 8.5l2 .9M15.6 8.5l-2 .9" />
          <circle cx="10.1" cy="10.7" r="0.9" style={{ fill: c, stroke: 'none' }} />
          <circle cx="14.1" cy="10.7" r="0.9" style={{ fill: c, stroke: 'none' }} />
          <path d="M10.2 13.3q1.9-1.3 3.8 0" />
          <path d="M12.8 16.6l-2 3h2.6l-1.6 2.9" />
        </svg>
      );
    }
  }
}

export const SettingsIcon = ({ size = 20 }: P) => (
  <svg {...base} width={size} height={size} stroke="currentColor" stroke-width="2">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);

export const MOODS: { id: MoodId; label: string; desc: string }[] = [
  { id: 'sunny', label: 'Sunny', desc: 'Good day, up for anything' },
  { id: 'cloudy', label: 'Cloudy', desc: 'A bit meh' },
  { id: 'foggy', label: 'Foggy', desc: 'Tired, replies will be slow' },
  { id: 'stormy', label: 'Stormy', desc: 'Rough day, be gentle' },
];
