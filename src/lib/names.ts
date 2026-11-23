export function firstName(name: string | null | undefined, fallback = 'Friend'): string {
  const n = (name || '').trim();
  if (!n) return fallback;
  if (n.includes('@')) return n.split('@')[0];
  return n.split(/\s+/)[0];
}

export function initial(name: string | null | undefined): string {
  return (firstName(name, '?')[0] || '?').toUpperCase();
}
