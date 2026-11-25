import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { closeOverlay, forgetOverlay, openOverlay } from '../lib/overlay';
import { photoURL } from '../data/photos';
import { evictMedia } from '../lib/mediaCache';
import type { Message } from '../types';
import { CloseIcon, LinkIcon, PlayIcon } from './icons';

export function LinkCard({ msg, onFeel }: { msg: Message; onFeel?: () => void }) {
  const l = msg.link!;
  const title = l.title || (l.status === 'pending' ? `${l.isVideo ? 'Video' : 'Page'} on ${l.domain}` : l.url);
  const desc = msg.text || l.description || (l.status === 'pending' ? 'Loading preview…' : '');
  const img = l.image && /^https:\/\//.test(l.image) ? l.image : null;
  return (
    <div class="link-card" data-status={l.status}>
      <a href={l.url} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden="true"
        class={`link-media${img ? ' has-img' : ''}`} style={img ? { backgroundImage: `url("${img.replace(/"/g, '%22')}")` } : undefined}>
        {l.isVideo ? <PlayIcon /> : !img && <LinkIcon />}
      </a>
      <div class="link-body">
        <div class="link-domain">{l.siteName || l.domain}</div>
        <a href={l.url} target="_blank" rel="noopener noreferrer" class="link-title">{title}</a>
        {desc && <div class="link-desc">{desc}</div>}
        {l.isVideo && onFeel && <button type="button" class="btn-soft" onClick={onFeel}>Watched it? Start a Feeling Map</button>}
      </div>
    </div>
  );
}

/**
 * A photo's address: from the device cache when we have it. `fallback` is tried when
 * `path` can't be loaded (e.g. a thumbnail that older photos don't have). A cached
 * address that stopped working is forgotten and fetched again.
 */
export function usePhoto(path: string | undefined, fallback?: string) {
  const [url, setUrl] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (!path) return;
    photoURL(path)
      .catch((e) => (fallback && fallback !== path ? photoURL(fallback) : Promise.reject(e)))
      .then((u) => live && setUrl(u))
      .catch(() => {});
    return () => { live = false; };
  }, [path, fallback, retry]);
  const broken = () => {
    if (retry > 1) return;
    void evictMedia([path, fallback]).then(() => setRetry((r) => r + 1));
  };
  return { url, broken };
}

/** Bubble height for a photo: 240px wide, height follows the photo within sensible bounds. */
const bubbleHeight = (p: { width: number; height: number }) => Math.round(Math.max(140, Math.min(320, (240 * p.height) / Math.max(1, p.width))));

export function PhotoBubble({ msg, mine, onView }: { msg: Message; mine: boolean; onView(): void }) {
  const p = msg.photo!;
  const { url, broken } = usePhoto(p.thumbPath || p.path, p.path);
  return (
    <div class="photo-wrap">
      <button type="button" class="photo-btn" style={{ height: `${bubbleHeight(p)}px` }} onClick={onView} aria-label="View photo full screen">
        {url ? <img src={url} alt={msg.text || 'Photo'} loading="lazy" decoding="async" onError={broken} /> : <span class="uploading">Loading…</span>}
      </button>
      {msg.text && <div class="caption" style={{ textAlign: mine ? 'right' : 'left' }}>{msg.text}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------- view once

/** How many views are left for the recipient. */
export const viewsLeft = (m: Pick<Message, 'viewLimit' | 'viewCount' | 'photo'>) =>
  !m.photo?.path ? 0 : Math.max(0, (m.viewLimit || 0) - (m.viewCount || 0));

/** A view-once / view-twice photo in the chat: never shows the picture itself. */
export function OnceBubble({ msg, mine, onOpen }: { msg: Message; mine: boolean; onOpen(): void }) {
  const left = viewsLeft(msg);
  const kind = msg.viewLimit === 2 ? 'twice' : 'once';
  const label = mine
    ? (msg.viewCount ? (left ? `Opened ${msg.viewCount} of 2` : 'Opened') : 'Delivered')
    : (left ? `Tap to view (${left === 2 ? 'twice' : 'once'})` : 'Opened');
  const icon = msg.viewLimit === 2 ? '②' : '①';
  return (
    <button type="button" class={`once-bubble${left && !mine ? ' ready' : ''}`} disabled={mine || !left}
      onClick={onOpen} aria-label={`View-${kind} photo · ${label}`}>
      <span class="once-icon" aria-hidden="true">{icon}</span>
      <span class="once-text">
        <span class="once-title">📷 Photo</span>
        <span class="once-sub">{label}</span>
      </span>
    </button>
  );
}

/**
 * Full screen for a view-once / view-twice photo. The picture is loaded first, then one
 * view is counted, and only then shown, so closing the app half way can't win an extra
 * look. No save, share, pin or zoom; it can't stop screenshots, and says so.
 */
export function OnceViewer({ msg, from, onCount, onClose }: { msg: Message; from: string; onCount(): Promise<void>; onClose(): void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [firstTime] = useState(() => { try { return !localStorage.getItem('hi.once.seen'); } catch { return false; } });

  useLayoutEffect(() => {
    const close = () => closeRef.current();
    openOverlay(close);
    return () => forgetOverlay(close);
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const u = await photoURL(msg.photo!.path!);
        const img = new Image();
        img.src = u;
        await img.decode();
        await onCount();
        if (live) setUrl(u);
        try { localStorage.setItem('hi.once.seen', '1'); } catch { /* ignore */ }
      } catch {
        if (live) setErr('This photo can’t be opened any more.');
      }
    })();
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') closeOverlay(); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);

  return (
    <div class="viewer once-viewer" role="dialog" aria-modal="true" aria-label={`View-${msg.viewLimit === 2 ? 'twice' : 'once'} photo from ${from}`}
      onContextMenu={(e) => e.preventDefault()}>
      <div class="viewer-top">
        <div class="viewer-from"><span>{from}</span><span class="viewer-when">{msg.viewLimit === 2 ? 'View twice' : 'View once'}</span></div>
        <button type="button" class="viewer-x" onClick={() => closeOverlay()} aria-label="Close photo"><CloseIcon /></button>
      </div>
      <div class="viewer-img">
        {url && <img src={url} alt="View-once photo" draggable={false} class="once-img" />}
        {!url && !err && <span class="uploading">Opening…</span>}
        {err && <span class="uploading">{err}</span>}
      </div>
      {firstTime && <div class="viewer-bottom"><div class="viewer-cap once-hint">View once — can’t be saved. Screenshots can’t be blocked.</div></div>}
    </div>
  );
}

interface ViewerProps {
  /** Every photo in the open chat, oldest first. */
  photos: Message[];
  startId: string;
  nameOf(uid: string): string;
  isPinned(id: string): boolean;
  onPin(m: Message): void;
  onClose(): void;
}

const MAX_ZOOM = 4;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const when = (m: Message) => (m.createdAt ? m.createdAt.toDate().toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');

/**
 * Full-screen photos: pinch or double-tap to zoom, drag to pan, swipe down to close,
 * swipe sideways for the chat's other photos. Escape and the back gesture close it.
 */
export function PhotoViewer({ photos, startId, nameOf, isPinned, onPin, onClose }: ViewerProps) {
  const [index, setIndex] = useState(() => Math.max(0, photos.findIndex((p) => p.id === startId)));
  const msg = photos[Math.min(index, photos.length - 1)];
  const { url } = usePhoto(msg?.photo?.path);
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const [drag, setDrag] = useState({ dx: 0, dy: 0, active: false });
  const [note, setNote] = useState('');
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: 'none' | 'pan' | 'swipe' | 'pinch'; sx: number; sy: number; base: { s: number; x: number; y: number }; dist: number; mid: { x: number; y: number } }>({
    kind: 'none', sx: 0, sy: 0, base: { s: 1, x: 0, y: 0 }, dist: 0, mid: { x: 0, y: 0 },
  });
  const lastTap = useRef(0);
  const stage = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // The back gesture closes the viewer, not the chat. (Registered before paint, so even an
  // instant back press closes the viewer.)
  useLayoutEffect(() => {
    const close = () => closeRef.current();
    openOverlay(close);
    return () => forgetOverlay(close);
  }, []);
  const close = () => closeOverlay();

  const go = (d: number) => {
    setIndex((i) => clamp(i + d, 0, photos.length - 1));
    setView({ s: 1, x: 0, y: 0 });
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [photos.length]);

  useEffect(() => { if (!msg) onClose(); }, [msg]);
  if (!msg || !msg.photo) return null;

  const zoomAt = (s: number, cx: number, cy: number, base = view) => {
    const r = stage.current?.getBoundingClientRect();
    const ox = cx - (r ? r.left + r.width / 2 : 0);
    const oy = cy - (r ? r.top + r.height / 2 : 0);
    const ns = clamp(s, 1, MAX_ZOOM);
    if (ns === 1) return setView({ s: 1, x: 0, y: 0 });
    // Keep the point under the finger in place.
    const k = ns / base.s;
    setView({ s: ns, x: ox - (ox - base.x) * k, y: oy - (oy - base.y) * k });
  };

  const down = (e: PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    const g = gesture.current;
    if (pts.length === 2) {
      g.kind = 'pinch';
      g.dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      g.mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      g.base = view;
      setDrag({ dx: 0, dy: 0, active: false });
      return;
    }
    g.kind = view.s > 1 ? 'pan' : 'swipe';
    g.sx = e.clientX;
    g.sy = e.clientY;
    g.base = view;
  };

  const move = (e: PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (g.kind === 'pinch') {
      const pts = [...pointers.current.values()];
      if (pts.length < 2) return;
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      zoomAt(g.base.s * (d / g.dist), g.mid.x, g.mid.y, g.base);
    } else if (g.kind === 'pan') {
      setView({ s: g.base.s, x: g.base.x + (e.clientX - g.sx), y: g.base.y + (e.clientY - g.sy) });
    } else if (g.kind === 'swipe') {
      setDrag({ dx: e.clientX - g.sx, dy: e.clientY - g.sy, active: true });
    }
  };

  const up = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g.kind === 'pinch') {
      if (pointers.current.size === 0) g.kind = 'none';
      else { g.kind = 'pan'; const p = [...pointers.current.values()][0]; g.sx = p.x; g.sy = p.y; g.base = view; }
      return;
    }
    if (g.kind === 'swipe') {
      const dx = e.clientX - g.sx;
      const dy = e.clientY - g.sy;
      setDrag({ dx: 0, dy: 0, active: false });
      g.kind = 'none';
      if (dy > 110 && Math.abs(dy) > Math.abs(dx)) return close();
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy)) return go(dx < 0 ? 1 : -1);
      // A tap: two quick taps zoom in (or back out).
      if (Math.hypot(dx, dy) < 10) {
        const now = Date.now();
        if (now - lastTap.current < 300) { lastTap.current = 0; zoomAt(view.s > 1 ? 1 : 2.5, e.clientX, e.clientY); }
        else lastTap.current = now;
      }
      return;
    }
    if (g.kind === 'pan') {
      g.kind = 'none';
      const now = Date.now();
      if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 10) {
        if (now - lastTap.current < 300) { lastTap.current = 0; setView({ s: 1, x: 0, y: 0 }); }
        else lastTap.current = now;
      }
    }
  };

  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    zoomAt(view.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY);
  };

  const save = async () => {
    if (!url) return;
    const name = `hi-photo-${msg.id}.jpg`;
    try {
      const blob = await (await fetch(url)).blob();
      const file = new File([blob], name, { type: blob.type || 'image/jpeg' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Photo' });
        return;
      }
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
      setNote('Saved');
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      window.open(url, '_blank', 'noopener');
    }
    setTimeout(() => setNote(''), 1800);
  };

  const fade = drag.active ? Math.max(0.35, 1 - Math.abs(drag.dy) / 400) : 1;
  const imgStyle = drag.active
    ? { transform: `translate(${drag.dx}px, ${Math.max(0, drag.dy)}px)`, transition: 'none' }
    : { transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`, transition: gesture.current.kind === 'none' ? 'transform .18s ease-out' : 'none' };
  const pinned = isPinned(msg.id);
  const from = nameOf(msg.uid);

  return (
    <div class="viewer" role="dialog" aria-modal="true" aria-label={`Photo from ${from}`}
      style={drag.active ? { background: `rgba(10, 12, 18, ${fade})` } : undefined}>
      <div class="viewer-top">
        <div class="viewer-from">
          <span>{from}</span>
          <span class="viewer-when">{[when(msg), photos.length > 1 ? `${index + 1} of ${photos.length}` : ''].filter(Boolean).join(' · ')}</span>
        </div>
        <button type="button" class="viewer-x" onClick={close} aria-label="Close photo"><CloseIcon /></button>
      </div>
      <div class="viewer-img" ref={stage} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel}
        data-zoom={view.s.toFixed(2)}>
        {url && <img key={msg.id} src={url} alt={msg.text || 'Photo'} draggable={false} style={imgStyle} />}
        {photos.length > 1 && index > 0 && <button type="button" class="viewer-nav prev" onClick={() => go(-1)} aria-label="Previous photo">‹</button>}
        {photos.length > 1 && index < photos.length - 1 && <button type="button" class="viewer-nav next" onClick={() => go(1)} aria-label="Next photo">›</button>}
      </div>
      <div class="viewer-bottom">
        {msg.text && <div class="viewer-cap">{msg.text}</div>}
        <div class="viewer-actions">
          <button type="button" class="pin" onClick={() => onPin(msg)} disabled={pinned}>{pinned ? 'Pinned' : 'Pin to scrapbook'}</button>
          <button type="button" class="back" onClick={save} disabled={!url}>{note || 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
