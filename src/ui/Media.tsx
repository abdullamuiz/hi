import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { MediaItem, Room, Together } from '../types';
import type { Person } from '../drops/types';
import {
  addMedia, endTogether, fixWantCount, markPresent, rate, react, removeMedia, sendTogetherReaction, setEpisode,
  setPlayback, setSongOfDay, setStatus, watchMedia, watchPresence, watchTogetherReactions,
} from '../data/media';
import {
  COUNTDOWN_PROVIDERS, MEDIA_REACTIONS, PROVIDERS, STATUS_LABEL, TOGETHER_REACTIONS, WATCH_STATUSES,
  countWant, countdownStage, driftFix, embedHeight, embedUrl, fmtTime, normaliseUrl, presentWithin,
  type MediaKind, type WatchStatus,
} from '../lib/media';
import { closeOverlay, forgetOverlay, openOverlay } from '../lib/overlay';
import { Wheel } from '../drops/decision-wheel.drop';
import { buzz, fxOn } from '../drops/fx';
import { BackIcon } from './icons';

// ------------------------------------------------------------------ the header switch

/** 🎬 🎵 in the chat header. The 🎬 badge is "Want to watch" (from the room, no extra listener). */
export function MediaSwitch({ want, active, onOpen }: { want: number; active?: MediaKind | null; onOpen(k: MediaKind): void }) {
  return (
    <div class="media-switch" role="group" aria-label="Watch list and Music">
      <button type="button" class={active === 'watch' ? 'on' : ''} aria-pressed={active === 'watch'} onClick={() => onOpen('watch')}
        aria-label={`Watch list${want ? `, ${want} to watch` : ''}`}>
        <span aria-hidden="true">🎬</span>
        {want > 0 && <b class="media-badge" aria-hidden="true">{want > 99 ? '99+' : want}</b>}
      </button>
      <button type="button" class={active === 'music' ? 'on' : ''} aria-pressed={active === 'music'} onClick={() => onOpen('music')} aria-label="Music">
        <span aria-hidden="true">🎵</span>
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ the panel

interface PanelProps {
  room: Room;
  me: Person;
  partner: Person;
  kind: MediaKind;
  onKind(k: MediaKind): void;
  onToast(t: string): void;
  onClose(): void;
  /** Open the watch-together view on this YouTube item (starts the session). */
  onWatchTogether(item: MediaItem): void;
  onCountdown(item: MediaItem): void;
}

export function MediaPanel({ room, me, partner, kind, onKind, onToast, onClose, onWatchTogether, onCountdown }: PanelProps) {
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [filter, setFilter] = useState<WatchStatus>('want');
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [pick, setPick] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const self = room.self;

  useLayoutEffect(() => {
    const close = () => closeRef.current();
    openOverlay(close);
    return () => forgetOverlay(close);
  }, []);
  const close = () => closeOverlay();

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (pick) setPick(false);
      else if (open) setOpen(null);
      else close();
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [open, pick]);

  // Listen only while the panel is open.
  const fixed = useRef(false);
  useEffect(() => watchMedia(room.id, (list, fromServer) => {
    setItems(list);
    // Put the 🎬 badge right if it drifted (once per opening, from server data only).
    if (fromServer && !fixed.current) {
      fixed.current = true;
      fixWantCount(room.id, room.mediaWantCount, countWant(list)).catch(() => {});
    }
  }, (e) => onToast(e.message)), [room.id]);

  const mine = (items || []).filter((i) => i.kind === kind);
  const counts = useMemo(() => Object.fromEntries(WATCH_STATUSES.map((s) => [s, mine.filter((i) => i.status === s).length])) as Record<WatchStatus, number>, [items, kind]);
  const shown = kind === 'watch' ? mine.filter((i) => i.status === filter) : mine;
  const songOfDay = kind === 'music' && room.songOfDay ? mine.find((i) => i.id === room.songOfDay!.id) || null : null;
  const item = open ? (items || []).find((i) => i.id === open) || null : null;
  const nameOf = (uid: string) => (uid === me.uid ? 'You' : partner.name);

  const add = async () => {
    const url = normaliseUrl(draft);
    if (!url) { onToast('Paste a link (Netflix, Prime, YouTube, Spotify…)'); return; }
    // Clear straight away (the card shows at once), so the next link can be pasted while this one saves.
    const typed = draft;
    setDraft('');
    if (kind === 'watch') setFilter('want');
    try {
      await addMedia(room.id, me.uid, url, kind);
    } catch (e: any) {
      onToast(e?.message || 'Could not add that.');
      setDraft((d) => d || typed);
    }
  };

  return (
    <section class="media-panel" aria-label={kind === 'watch' ? 'Watch list' : 'Music'}>
      <div class="media-top">
        <button type="button" class="back-btn" onClick={close} aria-label="Close"><BackIcon /></button>
        <div class="scrap-heading">
          <div class="scrap-h1">{kind === 'watch' ? 'Watch list' : 'Music'}</div>
          <div class="scrap-h2">{self ? 'Just for you' : `with ${partner.name}`}</div>
        </div>
        <MediaSwitch want={room.mediaWantCount} active={kind} onOpen={onKind} />
      </div>

      <div class="media-body">
        {kind === 'watch' && (<>
          <div class="segmented media-seg" role="tablist" aria-label="Status">
            {WATCH_STATUSES.map((s) => (
              <button type="button" key={s} role="tab" aria-selected={filter === s} class={filter === s ? 'on' : ''} onClick={() => setFilter(s)}>
                {s === 'want' ? 'Want' : STATUS_LABEL[s]} · {counts[s]}
              </button>
            ))}
          </div>
          {filter === 'want' && counts.want >= 2 && (
            <div class="media-pick-row"><button type="button" class="media-pick" onClick={() => setPick(true)}>🎡 Pick for tonight</button></div>
          )}
        </>)}

        {songOfDay && (
          <div class="media-sotd">
            <div class="media-label">⭐ Song of the day · from {room.songOfDay!.by === me.uid ? 'you' : partner.name}</div>
            <MediaCard item={songOfDay} me={me.uid} nameOf={nameOf} onOpen={() => setOpen(songOfDay.id)} compact />
            <Embed url={songOfDay.url} title={songOfDay.title} />
          </div>
        )}

        {kind === 'music' && mine.length > 0 && <div class="media-label">Shared playlist · {mine.length} {mine.length === 1 ? 'song' : 'songs'}</div>}

        {items === null && <div class="fine center">Loading…</div>}
        {items !== null && !shown.length && (
          <div class="media-empty">
            {kind === 'watch'
              ? (filter === 'want' ? 'Nothing on the list yet. Paste a Netflix, Prime, Disney+ or YouTube link below.' : `Nothing ${filter === 'watching' ? 'being watched' : 'watched'} yet.`)
              : 'No songs yet. Paste a Spotify, YouTube or Apple Music link below.'}
          </div>
        )}
        {shown.filter((i) => i !== songOfDay).map((i) => (
          <div key={i.id}>
            <MediaCard item={i} me={me.uid} nameOf={nameOf} onOpen={() => setOpen(i.id)}
              onPlay={kind === 'music' && embedUrl(i.url) ? () => setPlaying(playing === i.id ? null : i.id) : undefined}
              playingNow={playing === i.id} />
            {playing === i.id && <Embed url={i.url} title={i.title} />}
          </div>
        ))}
      </div>

      <form class="media-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <label class="sr" for="media-url">{kind === 'watch' ? 'Paste a link to add to the Watch list' : 'Paste a song link'}</label>
        <input id="media-url" class="msg-input" value={draft} inputMode="url" autocomplete="off"
          placeholder={kind === 'watch' ? 'Paste a Netflix / Prime / YouTube link…' : 'Paste a Spotify / YouTube / Apple Music link…'}
          onInput={(e) => setDraft(e.currentTarget.value)} />
        <button type="submit" class="media-add-btn" disabled={!draft.trim()}>Add</button>
      </form>

      {item && (
        <div class="sheet-wrap">
          <button type="button" class="scrim" onClick={() => setOpen(null)} aria-label="Close" />
          <div class="sheet" role="dialog" aria-modal="true" aria-label={item.title}>
            <ItemSheet item={item} room={room} me={me} partner={partner} songOfDay={room.songOfDay?.id === item.id}
              onToast={onToast} onDone={() => setOpen(null)}
              onWatchTogether={() => { setOpen(null); onWatchTogether(item); }}
              onCountdown={() => { setOpen(null); onCountdown(item); }} />
          </div>
        </div>
      )}
      {pick && <PickForTonight items={mine.filter((i) => i.status === 'want').slice(0, 12)} me={me.uid} onClose={() => setPick(false)}
        onOpen={(id) => { setPick(false); setOpen(id); }} />}
    </section>
  );
}

function Poster({ item, size }: { item: MediaItem; size: 'sm' | 'md' }) {
  const [bad, setBad] = useState(false);
  const p = PROVIDERS[item.provider] || PROVIDERS.other;
  return (
    <div class={`media-poster ${size}${item.kind === 'music' ? ' square' : ''}`} style={{ background: `linear-gradient(160deg, ${p.bg}, #1B2036)` }} aria-hidden="true">
      {item.image && !bad
        ? <img src={item.image} alt="" loading="lazy" referrerpolicy="no-referrer" onError={() => setBad(true)} />
        : <span>{item.kind === 'music' ? '♪' : '▶'}</span>}
    </div>
  );
}

export function ProviderBadge({ provider }: { provider: MediaItem['provider'] }) {
  const p = PROVIDERS[provider] || PROVIDERS.other;
  return <span class="media-svc" style={{ background: p.bg, color: p.fg }}>{p.badge}</span>;
}

const stars = (n: number) => '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);

function MediaCard({ item, me, nameOf, onOpen, onPlay, playingNow, compact }: {
  item: MediaItem; me: string; nameOf(uid: string): string; onOpen(): void; onPlay?(): void; playingNow?: boolean; compact?: boolean;
}) {
  const ratings = Object.entries(item.ratings).sort(([a], [b]) => (a === me ? -1 : b === me ? 1 : 0));
  const rx = Object.values(item.reactions).reduce<Record<string, number>>((acc, e) => ({ ...acc, [e]: (acc[e] || 0) + 1 }), {});
  const meta = [item.siteName || PROVIDERS[item.provider]?.label, item.addedBy === me ? 'added by you' : `added by ${nameOf(item.addedBy)}`].filter(Boolean).join(' · ');
  return (
    <div class={`media-card${compact ? ' compact' : ''}`}>
      <button type="button" class="media-card-main" onClick={onOpen} aria-label={`${item.title}. Options`}>
        <Poster item={item} size={item.kind === 'music' || compact ? 'sm' : 'md'} />
        <div class="media-info">
          <div class="media-title">{item.title}{item.preview === 'pending' && <span class="media-loading" aria-label="Loading details">…</span>}</div>
          <div class="media-meta">{meta}</div>
          <div class="media-tags">
            <ProviderBadge provider={item.provider} />
            {item.status && <span class="media-status">{item.status === 'watching' && item.episode ? `Watching · ${item.episode}` : STATUS_LABEL[item.status]}</span>}
            {Object.entries(rx).map(([e, n]) => <span key={e} class="media-rx">{e} {n}</span>)}
          </div>
          {ratings.length > 0 && (
            <div class="media-stars">{ratings.map(([uid, n]) => <span key={uid}>{nameOf(uid)} {stars(n)}</span>)}</div>
          )}
        </div>
      </button>
      {onPlay && (
        <button type="button" class="media-play" onClick={onPlay} aria-label={playingNow ? `Hide player for ${item.title}` : `Play ${item.title}`}>
          {playingNow ? '■' : '▶'}
        </button>
      )}
    </div>
  );
}

/** Spotify / YouTube / Apple Music inline player. */
function Embed({ url, title }: { url: string; title: string }) {
  const src = embedUrl(url);
  if (!src) return null;
  const h = embedHeight(url);
  return (
    <div class={`media-embed${h ? '' : ' video'}`} style={h ? { height: `${h}px` } : undefined}>
      <iframe src={src} title={`Player: ${title}`} loading="lazy" referrerpolicy="strict-origin-when-cross-origin"
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" allowFullScreen />
    </div>
  );
}

function ItemSheet({ item, room, me, partner, songOfDay, onToast, onDone, onWatchTogether, onCountdown }: {
  item: MediaItem; room: Room; me: Person; partner: Person; songOfDay: boolean;
  onToast(t: string): void; onDone(): void; onWatchTogether(): void; onCountdown(): void;
}) {
  const [ep, setEp] = useState(item.episode);
  const [listen, setListen] = useState(false);
  const p = PROVIDERS[item.provider] || PROVIDERS.other;
  const myStars = item.ratings[me.uid] || 0;
  const myRx = item.reactions[me.uid] || '';
  const err = (e: any) => onToast(e?.message || 'Could not save that.');
  const together = !room.self && room.members.length === 2 && !room.left;
  const canSync = together && item.provider === 'youtube' && !!item.videoId;
  const canCount = together && COUNTDOWN_PROVIDERS.includes(item.provider);

  return (
    <div class="stack media-sheet">
      <div class="media-sheet-head">
        <Poster item={item} size="sm" />
        <div class="media-info">
          <div class="sheet-title media-sheet-title">{item.title}</div>
          <div class="media-tags"><ProviderBadge provider={item.provider} />{item.description && <span class="media-desc">{item.description}</span>}</div>
        </div>
      </div>

      <a class="btn-ghost media-open" href={item.url} target="_blank" rel="noopener noreferrer">Open in {p.app} ↗</a>

      {item.kind === 'watch' && (<>
        <div class="segmented" role="radiogroup" aria-label="Status">
          {WATCH_STATUSES.map((s) => (
            <button type="button" key={s} role="radio" aria-checked={item.status === s} class={item.status === s ? 'on' : ''}
              onClick={() => setStatus(room.id, item, s).catch(err)}>{STATUS_LABEL[s]}</button>
          ))}
        </div>
        {item.status === 'watching' && (
          <form class="media-ep" onSubmit={(e) => { e.preventDefault(); setEpisode(room.id, item.id, ep).then(() => onToast('Saved')).catch(err); }}>
            <label class="field-label" for="media-ep">Where are you up to?</label>
            <div class="media-ep-row">
              <input id="media-ep" class="field" value={ep} maxLength={40} placeholder="e.g. S2 E5" onInput={(e) => setEp(e.currentTarget.value)} />
              <button type="submit" class="btn-ghost small">Save</button>
            </div>
          </form>
        )}
      </>)}

      <div class="media-rate" role="radiogroup" aria-label="Your rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button type="button" key={n} role="radio" aria-checked={myStars === n} aria-label={`${n} star${n > 1 ? 's' : ''}`}
            class={n <= myStars ? 'on' : ''} onClick={() => rate(room.id, item.id, me.uid, myStars === n ? null : n).catch(err)}>★</button>
        ))}
        {item.ratings[partner.uid] ? <span class="fine">{partner.name}: {stars(item.ratings[partner.uid])}</span> : null}
      </div>

      <div class="media-react" role="group" aria-label="React">
        {MEDIA_REACTIONS.map((e) => (
          <button type="button" key={e} class={myRx === e ? 'on' : ''} aria-pressed={myRx === e} aria-label={`React ${e}`}
            onClick={() => react(room.id, item.id, me.uid, myRx === e ? null : e).catch(err)}>{e}</button>
        ))}
      </div>

      {canSync && <button type="button" class="btn-primary" onClick={onWatchTogether}>▶ Watch together</button>}
      {canCount && <button type="button" class="btn-primary" onClick={onCountdown}>3-2-1 Play together</button>}
      {item.kind === 'music' && (<>
        <button type="button" class="btn-ghost" onClick={() => setSongOfDay(room.id, songOfDay ? null : item.id, me.uid).then(onDone).catch(err)}>
          {songOfDay ? 'Remove as song of the day' : '⭐ Make song of the day'}
        </button>
        {together && (canSync
          ? <button type="button" class="btn-primary" onClick={onWatchTogether}>🎧 Listen together</button>
          : <button type="button" class="btn-ghost" onClick={() => setListen(!listen)} aria-expanded={listen}>🎧 Listen together</button>)}
        {listen && !canSync && (
          <div class="note">
            {item.provider === 'spotify'
              ? <>Spotify plays together in its own app: start a <b>Jam</b> in Spotify and share it with {partner.name}. <a href={item.url} target="_blank" rel="noopener noreferrer">Open in Spotify ↗</a></>
              : <>{p.app} can't be synced from Hi. Press play at the same time, or add a YouTube link to listen in sync.</>}
          </div>
        )}
      </>)}

      {item.addedBy === me.uid && (
        <button type="button" class="btn-ghost danger-text" onClick={() => { onDone(); removeMedia(room.id, item).then(() => onToast('Removed')).catch(err); }}>Remove</button>
      )}
    </div>
  );
}

/** Spin the wheel over the "Want to watch" list (on this phone). */
function PickForTonight({ items, me, onClose, onOpen }: { items: MediaItem[]; me: string; onClose(): void; onOpen(id: string): void }) {
  const opts = useMemo(() => items.map((i) => ({ id: i.id, uid: i.addedBy, text: i.title })), [items]);
  const [winner] = useState(() => Math.floor(Math.random() * Math.max(1, opts.length)));
  const n = Math.max(1, opts.length);
  const target = 5 * 360 - (winner + 0.5) * (360 / n);
  const animate = fxOn();
  const [rot, setRot] = useState(animate ? 0 : target);
  const [landed, setLanded] = useState(!animate);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!animate) return;
    let raf = 0;
    const t0 = performance.now();
    let last = -1;
    const frame = (now: number) => {
      const t = Math.min(1, (now - t0) / 3600);
      const deg = target * (1 - (1 - t) ** 4);
      setRot(deg);
      const sl = Math.floor((((-deg % 360) + 360) % 360) / (360 / n));
      if (sl !== last) { last = sl; setTick((k) => k + 1); buzz(4); }
      if (t < 1) raf = requestAnimationFrame(frame); else { setLanded(true); buzz([10, 30, 20]); }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  const won = opts[winner];
  return (
    <div class="sheet-wrap">
      <button type="button" class="scrim" onClick={onClose} aria-label="Close" />
      <div class="sheet" role="dialog" aria-modal="true" aria-label="Pick for tonight">
        <div class="sheet-title">🎡 Pick for tonight</div>
        <Wheel options={opts} rot={rot} tick={tick} landed={landed} winner={landed ? winner : -1} me={me} />
        <div role="status" class="media-pick-result">{landed && won ? <>Tonight: <b>{won.text}</b></> : 'Spinning…'}</div>
        {landed && won && <button type="button" class="btn-primary" onClick={() => onOpen(won.id)}>Open {won.text.length > 24 ? 'it' : won.text}</button>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ watch together

/** The player both phones drive. YouTube's IFrame API, or a fake one for tests (localStorage hi.fakePlayer = 1). */
interface Player {
  play(): void;
  pause(): void;
  seek(sec: number): void;
  time(): number;
  playing(): boolean;
  destroy(): void;
}

let ytReady: Promise<any> | null = null;
function loadYouTube(): Promise<any> {
  const w = window as any;
  if (w.YT?.Player) return Promise.resolve(w.YT);
  if (!ytReady) {
    ytReady = new Promise((resolve, reject) => {
      const prev = w.onYouTubeIframeAPIReady;
      w.onYouTubeIframeAPIReady = () => { prev?.(); resolve(w.YT); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.async = true;
      s.onerror = () => { ytReady = null; reject(new Error('YouTube player could not load')); };
      document.head.appendChild(s);
    });
  }
  return ytReady;
}

const useFake = () => { try { return localStorage.getItem('hi.fakePlayer') === '1'; } catch { return false; } };

function fakePlayer(el: HTMLElement, onChange: (playing: boolean) => void): Player {
  let pos = 0;
  let since = 0;
  let on = false;
  const now = () => (on ? pos + (Date.now() - since) / 1000 : pos);
  const draw = () => { el.dataset.state = on ? 'playing' : 'paused'; el.dataset.time = now().toFixed(1); el.textContent = `${on ? '▶' : '❚❚'} ${fmtTime(now())}`; };
  const iv = setInterval(draw, 200);
  draw();
  return {
    play() { if (!on) { pos = now(); since = Date.now(); on = true; draw(); onChange(true); } },
    pause() { if (on) { pos = now(); on = false; draw(); onChange(false); } },
    seek(sec) { pos = Math.max(0, sec); since = Date.now(); draw(); },
    time: now,
    playing: () => on,
    destroy() { clearInterval(iv); },
  };
}

function youTubePlayer(el: HTMLElement, videoId: string, onChange: (playing: boolean) => void, onReady: () => void, onError: (m: string) => void): Player {
  let p: any = null;
  let dead = false;
  loadYouTube().then((YT) => {
    if (dead) return;
    p = new YT.Player(el, {
      videoId,
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
      events: {
        onReady: () => onReady(),
        onStateChange: (e: any) => {
          if (e.data === YT.PlayerState.PLAYING) onChange(true);
          else if (e.data === YT.PlayerState.PAUSED) onChange(false);
        },
        onError: () => onError('This video can’t be played here.'),
      },
    });
  }).catch((e) => onError(e.message));
  return {
    play: () => p?.playVideo?.(),
    pause: () => p?.pauseVideo?.(),
    seek: (s) => p?.seekTo?.(s, true),
    time: () => (p?.getCurrentTime ? p.getCurrentTime() : 0),
    playing: () => (p?.getPlayerState ? p.getPlayerState() === 1 : false),
    destroy: () => { dead = true; try { p?.destroy?.(); } catch { /* ignore */ } },
  };
}

interface FloatRx { id: string; emoji: string; x: number }

export function TogetherView({ roomId, me, partner, together, onClose, onToast }: {
  roomId: string; me: Person; partner: Person; together: Together; onClose(): void; onToast(t: string): void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<Player | null>(null);
  const shared = useRef(together);
  shared.current = together;
  // Changes we apply from the other phone shouldn't be written back.
  const quietUntil = useRef(0);
  const [ready, setReady] = useState(false);
  const [playingNow, setPlayingNow] = useState(false);
  const [pos, setPos] = useState(0);
  const [presence, setPresence] = useState<Record<string, number>>({});
  const [floats, setFloats] = useState<FloatRx[]>([]);
  const seen = useRef(new Set<string>());
  const openedAt = useRef(Date.now());
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    const close = () => closeRef.current();
    openOverlay(close);
    return () => forgetOverlay(close);
  }, []);

  const write = (state: 'playing' | 'paused', at: number) => setPlayback(roomId, me.uid, state, at).catch((e) => onToast(e.message));

  // The player.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onChange = (playing: boolean) => {
      setPlayingNow(playing);
      // Someone used the player's own controls: share it (unless we caused it).
      if (Date.now() < quietUntil.current) return;
      const s = shared.current;
      if ((s.state === 'playing') !== playing) write(playing ? 'playing' : 'paused', player.current?.time() || 0);
    };
    if (useFake()) {
      player.current = fakePlayer(el, onChange);
      setReady(true);
    } else if (together.videoId) {
      const inner = document.createElement('div');
      el.appendChild(inner);
      player.current = youTubePlayer(inner, together.videoId, onChange, () => setReady(true), onToast);
    }
    return () => { player.current?.destroy(); player.current = null; };
  }, [together.videoId]);

  // Follow the shared state (theirs, and ours on first load), correcting drift.
  const apply = () => {
    const pl = player.current;
    const s = shared.current;
    if (!pl || !ready) return;
    const want = { state: s.state, positionSec: s.positionSec, updatedAtMs: s.atMs };
    const fix = driftFix(pl.time(), want, Date.now());
    quietUntil.current = Date.now() + 1200;
    if (fix != null) pl.seek(fix);
    if (s.state === 'playing' && !pl.playing()) pl.play();
    if (s.state === 'paused' && pl.playing()) pl.pause();
  };
  useEffect(apply, [ready, together.state, together.positionSec, together.atMs]);
  useEffect(() => {
    const iv = setInterval(() => {
      setPos(player.current?.time() || 0);
      if (shared.current.state === 'playing' && Date.now() > quietUntil.current) apply();
    }, 3000);
    const fast = setInterval(() => setPos(player.current?.time() || 0), 500);
    return () => { clearInterval(iv); clearInterval(fast); };
  }, [ready]);

  // Presence: "In sync with …".
  useEffect(() => {
    const beat = () => markPresent(roomId, me.uid).catch(() => {});
    beat();
    const iv = setInterval(beat, 15_000);
    const un = watchPresence(roomId, setPresence);
    return () => { clearInterval(iv); un(); };
  }, [roomId]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const iv = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(iv); }, []);
  const together2 = presentWithin(presence[partner.uid], now);

  // Floating reactions, for both.
  useEffect(() => watchTogetherReactions(roomId, openedAt.current - 2000, (list) => {
    const fresh = list.filter((r) => !seen.current.has(r.id));
    if (!fresh.length) return;
    fresh.forEach((r) => seen.current.add(r.id));
    const add = fresh.map((r) => ({ id: r.id, emoji: r.emoji, x: 10 + Math.random() * 75 }));
    setFloats((f) => [...f, ...add].slice(-12));
    setTimeout(() => setFloats((f) => f.filter((x) => !add.includes(x))), 2600);
  }), [roomId]);

  const toggle = () => {
    const pl = player.current;
    if (!pl) return;
    const t = pl.time();
    quietUntil.current = Date.now() + 1200;
    if (pl.playing()) { pl.pause(); write('paused', t); } else { pl.play(); write('playing', t); }
  };
  const skip = (d: number) => {
    const pl = player.current;
    if (!pl) return;
    const t = Math.max(0, pl.time() + d);
    quietUntil.current = Date.now() + 1200;
    pl.seek(t);
    write(pl.playing() ? 'playing' : 'paused', t);
  };

  return (
    <section class="media-panel together" aria-label="Watching together">
      <div class="media-top">
        <button type="button" class="back-btn" onClick={() => closeOverlay()} aria-label="Close"><BackIcon /></button>
        <div class="scrap-heading">
          <div class="scrap-h1">Watching together</div>
          <div class="scrap-h2">{together.title} · YouTube</div>
        </div>
      </div>
      <div class="media-body">
        <div class={`together-video${fxOn() ? '' : ' still'}`}>
          <div ref={host} class="together-player" data-testid="together-player" />
          {floats.map((f) => <span key={f.id} class="together-float" style={{ left: `${f.x}%` }} aria-hidden="true">{f.emoji}</span>)}
          {!ready && <div class="together-wait">Loading the player…</div>}
        </div>
        <div class="together-sync" role="status">
          <span class={`sync-dot${together2 ? ' on' : ''}`} aria-hidden="true" />
          {together2 ? `In sync with ${partner.name}` : `Waiting for ${partner.name} to join`} · {fmtTime(pos)}
        </div>
        <div class="together-ctrl">
          <button type="button" onClick={() => skip(-10)} aria-label="Back 10 seconds">⏪</button>
          <button type="button" class="big" onClick={toggle} aria-label={playingNow ? 'Pause for both' : 'Play for both'}>{playingNow ? '❚❚' : '▶'}</button>
          <button type="button" onClick={() => skip(10)} aria-label="Forward 10 seconds">⏩</button>
        </div>
        <div class="together-rx" role="group" aria-label="React">
          {TOGETHER_REACTIONS.map((e) => (
            <button type="button" key={e} aria-label={`React ${e}`} onClick={() => sendTogetherReaction(roomId, me.uid, e).catch(() => {})}>{e}</button>
          ))}
        </div>
        <button type="button" class="btn-ghost" onClick={() => { endTogether(roomId).catch(() => {}); closeOverlay(); }}>End for both</button>
      </div>
    </section>
  );
}

/** Slim bar in the chat: the other person is watching something together. */
export function TogetherBar({ together, me, partnerName, onJoin, onDismiss }: {
  together: Together; me: string; partnerName: string; onJoin(): void; onDismiss(): void;
}) {
  return (
    <div class="together-bar" role="status">
      <span class="together-bar-txt">▶ {together.by === me ? 'You started' : `${partnerName} is watching`} <b>{together.title}</b></span>
      <button type="button" class="btn-primary small" onClick={onJoin}>Join</button>
      <button type="button" class="link-btn" onClick={onDismiss} aria-label="Hide">✕</button>
    </div>
  );
}

/** 3-2-1 Play: both phones count down together, then "Press play … now!". */
export function CountdownOverlay({ together, roomId, me, onClose }: { together: Together; roomId: string; me: string; onClose(): void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const iv = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(iv); }, []);
  const at = together.countdownAtMs || 0;
  const st = countdownStage(at, now);
  const app = (PROVIDERS[together.provider] || PROVIDERS.other).app;
  useEffect(() => { if (st.go) buzz([40, 60, 40]); }, [st.go]);
  useEffect(() => { if (st.done) onClose(); }, [st.done]);
  return (
    <div class="countdown-overlay" role="dialog" aria-modal="true" aria-label="3-2-1 Play">
      <div class="countdown-card">
        <div class="media-label">{together.title}</div>
        {st.n != null
          ? <div class="countdown-num" aria-live="assertive">{st.n}</div>
          : <div class="countdown-go" aria-live="assertive">Press play on {app}… now!</div>}
        <div class="fine">Both phones count 3-2-1 together</div>
        <div class="together-rx" role="group" aria-label="React">
          {TOGETHER_REACTIONS.map((e) => (
            <button type="button" key={e} aria-label={`React ${e}`} onClick={() => sendTogetherReaction(roomId, me, e).catch(() => {})}>{e}</button>
          ))}
        </div>
        <button type="button" class="btn-ghost" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}


/** In the chat: the "watching together" message as a card with Watch now / Later. */
export function WatchInviteCard({ title, mine, live, saved, partnerName, onWatch, onLater, onList }: {
  title: string; mine: boolean; live: boolean; saved: boolean; partnerName: string;
  onWatch(): void; onLater(): void; onList(): void;
}) {
  return (
    <div class={`bubble watch-card ${mine ? 'mine' : 'theirs'}`}>
      <div class="watch-card-top"><span class="watch-card-play" aria-hidden="true">▶</span>
        <span class="watch-card-txt">
          <span class="watch-card-label">{mine ? 'You started watching' : `${partnerName} is watching`}</span>
          <b class="watch-card-title">{title}</b>
        </span>
      </div>
      {live && !mine && !saved && (
        <div class="watch-card-btns">
          <button type="button" class="btn-primary small" onClick={onWatch}>▶ Watch now</button>
          <button type="button" class="btn-ghost small" onClick={onLater}>Later</button>
        </div>
      )}
      {live && !mine && saved && (
        <div class="watch-card-btns"><span class="fine">Saved in your Watch list</span>
          <button type="button" class="link-btn" onClick={onWatch}>Watch now</button></div>
      )}
      {live && mine && (
        <div class="watch-card-btns"><button type="button" class="btn-ghost small" onClick={onWatch}>Open player</button></div>
      )}
      {!live && (
        <div class="watch-card-btns"><span class="fine">Ended</span>
          <button type="button" class="link-btn" onClick={onList}>Watch list</button></div>
      )}
    </div>
  );
}
