/** Watch list / Music items: what the server fills in, and the quiet "added" push. Pure. */

export interface Og { title: string | null; description: string | null; image: string | null; siteName: string | null }

/** Fields to write on the item once the page's preview is in. Keeps a YouTube thumbnail if the page had none. */
export function mediaPatch(item: { title?: string; image?: string | null }, og: Og | null): Record<string, unknown> {
  if (!og) return { preview: 'failed' };
  const patch: Record<string, unknown> = { preview: 'ok' };
  const title = og.title && cleanTitle(og.title);
  if (title) patch.title = title.slice(0, 200);
  if (og.image) patch.image = og.image.slice(0, 2048);
  else if (item.image) patch.image = item.image;
  if (og.siteName) patch.siteName = og.siteName.slice(0, 80);
  if (og.description) patch.description = og.description.slice(0, 300);
  return patch;
}

/** "Stranger Things | Netflix Official Site" → "Stranger Things"; "Song - song by X | Spotify" → "Song - song by X". */
export function cleanTitle(t: string): string {
  return t
    .replace(/\s*[|–-]\s*(Netflix( Official Site)?|Prime Video|Amazon\.[a-z.]+|Disney\+|YouTube|Spotify|Apple Music)\s*$/i, '')
    .replace(/^Watch\s+/i, '')
    .trim() || t.trim();
}

export function mediaPushBody(name: string, title: string, kind: 'watch' | 'music'): string {
  const first = String(name || 'Hi').split(/\s+/)[0];
  const what = title && title.length <= 80 ? title : 'something';
  return kind === 'music' ? `${first} added ${what} to your Music` : `${first} added ${what} to your Watch list`;
}
