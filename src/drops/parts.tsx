import type { ComponentChildren } from 'preact';
import { HiddenCard, useRevealBeat } from './fx';

/** A column of tappable choices (single select). */
export function Options({ items, value, onPick, label, disabled }: {
  items: string[]; value: number | null; onPick(i: number): void; label: string; disabled?: boolean;
}) {
  return (
    <div class="opt-list" role="radiogroup" aria-label={label}>
      {items.map((t, i) => (
        <button type="button" key={i} role="radio" aria-checked={value === i} disabled={disabled}
          class={`opt${value === i ? ' on' : ''}`} onClick={() => onPick(i)}>
          {t}
        </button>
      ))}
    </div>
  );
}

/**
 * Two answer cards side by side; the partner's stays face-down (pulsing) until revealed,
 * then counts 3-2-1 and flips, the first time this phone sees it (`beatKey`).
 */
export function RevealPair({ me, them, partner, revealed, hiddenNote = 'Flips when they lock in', beatKey }: {
  me: ComponentChildren; them: ComponentChildren; partner: string; revealed: boolean; hiddenNote?: string; beatKey?: string;
}) {
  const { count, flip } = useRevealBeat(revealed && !!beatKey, beatKey || '');
  return (
    <div class="reveal-grid">
      <div class={`reveal-card me${flip ? ' flip-in' : ''}`}>
        <div class="reveal-who">You</div>
        <div class="reveal-ans">{me}</div>
      </div>
      {revealed && count == null ? (
        <div class={`reveal-card them${flip ? ' flip-in' : ''}`}>
          <div class="reveal-who">{partner}</div>
          <div class="reveal-ans">{them}</div>
        </div>
      ) : (
        <HiddenCard who={partner} count={count} note={hiddenNote} />
      )}
    </div>
  );
}
