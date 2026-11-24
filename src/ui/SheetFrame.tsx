import { useEffect } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

/** Bottom sheet with a scrim. Escape or tapping outside closes it. */
export function SheetFrame({ onClose, label, children }: { onClose(): void; label?: string; children: ComponentChildren }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div class="sheet-wrap">
      <button type="button" class="scrim" onClick={onClose} aria-label="Close" />
      <div class="sheet" role="dialog" aria-modal="true" aria-label={label}>{children}</div>
    </div>
  );
}
