import type { ComponentChildren } from 'preact';

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

/** Two answer cards side by side; the partner's stays face-down until revealed. */
export function RevealPair({ me, them, partner, revealed, hiddenNote = 'Flips when they lock in' }: {
  me: ComponentChildren; them: ComponentChildren; partner: string; revealed: boolean; hiddenNote?: string;
}) {
  return (
    <div class="reveal-grid">
      <div class="reveal-card me">
        <div class="reveal-who">You</div>
        <div class="reveal-ans">{me}</div>
      </div>
      {revealed ? (
        <div class="reveal-card them">
          <div class="reveal-who">{partner}</div>
          <div class="reveal-ans">{them}</div>
        </div>
      ) : (
        <div class="reveal-card hidden">
          <div class="reveal-who">{partner}</div>
          <div class="reveal-ans" aria-label="Hidden">?</div>
          <div style={{ fontSize: '12px' }}>{hiddenNote}</div>
        </div>
      )}
    </div>
  );
}
