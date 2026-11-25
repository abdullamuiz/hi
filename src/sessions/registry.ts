import type { SessionTest } from './types';
import { validateTest } from './logic';

// Every JSON file in ./tests is a Session test. Add a file → it's in the tray.
const files = import.meta.glob<{ default: SessionTest }>('./tests/*.json', { eager: true });

export const allTests: SessionTest[] = Object.entries(files)
  .map(([file, m]) => {
    const t = m.default;
    const errors = validateTest(t, file);
    if (errors.length) throw new Error(errors.join('\n'));
    return t;
  })
  .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.title.localeCompare(b.title));

const byId = new Map(allTests.map((t) => [t.id, t]));
if (byId.size !== allTests.length) throw new Error('Two Session tests share the same "id"');

export const getTest = (id: string) => byId.get(id);

/** Tests offered in the tray. Dev-only tests need `localStorage["hi.sessions.dev"] = "1"`. */
export function trayTests(): SessionTest[] {
  let dev = false;
  try { dev = localStorage.getItem('hi.sessions.dev') === '1'; } catch { /* ignore */ }
  return allTests.filter((t) => !t.dev || dev);
}
