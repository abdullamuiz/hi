import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { User } from 'firebase/auth';
import { createDrop, sendPhoto, sendText, watchMessages } from '../data/messages';
import { addPin, watchPins } from '../data/pins';
import { ensureMember, heartbeat, setMood, setTyping, watchMembers } from '../data/rooms';
import { enablePush, pushStatus, type PushStatus } from '../data/push';
import { chooseTheme } from '../data/prefs';
import { currentTheme, type ThemeId } from '../lib/themes';
import { drops, getDrop } from '../drops/registry';
import type { DropDefinition, Person } from '../drops/types';
import { firstName, initial } from '../lib/names';
import { dayLabel, lastSeenLabel, toMillis } from '../lib/time';
import type { Member, Message, MoodId, Pin, Room } from '../types';
import { DropCard } from './DropCard';
import { LinkCard, PhotoBubble, PhotoViewer } from './Bubbles';
import { MoodSheet, ScrapSheet, SetupSheet, TraySheet } from './Sheets';
import { BookmarkIcon, MoodIcon, MOODS, PhotoIcon, PlusIcon, SendIcon } from './icons';

type Sheet =
  | null
  | { kind: 'tray' }
  | { kind: 'mood' }
  | { kind: 'scrap' }
  | { kind: 'setup'; type: string; prefill?: Record<string, unknown> };

const BANNER_KEY = 'drops.pushBannerDismissed';

export function Chat({ user, room }: { user: User; room: Room }) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [members, setMembers] = useState<Record<string, Member>>({});
  const [pins, setPins] = useState<Pin[]>([]);
  const [draft, setDraft] = useState('');
  const [sheet, setSheet] = useState<Sheet>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [theme, setTheme] = useState<ThemeId>(currentTheme);
  const [push, setPush] = useState<PushStatus>('unsupported');
  const [bannerHidden, setBannerHidden] = useState(() => { try { return !!localStorage.getItem(BANNER_KEY); } catch { return false; } });
  const lastTypingWrite = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const partnerUid = room.members.find((u) => u !== user.uid) || '';
  const meMember = members[user.uid];
  const partnerMember = partnerUid ? members[partnerUid] : undefined;

  const me = useMemo<Person>(() => ({ uid: user.uid, name: firstName(meMember?.name || user.displayName || user.email, 'You'), isMe: true }), [user.uid, meMember?.name, user.displayName, user.email]);
  const partner = useMemo<Person>(() => ({
    uid: partnerUid,
    name: partnerUid ? firstName(partnerMember?.name, 'Them') : firstName(room.invites[0], 'Them'),
    isMe: false,
  }), [partnerUid, partnerMember?.name, room.invites[0]]);

  // --- subscriptions ---------------------------------------------------------
  useEffect(() => {
    ensureMember(room.id, user).catch(console.warn);
    const unsubs = [
      watchMessages(room.id, setMessages, (e) => flash(e.message)),
      watchMembers(room.id, setMembers),
      watchPins(room.id, setPins),
    ];
    return () => unsubs.forEach((u) => u());
  }, [room.id, user.uid]);

  // presence heartbeat while the app is in front
  useEffect(() => {
    const beat = () => { if (document.visibilityState === 'visible') heartbeat(room.id, user.uid).catch(() => {}); };
    const t = setInterval(beat, 60_000);
    document.addEventListener('visibilitychange', beat);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', beat); };
  }, [room.id, user.uid]);

  useEffect(() => { pushStatus().then(setPush); }, []);

  // Escape closes any open sheet.
  useEffect(() => {
    if (!sheet) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setSheet(null); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [!!sheet]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? '' : t)), 4000);
  }

  // --- actions ---------------------------------------------------------------
  const onDraft = (v: string) => {
    setDraft(v);
    const now = Date.now();
    if (v && now - lastTypingWrite.current > 3000) {
      lastTypingWrite.current = now;
      setTyping(room.id, user.uid, true).catch(() => {});
    }
  };

  const send = () => {
    const t = draft.trim();
    if (!t) return;
    setDraft('');
    lastTypingWrite.current = 0;
    setTyping(room.id, user.uid, false).catch(() => {});
    sendText(room.id, user.uid, t).catch((e) => { setDraft(t); flash(e.message); });
  };

  const pickPhoto = () => fileInput.current?.click();
  const onFile = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const caption = draft;
    setDraft('');
    flash('Sending photo…');
    try {
      await sendPhoto(room.id, user.uid, file, caption);
      setToast('');
    } catch (err: any) {
      setDraft(caption);
      flash(err?.message || 'Photo could not be sent.');
    }
  };

  const startDrop = (def: DropDefinition<any>, prefill?: Record<string, unknown>) => {
    if (def.setup?.length) setSheet({ kind: 'setup', type: def.type, prefill });
    else dropIt(def, { ...def.content, ...(prefill || {}) });
  };

  const dropIt = async (def: DropDefinition<any>, content: Record<string, unknown>) => {
    setSheet(null);
    try {
      await createDrop(room.id, user.uid, def.type, content, def.initialEntries?.(content) || []);
    } catch (e: any) {
      flash(e?.message || 'Could not drop that.');
    }
  };

  const pin = (p: { title: string; detail: string; dropId?: string; messageId?: string }) =>
    addPin(room.id, user.uid, p).then(() => flash('Pinned to scrapbook')).catch((e) => flash(e.message));

  const turnOnPush = async () => {
    try {
      await enablePush(user.uid);
      setPush('granted');
      flash(`Notifications on. You'll hear when ${partner.name} messages.`);
    } catch (e: any) {
      setPush(await pushStatus());
      flash(e?.message || 'Could not turn on notifications.');
    }
  };
  const hideBanner = () => { setBannerHidden(true); try { localStorage.setItem(BANNER_KEY, '1'); } catch { /* ignore */ } };

  const myMood: MoodId = meMember?.mood || 'sunny';
  const pinnedDrops = useMemo(() => new Set(pins.map((p) => p.dropId).filter(Boolean)), [pins]);
  const pinnedMsgs = useMemo(() => new Set(pins.map((p) => p.messageId).filter(Boolean)), [pins]);
  const viewed = viewer ? messages?.find((m) => m.id === viewer) : undefined;
  const nameOf = (uid: string) => (uid === user.uid ? me.name : partner.name);

  return (
    <div class="app">
      <header class="hdr">
        <div class="avatar" aria-hidden="true">
          {partnerMember?.photoURL ? <img src={partnerMember.photoURL} alt="" referrerpolicy="no-referrer" /> : initial(partner.name)}
        </div>
        <div class="hdr-text">
          <div class="hdr-name">{partner.name}</div>
          <PartnerStatus member={partnerMember} joined={!!partnerUid} />
        </div>
        <button type="button" class="icon-btn" onClick={() => setSheet({ kind: 'mood' })} aria-label="Set your mood weather">
          <MoodIcon mood={myMood} />
        </button>
        <button type="button" class="icon-btn" onClick={() => setSheet({ kind: 'scrap' })} aria-label="Open scrapbook">
          <BookmarkIcon />
          {pins.length > 0 && <span class="badge">{pins.length}</span>}
        </button>
      </header>

      <Feed
        messages={messages}
        me={me}
        partner={partner}
        typing={<TypingIndicator member={partnerMember} name={partner.name} />}
        banner={
          !bannerHidden && (push === 'default' || push === 'needs-install') ? (
            <div class="sys-card">
              <span>{push === 'needs-install'
                ? `Add Drops to your Home Screen (Share → Add to Home Screen) to get notified when ${partner.name} messages.`
                : `Get a notification when ${partner.name} messages?`}</span>
              {push === 'default' && <button type="button" onClick={turnOnPush}>Turn on</button>}
              <button type="button" class="x" onClick={hideBanner} aria-label="Dismiss">✕</button>
            </div>
          ) : null
        }
        renderMessage={(m) => {
          const mine = m.uid === user.uid;
          if (m.kind === 'text') {
            return <div class={`row${mine ? ' me' : ''}`}><div class={`bubble ${mine ? 'mine' : 'theirs'}`}>{m.text}</div></div>;
          }
          if (m.kind === 'link' && m.link) {
            const fm = getDrop('feeling-map');
            return (
              <div class={`row${mine ? ' me' : ''}`}>
                <LinkCard msg={m} onFeel={fm ? () => startDrop(fm, { subject: cleanTitle(m.link!.title) || fm.content.subject }) : undefined} />
              </div>
            );
          }
          if (m.kind === 'photo' && m.photo) {
            return <div class={`row${mine ? ' me' : ''}`}><PhotoBubble msg={m} mine={mine} onView={() => setViewer(m.id)} /></div>;
          }
          if (m.kind === 'drop' && m.dropId) {
            const dropId = m.dropId;
            return (
              <DropCard
                roomId={room.id}
                dropId={dropId}
                me={me}
                partner={partner}
                pinned={pinnedDrops.has(dropId)}
                onPin={(title, detail) => pin({ title, detail, dropId })}
              />
            );
          }
          return null;
        }}
      />

      <footer class="composer">
        <button type="button" class="fab" onClick={() => setSheet({ kind: 'tray' })} aria-label="Add a Drop"><PlusIcon /></button>
        <button type="button" class="round-btn" onClick={pickPhoto} aria-label="Send a photo"><PhotoIcon /></button>
        <input ref={fileInput} type="file" accept="image/*" hidden onChange={onFile} />
        <label for="chat-input" class="sr">Message</label>
        <input
          id="chat-input"
          class="msg-input"
          value={draft}
          onInput={(e) => onDraft(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); send(); } }}
          placeholder="Message"
          autocomplete="off"
          enterKeyHint="send"
        />
        <button type="button" class="send-btn" onClick={send} aria-label="Send"><SendIcon /></button>
      </footer>

      {viewed && viewed.photo && (
        <PhotoViewer
          msg={viewed}
          from={viewed.uid === user.uid ? 'You' : partner.name}
          pinned={pinnedMsgs.has(viewed.id)}
          onPin={() => { pin({ title: `Photo from ${nameOf(viewed.uid)}`, detail: viewed.text || 'No caption', messageId: viewed.id }); setViewer(null); }}
          onClose={() => setViewer(null)}
        />
      )}

      {sheet && (
        <div class="sheet-wrap">
          <button type="button" class="scrim" onClick={() => setSheet(null)} aria-label="Close" />
          <div class="sheet" role="dialog" aria-modal="true">
            {sheet.kind === 'tray' && <TraySheet drops={drops} onPick={(d) => startDrop(d)} />}
            {sheet.kind === 'setup' && (() => {
              const def = getDrop(sheet.type);
              return def ? <SetupSheet def={def} prefill={sheet.prefill} onDrop={(c) => dropIt(def, c)} onBack={() => setSheet({ kind: 'tray' })} /> : null;
            })()}
            {sheet.kind === 'mood' && (
              <MoodSheet
                current={myMood}
                onPick={(m) => { setSheet(null); setMood(room.id, user.uid, m).catch((e) => flash(e.message)); }}
                push={push}
                onPush={turnOnPush}
                user={user}
                theme={theme}
                onTheme={(t) => { setTheme(t); chooseTheme(user.uid, t); }}
              />
            )}
            {sheet.kind === 'scrap' && <ScrapSheet pins={pins} nameOf={nameOf} />}
          </div>
        </div>
      )}

      {toast && <div class="toast" role="status">{toast}</div>}
    </div>
  );
}

const cleanTitle = (t: string | null | undefined) =>
  (t || '').replace(/\s*[-–|]\s*(YouTube|Vimeo|Netflix)$/i, '').replace(/\s*[-–]\s*Official.*$/i, '').trim().slice(0, 60);

// ---------------------------------------------------------------------------- feed

interface FeedProps {
  messages: Message[] | null;
  me: Person;
  partner: Person;
  typing: preact.ComponentChildren;
  banner: preact.ComponentChildren;
  renderMessage(m: Message): preact.ComponentChildren;
}

function Feed({ messages, me, partner, typing, banner, renderMessage }: FeedProps) {
  const scroller = useRef<HTMLElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lastCount = useRef(0);

  // Keep the view pinned to the bottom while the user is there — including when
  // a Drop grows (new story line, reveal) without a new message arriving.
  useEffect(() => {
    const el = scroller.current;
    const box = inner.current;
    if (!el || !box) return;
    const onScroll = () => { stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120; };
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(() => { if (stick.current) el.scrollTop = el.scrollHeight; });
    ro.observe(box);
    return () => { el.removeEventListener('scroll', onScroll); ro.disconnect(); };
  }, []);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !messages) return;
    const last = messages[messages.length - 1];
    if (messages.length !== lastCount.current && (stick.current || last?.uid === me.uid || lastCount.current === 0)) {
      el.scrollTop = el.scrollHeight;
      stick.current = true;
    }
    lastCount.current = messages.length;
  }, [messages]);

  let lastDay = '';
  return (
    <main class="feed" ref={scroller}>
      <div class="feed-inner" ref={inner}>
        {banner}
        {messages === null && <div class="sys">Loading…</div>}
        {messages && messages.length === 0 && (
          <>
            <div class="day-pill">Today</div>
            <div class="row center"><div class="sys">
              {partner.uid ? `Say hi to ${partner.name}.` : `${partner.name} hasn't joined yet — you can start anyway.`} Tap + to drop a Feeling Map, Blind Reveal, Gap Slider or Story.
            </div></div>
          </>
        )}
        {messages?.map((m) => {
          const day = dayLabel(toMillis(m.createdAt));
          const pill = day !== lastDay ? <div class="day-pill">{day}</div> : null;
          lastDay = day;
          return <div key={m.id} style={{ display: 'contents' }}>{pill}{renderMessage(m)}</div>;
        })}
        {typing}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------- live bits

function useNow(ms: number, active = true) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, active]);
  return now;
}

function PartnerStatus({ member, joined }: { member?: Member; joined: boolean }) {
  const now = useNow(30_000);
  if (!joined) return <div class="hdr-sub">Invite sent · not joined yet</div>;
  const mood = member?.mood ? MOODS.find((m) => m.id === member.mood) : undefined;
  const seen = lastSeenLabel(member?.lastSeen ? member.lastSeen.toMillis() : null, now);
  return (
    <div class="hdr-sub">
      {mood && <MoodIcon mood={mood.id} size={15} />}
      {mood ? `${mood.label} today · ${seen}` : seen}
    </div>
  );
}

function TypingIndicator({ member, name }: { member?: Member; name: string }) {
  const until = member?.typingUntil ? member.typingUntil.toMillis() : 0;
  const now = useNow(1000, until > Date.now());
  if (until <= now) return null;
  return <div class="row"><div class="bubble theirs typing">{name} is typing…</div></div>;
}
