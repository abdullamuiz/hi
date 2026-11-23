import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface OgData {
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k.startsWith('#x')) return safeChar(parseInt(k.slice(2), 16), m);
    if (k.startsWith('#')) return safeChar(parseInt(k.slice(1), 10), m);
    return ENTITIES[k] ?? m;
  });
}
const safeChar = (n: number, fallback: string) => (Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : fallback);

const clean = (s: string | undefined, max: number) => {
  if (!s) return null;
  const t = decodeEntities(s).replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
};

/** Reads Open Graph / Twitter / <title> metadata from the <head> of an HTML page. */
export function parseOpenGraph(html: string, baseUrl: string): OgData {
  const headEnd = html.search(/<\/head\s*>/i);
  const head = html.slice(0, headEnd > 0 ? headEnd : 300_000);
  const meta: Record<string, string> = {};
  for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
    const attrs: Record<string, string> = {};
    for (const a of tag.matchAll(/([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
      attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? '';
    }
    const k = (attrs.property || attrs.name || attrs.itemprop || '').toLowerCase();
    if (k && attrs.content != null && !(k in meta)) meta[k] = attrs.content;
  }
  const titleTag = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];

  let image: string | null = null;
  const rawImg = meta['og:image:secure_url'] || meta['og:image'] || meta['og:image:url'] || meta['twitter:image'] || meta['twitter:image:src'];
  if (rawImg) {
    try {
      const u = new URL(decodeEntities(rawImg.trim()), baseUrl);
      if (u.protocol === 'http:') u.protocol = 'https:'; // the app only shows https images
      if (u.protocol === 'https:') image = u.toString().slice(0, 2048);
    } catch { /* ignore bad URLs */ }
  }

  return {
    title: clean(meta['og:title'] || meta['twitter:title'] || titleTag, 200),
    description: clean(meta['og:description'] || meta['twitter:description'] || meta['description'], 300),
    image,
    siteName: clean(meta['og:site_name'], 60),
  };
}

// ------------------------------------------------------------------ safe fetch

/** True for loopback, private, link-local, CGNAT, multicast and other non-public addresses. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 192 && b === 0)
      || (a === 198 && (b === 18 || b === 19));
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return x === '::' || x === '::1' || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || x.startsWith('ff') || x.startsWith('64:ff9b');
  }
  return true;
}

async function assertPublicUrl(u: URL) {
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('bad protocol');
  if (u.port && u.port !== '80' && u.port !== '443') throw new Error('bad port');
  if (u.username || u.password) throw new Error('credentials in URL');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error('non-public address');
}

const MAX_BYTES = 600_000;

/** Fetches a page (public hosts only, ≤4 redirects, ≤600 KB, 6 s) and returns its Open Graph data. */
export async function fetchPreview(url: string, fetchImpl: typeof fetch = fetch): Promise<OgData & { finalUrl: string }> {
  let current = new URL(url);
  for (let hop = 0; hop < 5; hop++) {
    await assertPublicUrl(current);
    const res = await fetchImpl(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(6000),
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; DropsChatLinkPreview/1.0)',
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        'accept-language': 'en',
      },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error('redirect without location');
      current = new URL(loc, current);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get('content-type') || '';
    if (!/html/i.test(type)) throw new Error(`not html: ${type}`);
    const html = await readCapped(res, MAX_BYTES);
    return { ...parseOpenGraph(html, current.toString()), finalUrl: current.toString() };
  }
  throw new Error('too many redirects');
}

async function readCapped(res: Response, max: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < max) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  reader.cancel().catch(() => {});
  return new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks).subarray(0, max));
}
