import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { HISTORY_CAP, loadHistory, type RoomHistory } from '../data/history';
import { photoURL } from '../data/photos';
import { excerpt, FILTERS, highlight, search, terms, type SearchFilter } from '../lib/search';
import { dayLabel } from '../lib/time';
import type { Jump } from '../lib/jump';
import type { Message, Tab } from '../types';

interface Scope { roomId: string; name: string }

interface Props {
  me: string;
  /** One chat (search inside it), or every chat (search from the chat list). */
  scope: Scope[];
  global?: boolean;
  initialFilter?: SearchFilter;
  onOpen(j: Jump): void;
}

interface Item { msg: Message; roomId: string; roomName: string; tab: Tab | undefined }

const ms = (m: Message) => (m.createdAt ? m.createdAt.toMillis() : 0);
const dur = (msDur: number) => { const s = Math.round(msDur / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** Search messages (text, captions, link titles) across tabs, or browse photos, links, voice notes and Drops. */
export function SearchSheet({ me, scope, global = false, initialFilter = 'all', onOpen }: Props) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<SearchFilter>(initialFilter);
  const [hist, setHist] = useState<RoomHistory[] | null>(null);
  const [err, setErr] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const key = scope.map((s) => s.roomId).join(',');

  useEffect(() => {
    let live = true;
    setHist(null);
    Promise.all(scope.map((s) => loadHistory(s.roomId)))
      .then((h) => { if (live) setHist(h); })
      .catch((e) => { if (live) setErr(e?.message || 'Could not load messages.'); });
    return () => { live = false; };
  }, [key]);
  useEffect(() => { if (initialFilter === 'all') input.current?.focus(); }, []);

  const items = useMemo<Item[]>(() => (hist || []).flatMap((h) => {
    const roomName = scope.find((s) => s.roomId === h.roomId)?.name
      || (Object.entries(h.names).find(([u]) => u !== me)?.[1] || '').split(/\s+/)[0] || 'Chat';
    return h.messages.map((msg) => ({ msg, roomId: h.roomId, roomName, tab: h.tabs.find((t) => t.id === msg.tabId) }));
  }), [hist]);
  const t = useMemo(() => terms(q), [q]);
  const results = useMemo(() => search(items, q, filter, me), [items, q, filter, me]);
  const truncated = (hist || []).some((h) => h.truncated);

  const open = (it: Item) => onOpen({ roomId: it.roomId, tabId: it.msg.tabId, msgId: it.msg.id, atMs: ms(it.msg) });

  // Grouped by chat (search everywhere) or by tab (search one chat).
  const grouped = useMemo(() => {
    const g: { key: string; title: string; colour?: string; items: Item[] }[] = [];
    results.forEach((it) => {
      const k = global ? it.roomId : it.msg.tabId;
      let grp = g.find((x) => x.key === k);
      if (!grp) {
        grp = { key: k, title: global ? it.roomName : it.tab?.name || 'Tab', colour: global ? undefined : it.tab?.colour, items: [] };
        g.push(grp);
      }
      grp.items.push(it);
    });
    return g;
  }, [results, global]);

  return (
    <div class="stack search-sheet">
      <div>
        <div class="sheet-title">{global ? 'Search all chats' : 'Search this chat'}</div>
      </div>
      <input ref={input} type="search" class="field" placeholder={global ? 'Search messages in every chat' : 'Search messages, captions, links'}
        aria-label="Search messages" value={q} onInput={(e) => setQ(e.currentTarget.value)} enterkeyhint="search" />
      <div class="filter-row" role="radiogroup" aria-label="Show">
        {FILTERS.map((f) => (
          <button type="button" key={f.id} role="radio" aria-checked={filter === f.id}
            class={`chip-btn${filter === f.id ? ' on' : ''}`} onClick={() => setFilter(f.id)}>{f.label}</button>
        ))}
      </div>

      {err && <div class="err">{err}</div>}
      {!hist && !err && <div class="empty">Looking through your messages…</div>}
      {hist && !t.length && filter === 'all' && (
        <div class="fine">
          Finds words in messages, photo captions and link titles{global ? ' across all your chats' : ' in every tab'}.
          Searches the latest {HISTORY_CAP.toLocaleString()} messages of each chat.
        </div>
      )}
      {hist && (t.length > 0 || filter !== 'all') && results.length === 0 && (
        <div class="empty">{t.length ? `Nothing found for “${q.trim()}”.` : `No ${FILTERS.find((f) => f.id === filter)!.label.toLowerCase()} yet.`}</div>
      )}

      {filter === 'photos' && results.length > 0 ? (
        <div class="photo-grid" role="list" aria-label="Photos">
          {results.map((it) => (
            <div role="listitem" key={it.msg.id}>
              <button type="button" class="photo-cell" onClick={() => open(it)}
                aria-label={`Photo from ${dayLabel(ms(it.msg))}${it.msg.text ? `: ${it.msg.text}` : ''}${global ? ` with ${it.roomName}` : ''}`}>
                <Thumb path={it.msg.photo?.path} />
              </button>
            </div>
          ))}
        </div>
      ) : grouped.map((g) => (
        <section class="result-group" key={g.key} aria-label={g.title}>
          <div class="result-head">
            {g.colour && <span class="tab-dot" style={{ background: g.colour }} aria-hidden="true" />}
            <span>{g.title}</span>
            <span class="fine">{g.items.length}</span>
          </div>
          <ul class="result-list">
            {g.items.map((it) => (
              <li key={it.msg.id}>
                <button type="button" class="result-row" onClick={() => open(it)}>
                  <span class="result-meta">
                    {global && it.tab && <span class="result-tab"><span class="tab-dot" style={{ background: it.tab.colour }} aria-hidden="true" />{it.tab.name}</span>}
                    <span>{it.msg.uid === me ? 'You' : it.roomName}</span>
                    <span>· {dayLabel(ms(it.msg))}</span>
                  </span>
                  <span class="result-text"><ResultText msg={it.msg} t={t} /></span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {results.length >= 200 && <div class="fine">Showing the newest 200. Add another word to narrow it down.</div>}
      {truncated && hist && <div class="fine">Older messages aren’t included (only the latest {HISTORY_CAP.toLocaleString()} per chat).</div>}
    </div>
  );
}

function ResultText({ msg, t }: { msg: Message; t: string[] }) {
  if (msg.kind === 'voice') return <>🎤 Voice note · {dur(msg.voice?.durationMs || 0)}</>;
  if (msg.kind === 'drop') return <>💧 A Drop</>;
  const text = msg.kind === 'link'
    ? [msg.link?.title, msg.text, msg.link?.domain].filter(Boolean).join(' · ')
    : msg.kind === 'photo' ? (msg.text ? `📷 ${msg.text}` : '📷 Photo') : msg.text;
  return <>{highlight(excerpt(text, t), t).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}</>;
}

function Thumb({ path }: { path?: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => { if (path) photoURL(path).then(setUrl).catch(() => {}); }, [path]);
  return url ? <img src={url} alt="" loading="lazy" /> : <span class="photo-ph" aria-hidden="true" />;
}
