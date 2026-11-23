import type { DropDefinition } from './types';

// Every `*.drop.tsx` file in this folder is a Drop. Add a file → it's in the tray.
const modules = import.meta.glob<{ default: DropDefinition<any> }>('./*.drop.tsx', { eager: true });

const TYPE_RE = /^[a-z0-9-]{1,40}$/;

export const drops: DropDefinition<any>[] = Object.entries(modules)
  .map(([file, m]) => {
    const d = m.default;
    if (!d || !TYPE_RE.test(d.type)) throw new Error(`${file}: Drop needs a default export with a lowercase "type"`);
    return d;
  })
  .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.title.localeCompare(b.title));

const byType = new Map(drops.map((d) => [d.type, d]));
if (byType.size !== drops.length) throw new Error('Two Drops share the same "type"');

export function getDrop(type: string): DropDefinition<any> | undefined {
  return byType.get(type);
}

/** Fill missing content keys from the definition's defaults (forward-compatible). */
export function withDefaults<C extends Record<string, unknown>>(def: DropDefinition<C>, content: Record<string, unknown> | undefined): C {
  return { ...def.content, ...(content || {}) } as C;
}
