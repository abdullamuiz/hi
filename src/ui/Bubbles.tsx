import { useEffect, useState } from 'preact/hooks';
import { photoURL } from '../data/photos';
import type { Message } from '../types';
import { CloseIcon, LinkIcon, PlayIcon } from './icons';

export function LinkCard({ msg, onFeel }: { msg: Message; onFeel?: () => void }) {
  const l = msg.link!;
  const title = l.title || (l.status === 'pending' ? `${l.isVideo ? 'Video' : 'Page'} on ${l.domain}` : l.url);
  const desc = msg.text || l.description || (l.status === 'pending' ? 'Loading preview…' : '');
  const img = l.image && /^https:\/\//.test(l.image) ? l.image : null;
  return (
    <div class="link-card">
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

function usePhoto(path: string) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    photoURL(path).then((u) => live && setUrl(u)).catch(() => {});
    return () => { live = false; };
  }, [path]);
  return url;
}

export function PhotoBubble({ msg, mine, onView }: { msg: Message; mine: boolean; onView(): void }) {
  const p = msg.photo!;
  const url = usePhoto(p.path);
  // 240px wide, height follows the photo within sensible bounds (prototype: 240×180).
  const h = Math.round(Math.max(140, Math.min(320, (240 * p.height) / Math.max(1, p.width))));
  return (
    <div class="photo-wrap">
      <button type="button" class="photo-btn" style={{ height: `${h}px` }} onClick={onView} aria-label="View photo full screen">
        {url ? <img src={url} alt={msg.text || 'Photo'} loading="lazy" decoding="async" /> : <span class="uploading">Loading…</span>}
      </button>
      {msg.text && <div class="caption" style={{ textAlign: mine ? 'right' : 'left' }}>{msg.text}</div>}
    </div>
  );
}

interface ViewerProps { msg: Message; from: string; pinned: boolean; onPin(): void; onClose(): void }

export function PhotoViewer({ msg, from, pinned, onPin, onClose }: ViewerProps) {
  const url = usePhoto(msg.photo!.path);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);
  return (
    <div class="viewer" role="dialog" aria-modal="true" aria-label={`Photo from ${from}`}>
      <div class="viewer-top">
        <div class="viewer-from">{from}</div>
        <button type="button" class="viewer-x" onClick={onClose} aria-label="Close photo"><CloseIcon /></button>
      </div>
      <div class="viewer-img">{url && <img src={url} alt={msg.text || 'Photo'} />}</div>
      <div class="viewer-bottom">
        <div class="viewer-cap">{msg.text || 'No caption yet'}</div>
        <div class="viewer-actions">
          <button type="button" class="pin" onClick={onPin} disabled={pinned}>{pinned ? 'Pinned' : 'Pin to scrapbook'}</button>
          <button type="button" class="back" onClick={onClose}>Back to chat</button>
        </div>
      </div>
    </div>
  );
}
