import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { User } from 'firebase/auth';
import {
  addPhraseReaction, createDrop, deleteForEveryone, editMessage, hideMessage, removePhraseReaction, sendPhoto, sendText,
  setReaction, watchMessages,
} from '../data/messages';
import { addPin, watchPins } from '../data/pins';
import { GENERAL, createTab, ensureGeneralTab, markRead, updateTab, watchTabs } from '../data/tabs';
import { ensureMember, heartbeat, setMood, setTyping, watchMembers } from '../data/rooms';
import { AddContactSheet } from './AddContactSheet';
import { ActionSheet, DeleteSheet, PhraseSheet, PhraseText, ReactionChips, ReplyQuote, useLongPress } from './MessageActions';
import { canEdit, copyText, snippetOf, visibleTo } from '../lib/messages';
import { usePullToRefresh } from './PullToRefresh';
import { enablePush, pushStatus, type PushStatus } from '../data/push';
import { chooseTheme } from '../data/prefs';
import { currentPrefs, onThemeChange, type ThemePrefs } from '../lib/themes';
import { ModeToggle } from './ModeToggle';
import { drops, getDrop } from '../drops/registry';
import type { DropDefinition, Person } from '../drops/types';
import { firstName, initial } from '../lib/names';
import { dayLabel, lastSeenLabel, toMillis } from '../lib/time';
import type { Member, Message, MoodId, Pin, ReactionCode, ReplyRef, Room, Tab } from '../types';
import { DropCard } from './DropCard';
import { LinkCard, PhotoBubble, PhotoViewer } from './Bubbles';
import { MoodSheet, ScrapSheet, SettingsSheet, SetupSheet, TraySheet } from './Sheets';
import { ArchivedSheet, TabBar, TabSheet } from './Tabs';
import { BackIcon, BookmarkIcon, XIcon, MoodIcon, MOODS, PhotoIcon, PlusIcon, SendIcon, SettingsIcon } from './icons';

type Sheet =
  | null
  | { kind: 'tray' }
  | { kind: 'mood' }
  | { kind: 'settings' }
  | { kind: 'scrap' }
  | { kind: 'setup'; type: string; prefill?: Record<string, unknown> }
  | { kind: 'tab-new' }
  | { kind: 'tab-edit'; tabId: string }
  | { kind: 'archived' }
  | { kind: 'invite' }
  | { kind: 'actions'; msgId: string }
  | { kind: 'delete'; ids: string[] }
  | { kind: 'phrase'; msgId: string };

interface Toast { text: string; undo?: () => void }

async function copyToClipboard(text: string) {
  try { await navigator.clipboard.writeText(text); return; } catch { /* fall back below */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
}

const BANNER_KEY = 'drops.pushBannerDismissed';
const tabKey = (roomId: string) => `hi.tab.${roomId}`;

/** Tab to open: ?tab= (from a notification), else the last one used on this device. */
function initialTab(roomId: string): string {
  const fromUrl = new URLSearchParams(location.search).get('tab');
  if (fromUrl) return fromUrl;
  try { return localStorage.getItem(tabKey(roomId)) || GENERAL; } catch { return GENERAL; }
}

export function Chat({ user, room, onBack }: { user: User; room: Room; onBack(): void }) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTab, setActiveTab] = useState<string>(() => initialTab(room.id));
  const [members, setMembers] = useState<Record<string, Member>>({});
  const [pins, setPins] = useState<Pin[]>([]);
  // dropId → Drop type, reported by each Drop card (for reply / pin / list previews).
  const [dropTypes, setDropTypes] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState('');
  const [sheet, setSheet] = useState<Sheet>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const [toast, setToastState] = useState<Toast | null>(null);
  const [replyTo, setReplyTo] = useState<ReplyRef | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [highlight, setHighlight] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [theme, setTheme] = useState<ThemePrefs>(currentPrefs);
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
    name: partnerUid ? firstName(partnerMember?.name, 'Them') : room.invites[0] ? firstName(room.invites[0], 'Them') : 'Just you',
    isMe: false,
  }), [partnerUid, partnerMember?.name, room.invites[0]]);

  // --- subscriptions ---------------------------------------------------------
  useEffect(() => {
    ensureMember(room.id, user).catch(console.warn);
    let repaired = false;
    const unsubs = [
      watchTabs(room.id, (t, fromServer) => {
        setTabs(t);
        // Older rooms may lack a General tab: create it once the server confirms it's missing.
        if (fromServer && !repaired && !t.some((x) => x.id === GENERAL)) { repaired = true; ensureGeneralTab(room.id, user.uid); }
      }, (e) => flash(e.message)),
      watchMembers(room.id, setMembers, (e) => console.warn('members', e)),
      watchPins(room.id, setPins, (e) => console.warn('pins', e)),
    ];
    return () => unsubs.forEach((u) => u());
  }, [room.id, user.uid]);

  // If the saved/linked tab doesn't exist (any more), fall back to General.
  useEffect(() => {
    if (tabs.length && !tabs.some((t) => t.id === activeTab)) setActiveTab(GENERAL);
  }, [tabs, activeTab]);

  // Messages of the open tab.
  useEffect(() => {
    setMessages(null);
    try { localStorage.setItem(tabKey(room.id), activeTab); } catch { /* ignore */ }
    if (location.search.includes('tab=')) history.replaceState(null, '', location.pathname);
    return watchMessages(room.id, activeTab, setMessages, (e) => flash(e.message));
  }, [room.id, activeTab]);

  // Mark the open tab read when it opens and whenever new messages arrive while visible.
  useEffect(() => {
    if (!messages || document.visibilityState !== 'visible') return;
    markRead(room.id, user.uid, activeTab).catch(() => {});
  }, [room.id, activeTab, messages?.length]);
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') markRead(room.id, user.uid, activeTab).catch(() => {}); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [room.id, activeTab]);

  // presence heartbeat while the app is in front
  useEffect(() => {
    const beat = () => { if (document.visibilityState === 'visible') heartbeat(room.id, user.uid).catch(() => {}); };
    const t = setInterval(beat, 60_000);
    document.addEventListener('visibilitychange', beat);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', beat); };
  }, [room.id, user.uid]);

  useEffect(() => { pushStatus().then(setPush); }, []);
  useEffect(() => onThemeChange((p) => setTheme(p)), []);

  // Escape closes any open sheet, else leaves select mode.
  useEffect(() => {
    if (!sheet && !selected) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (sheet) setSheet(null); else setSelected(null); } };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [!!sheet, !!selected]);

  const toastTimer = useRef<number | null>(null);
  function showToast(t: Toast | null, ms = 4000) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToastState(t);
    if (t) toastTimer.current = window.setTimeout(() => setToastState(null), ms);
  }
  const flash = (text: string) => showToast({ text });
  const setToast = (text: string) => showToast(text ? { text } : null);

  // --- actions ---------------------------------------------------------------
  const onDraft = (v: string) => {
    setDraft(v);
    const now = Date.now();
    if (v && now - lastTypingWrite.current > 3000) {
      lastTypingWrite.current = now;
      setTyping(room.id, user.uid, activeTab, true).catch(() => {});
    }
  };

  // A brand-new room's tab may still be being created; messages need it to exist.
  const tabReady = tabs.some((t) => t.id === activeTab);
  const notReady = () => { flash('One moment — setting up your room…'); };

  // If you hit send before a brand-new tab has loaded, keep the message and send it
  // the moment the tab is ready instead of refusing it.
  const queued = useRef<string | null>(null);
  useEffect(() => {
    if (!tabReady || queued.current == null) return;
    const t = queued.current;
    queued.current = null;
    sendText(room.id, activeTab, user.uid, t).catch((e) => { setDraft(t); flash(e.message); });
  }, [tabReady, activeTab]);

  const send = () => {
    const t = draft.trim();
    if (!t) return;
    if (editing) {
      const m = editing;
      setEditing(null);
      setDraft('');
      editMessage(room.id, m, t, room.lastMessage).catch((e) => { flash(e?.code === 'permission-denied' ? 'Too late to edit — messages can be edited for 15 minutes.' : e.message); });
      return;
    }
    if (!tabReady) { queued.current = t; setDraft(''); return; }
    const reply = replyTo;
    setDraft('');
    setReplyTo(null);
    lastTypingWrite.current = 0;
    setTyping(room.id, user.uid, activeTab, false).catch(() => {});
    sendText(room.id, activeTab, user.uid, t, reply).catch((e) => { setDraft(t); setReplyTo(reply); flash(e.message); });
  };

  const pickPhoto = () => fileInput.current?.click();
  const onFile = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!tabReady) return notReady();
    const caption = draft;
    setDraft('');
    flash('Sending photo…');
    try {
      await sendPhoto(room.id, activeTab, user.uid, file, caption);
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
    if (!tabReady) return notReady();
    try {
      await createDrop(room.id, activeTab, user.uid, def.type, content, def.initialEntries?.(content) || [], `a ${def.title}`);
    } catch (e: any) {
      flash(e?.message || 'Could not drop that.');
    }
  };

  const pin = (p: { title: string; detail: string; dropId?: string; messageId?: string }) =>
    addPin(room.id, user.uid, { ...p, tabId: activeTab }).then(() => flash('Pinned to scrapbook')).catch((e) => flash(e.message));

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
  const quoteName = (uid: string) => (uid === user.uid ? 'You' : partner.name);
  const tabName = (id: string | null) => tabs.find((t) => t.id === id)?.name || '';
  const currentTab = tabs.find((t) => t.id === activeTab);

  // Total unread across other tabs → app icon badge (where supported).
  const setUnreadTotal = (n: number) => {
    const nav = navigator as any;
    if (n > 0) nav.setAppBadge?.(n).catch?.(() => {}); else nav.clearAppBadge?.().catch?.(() => {});
  };
  // --- message actions ---------------------------------------------------------
  const shown = useMemo(() => (messages ? visibleTo(messages, user.uid) : null), [messages, user.uid]);
  const byId = (id: string) => messages?.find((m) => m.id === id);
  const dropTitle = (m: Message) => `a ${(m.dropId && dropTypes[m.dropId] && getDrop(dropTypes[m.dropId])?.title) || 'Drop'}`;
  const snip = (m: Message) => snippetOf(m, dropTitle(m));
  const isEditable = (m: Message) => canEdit({ ...m, createdMs: toMillis(m.createdAt) }, user.uid);

  const openActions = (m: Message) => { if (!selected) setSheet({ kind: 'actions', msgId: m.id }); };
  const startReply = (m: Message) => {
    setSheet(null);
    setEditing(null);
    setReplyTo({ msgId: m.id, snippet: snip(m), senderId: m.uid });
    inputRef.current?.focus();
  };
  const startEdit = (m: Message) => {
    setSheet(null);
    setReplyTo(null);
    setEditing(m);
    setDraft(m.text);
    inputRef.current?.focus();
  };
  const cancelCompose = () => { if (editing) setDraft(''); setEditing(null); setReplyTo(null); };
  const copyMsgs = async (ms: Message[]) => {
    const text = ms.map(copyText).filter(Boolean).join('\n');
    if (!text) return flash('Nothing to copy');
    await copyToClipboard(text);
    flash('Copied');
  };
  const pinMsgs = async (ms: Message[]) => {
    const todo = ms.filter((m) => !m.deleted && m.kind !== 'drop' && !pinnedMsgs.has(m.id));
    try {
      await Promise.all(todo.map((m) => addPin(room.id, user.uid, { title: nameOf(m.uid), detail: snip(m), messageId: m.id, tabId: activeTab })));
      flash(todo.length ? 'Pinned to scrapbook' : 'Already pinned');
    } catch (e: any) { flash(e.message); }
  };
  const react = (m: Message, code: ReactionCode, on: boolean) =>
    setReaction(room.id, m, user.uid, code, on).catch((e) => flash(e.message));
  const hideMsgs = async (ms: Message[]) => {
    setSheet(null);
    setSelected(null);
    try {
      await Promise.all(ms.map((m) => hideMessage(room.id, m, user.uid, true)));
      showToast({
        text: ms.length > 1 ? `${ms.length} messages deleted for you` : 'Deleted for you',
        undo: () => { showToast(null); Promise.all(ms.map((m) => hideMessage(room.id, m, user.uid, false))).catch((e) => flash(e.message)); },
      }, 5000);
    } catch (e: any) { flash(e.message); }
  };
  const deleteForAll = async (ms: Message[]) => {
    setSheet(null);
    setSelected(null);
    try {
      for (const m of ms) await deleteForEveryone(room.id, m, room.lastMessage);
      flash(ms.length > 1 ? 'Messages deleted' : 'Message deleted');
    } catch (e: any) { flash(e.message); }
  };
  const jumpTo = (msgId: string) => {
    const el = document.getElementById(`m-${msgId}`);
    if (!el) return flash('The original message isn’t loaded here.');
    el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    setHighlight(msgId);
    setTimeout(() => setHighlight((h) => (h === msgId ? '' : h)), 1600);
  };
  const toggleSelect = (id: string) => setSelected((s0) => {
    const s1 = new Set(s0 || []);
    if (s1.has(id)) s1.delete(id); else s1.add(id);
    return s1;
  });
  const selectedMsgs = selected ? (shown || []).filter((m) => selected.has(m.id)) : [];

  const saveNewTab = async (name: string, colour: string) => {
    setSheet(null);
    try {
      const order = Math.max(0, ...tabs.map((t) => t.order)) + 1;
      setActiveTab(await createTab(room.id, user.uid, name, colour, order));
    } catch (e: any) { flash(e?.message || 'Could not create the tab.'); }
  };

  return (
    <div class="app">
      <header class="hdr">
        <button type="button" class="back-btn" onClick={onBack} aria-label="Back to chats"><BackIcon /></button>
        <div class="avatar" aria-hidden="true">
          {partnerMember?.photoURL ? <img src={partnerMember.photoURL} alt="" referrerpolicy="no-referrer" /> : initial(partner.name)}
        </div>
        <div class="hdr-text">
          <div class="hdr-name-row">
            <span class="hdr-name">{partner.name}</span>
            {partnerUid && partnerMember?.mood && (
              <span class="their-mood" role="img" aria-label={`${partner.name}'s mood: ${MOODS.find((m) => m.id === partnerMember.mood)?.label}`}>
                <MoodIcon mood={partnerMember.mood} size={22} />
              </span>
            )}
          </div>
          <PartnerStatus member={partnerMember} joined={!!partnerUid} invited={room.invites[0] || ''} />
        </div>
        <div class="hdr-actions">
          <button type="button" class="icon-btn" onClick={() => setSheet({ kind: 'mood' })}
            aria-label={`Your mood weather: ${MOODS.find((m) => m.id === myMood)?.label}. Change it`}>
            <MoodIcon mood={myMood} size={24} />
          </button>
          <ModeToggle uid={user.uid} />
          <button type="button" class="icon-btn" onClick={() => setSheet({ kind: 'settings' })} aria-label="Settings">
            <SettingsIcon />
          </button>
        <button type="button" class="icon-btn" onClick={() => setSheet({ kind: 'scrap' })} aria-label="Open scrapbook">
          <BookmarkIcon />
          {pins.length > 0 && <span class="badge">{pins.length}</span>}
          </button>
        </div>
      </header>

      <TabBar
        roomId={room.id}
        me={user.uid}
        tabs={tabs}
        active={activeTab}
        lastRead={meMember?.lastRead || {}}
        onSelect={setActiveTab}
        onOptions={(tabId) => setSheet({ kind: 'tab-edit', tabId })}
        onAdd={() => setSheet({ kind: 'tab-new' })}
        onArchived={() => setSheet({ kind: 'archived' })}
        onUnreadTotal={setUnreadTotal}
      />

      <Feed
        messages={shown}
        me={me}
        partner={partner}
        typing={<TypingIndicator member={partnerMember} name={partner.name} tabId={activeTab} />}
        tabName={currentTab && currentTab.id !== GENERAL ? currentTab.name : ''}
        banner={<>
          {!partnerUid && (
            <div class="sys-card">
              <span>{room.invites[0]
                ? `Waiting for ${room.invites[0]} to join. Send them the link so they can sign in with that e-mail.`
                : 'It’s just you here for now. Invite someone when you’re ready.'}</span>
              <button type="button" onClick={() => setSheet({ kind: 'invite' })}>{room.invites[0] ? 'Invite' : 'Invite someone'}</button>
            </div>
          )}
          {partnerUid && !bannerHidden && (push === 'default' || push === 'needs-install') ? (
            <div class="sys-card">
              <span>{push === 'needs-install'
                ? `Add Drops to your Home Screen (Share → Add to Home Screen) to get notified when ${partner.name} messages.`
                : `Get a notification when ${partner.name} messages?`}</span>
              {push === 'default' && <button type="button" onClick={turnOnPush}>Turn on</button>}
              <button type="button" class="x" onClick={hideBanner} aria-label="Dismiss">✕</button>
            </div>
          ) : null}
        </>}
        renderMessage={(m) => {
          const mine = m.uid === user.uid;
          let body: preact.ComponentChildren = null;
          if (m.deleted) {
            body = <div class={`bubble ${mine ? 'mine' : 'theirs'} deleted`}>Message deleted</div>;
          } else if (m.kind === 'text') {
            body = (
              <div class={`bubble ${mine ? 'mine' : 'theirs'}`}>
                {m.replyTo && <ReplyQuote reply={m.replyTo} name={quoteName(m.replyTo.senderId)} mine={mine} onJump={() => jumpTo(m.replyTo!.msgId)} />}
                <PhraseText text={m.text} phrases={m.phraseReactions} me={user.uid} nameOf={nameOf}
                  onRemove={(p) => removePhraseReaction(room.id, m, p).catch((e) => flash(e.message))} />
                {m.editedAt && <span class="edited"> · edited</span>}
              </div>
            );
          } else if (m.kind === 'link' && m.link) {
            const fm = getDrop('feeling-map');
            body = (<>
              {m.replyTo && <ReplyQuote reply={m.replyTo} name={quoteName(m.replyTo.senderId)} mine={false} onJump={() => jumpTo(m.replyTo!.msgId)} />}
              <LinkCard msg={m} onFeel={fm ? () => startDrop(fm, { subject: cleanTitle(m.link!.title) || fm.content.subject }) : undefined} />
            </>);
          } else if (m.kind === 'photo' && m.photo) {
            body = <PhotoBubble msg={m} mine={mine} onView={() => setViewer(m.id)} />;
          } else if (m.kind === 'drop' && m.dropId) {
            const dropId = m.dropId;
            body = (
              <DropCard
                roomId={room.id}
                dropId={dropId}
                me={me}
                partner={partner}
                pinned={pinnedDrops.has(dropId)}
                onPin={(title, detail) => pin({ title, detail, dropId })}
                onType={(type) => setDropTypes((t) => (t[dropId] === type ? t : { ...t, [dropId]: type }))}
              />
            );
          }
          if (!body) return null;
          return (
            <MsgRow
              msg={m}
              mine={mine}
              wide={m.kind === 'drop' && !m.deleted}
              selecting={!!selected}
              selected={!!selected?.has(m.id)}
              highlight={highlight === m.id}
              onActions={() => openActions(m)}
              onToggle={() => toggleSelect(m.id)}
            >
              {body}
              <ReactionChips msg={m} me={user.uid} onToggle={(code, on) => react(m, code, on)} />
            </MsgRow>
          );
        }}
      />

      {selected ? (
        <footer class="composer select-bar" aria-label="Selected messages">
          <button type="button" class="round-btn" onClick={() => setSelected(null)} aria-label="Cancel selection"><XIcon /></button>
          <span class="select-count" role="status">{selected.size} selected</span>
          <button type="button" class="chip-btn" disabled={!selectedMsgs.length} onClick={() => copyMsgs(selectedMsgs)}>Copy</button>
          <button type="button" class="chip-btn" disabled={!selectedMsgs.length} onClick={() => pinMsgs(selectedMsgs)}>Pin</button>
          <button type="button" class="chip-btn danger-text" disabled={!selectedMsgs.length} onClick={() => setSheet({ kind: 'delete', ids: selectedMsgs.map((m) => m.id) })}>Delete</button>
        </footer>
      ) : (<>
      {(replyTo || editing) && (
        <div class="compose-strip" role="status">
          <span class={`strip-bar${(editing || replyTo!.senderId === user.uid) ? ' me' : ''}`} aria-hidden="true" />
          <span class="strip-text">
            <span class="strip-title">{editing ? 'Editing message' : `Replying to ${replyTo!.senderId === user.uid ? 'yourself' : nameOf(replyTo!.senderId)}`}</span>
            <span class="strip-snip">{editing ? snip(editing) : replyTo!.snippet}</span>
          </span>
          <button type="button" class="strip-x" onClick={cancelCompose} aria-label={editing ? 'Cancel editing' : 'Cancel reply'}><XIcon /></button>
        </div>
      )}
      <footer class="composer">
        <button type="button" class="fab" onClick={() => setSheet({ kind: 'tray' })} aria-label="Add a Drop"><PlusIcon /></button>
        <button type="button" class="round-btn" onClick={pickPhoto} aria-label="Send a photo"><PhotoIcon /></button>
        <input ref={fileInput} type="file" accept="image/*" hidden onChange={onFile} />
        <label for="chat-input" class="sr">Message</label>
        <input
          ref={inputRef}
          id="chat-input"
          class="msg-input"
          value={draft}
          onInput={(e) => onDraft(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); send(); } }}
          placeholder="Message"
          autocomplete="off"
          enterKeyHint="send"
        />
        <button type="button" class="send-btn" onClick={send} aria-label={editing ? 'Save edit' : 'Send'}><SendIcon /></button>
      </footer>
      </>)}

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
              />
            )}
            {sheet.kind === 'settings' && (
              <SettingsSheet
                user={user}
                prefs={theme}
                onTheme={(t) => { setTheme(t); chooseTheme(user.uid, t); }}
                push={push}
                onPush={turnOnPush}
              />
            )}
            {sheet.kind === 'scrap' && <ScrapSheet pins={pins} nameOf={nameOf} tabName={tabName} />}
            {sheet.kind === 'tab-new' && <TabSheet onSave={saveNewTab} />}
            {sheet.kind === 'tab-edit' && (() => {
              const t = tabs.find((x) => x.id === sheet.tabId);
              return t ? (
                <TabSheet
                  key={t.id}
                  tab={t}
                  onSave={(name, colour) => { setSheet(null); updateTab(room.id, t.id, { name, colour }).catch((e) => flash(e.message)); }}
                  onArchive={(archived) => {
                    setSheet(null);
                    updateTab(room.id, t.id, { archived }).catch((e) => flash(e.message));
                    if (archived) setActiveTab(GENERAL);
                  }}
                />
              ) : null;
            })()}
            {sheet.kind === 'invite' && (
              <AddContactSheet user={user} room={room} onToast={flash} onClose={() => setSheet(null)} />
            )}
            {sheet.kind === 'actions' && (() => {
              const m = byId(sheet.msgId);
              if (!m) return null;
              const mine = m.uid === user.uid;
              const mineRx = (Object.entries(m.reactions || {}) as [ReactionCode, string[]][]).filter(([, u]) => u.includes(user.uid)).map(([c]) => c);
              return (
                <ActionSheet
                  msg={m}
                  preview={`${mine ? 'You' : nameOf(m.uid)}: ${snip(m)}`}
                  canEdit={isEditable(m)}
                  canCopy={!!copyText(m)}
                  canPin={m.kind !== 'drop'}
                  pinned={pinnedMsgs.has(m.id)}
                  myReactions={mineRx}
                  onReact={(code) => { setSheet(null); react(m, code, !mineRx.includes(code)); }}
                  onPhrase={m.kind === 'text' && m.text.trim() ? () => setSheet({ kind: 'phrase', msgId: m.id }) : undefined}
                  onReply={() => startReply(m)}
                  onCopy={() => { setSheet(null); copyMsgs([m]); }}
                  onPin={() => { setSheet(null); pinMsgs([m]); }}
                  onEdit={() => startEdit(m)}
                  onSelect={() => { setSheet(null); setSelected(new Set([m.id])); }}
                  onDelete={() => setSheet({ kind: 'delete', ids: [m.id] })}
                />
              );
            })()}
            {sheet.kind === 'delete' && (() => {
              const ms = sheet.ids.map(byId).filter(Boolean) as Message[];
              return (
                <DeleteSheet
                  count={ms.length}
                  allMine={ms.length > 0 && ms.every((m) => m.uid === user.uid && !m.deleted)}
                  onForMe={() => hideMsgs(ms)}
                  onForEveryone={() => deleteForAll(ms)}
                  onCancel={() => setSheet(null)}
                />
              );
            })()}
            {sheet.kind === 'phrase' && (() => {
              const m = byId(sheet.msgId);
              return m ? (
                <PhraseSheet text={m.text} onReact={(start, end, reaction) => {
                  setSheet(null);
                  addPhraseReaction(room.id, m, { uid: user.uid, start, end, reaction }).catch((e) => flash(e.message));
                }} />
              ) : null;
            })()}
            {sheet.kind === 'archived' && (
              <ArchivedSheet
                tabs={tabs}
                onOpen={(id) => { setSheet(null); setActiveTab(id); }}
                onUnarchive={(id) => updateTab(room.id, id, { archived: false }).catch((e) => flash(e.message))}
              />
            )}
          </div>
        </div>
      )}

      {toast && (
        <div class="toast" role="status">
          <span>{toast.text}</span>
          {toast.undo && <button type="button" class="toast-btn" onClick={toast.undo}>Undo</button>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------- one message

interface RowProps {
  msg: Message;
  mine: boolean;
  /** Drop cards use the full width. */
  wide: boolean;
  selecting: boolean;
  selected: boolean;
  highlight: boolean;
  onActions(): void;
  onToggle(): void;
  children: preact.ComponentChildren;
}

/** A message with its long-press menu, tick circle in select mode, and a ⋯ button for mouse/keyboard. */
function MsgRow({ msg, mine, wide, selecting, selected, highlight, onActions, onToggle, children }: RowProps) {
  const lp = useLongPress(onActions, !selecting);
  const pickInstead = (e: MouseEvent) => {
    if (!selecting) return lp.onClickCapture(e);
    e.preventDefault();
    e.stopPropagation();
    onToggle();
  };
  return (
    <div
      id={`m-${msg.id}`}
      class={`msg${mine ? ' me' : ''}${wide ? ' wide' : ''}${selecting ? ' selecting' : ''}${selected ? ' sel' : ''}${highlight ? ' flash' : ''}`}
      {...lp}
      onClickCapture={pickInstead}
    >
      {selecting && (
        <span class={`tick${selected ? ' on' : ''}`} role="checkbox" aria-checked={selected} tabIndex={0}
          aria-label={selected ? 'Selected' : 'Select message'}
          onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onToggle(); } }} />
      )}
      <div class="msg-body">{children}</div>
      {!selecting && (
        <button type="button" class="msg-more" onClick={onActions} aria-label="Message actions">
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
        </button>
      )}
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
  /** Name of the open tab when it isn't General (for the empty state). */
  tabName: string;
  renderMessage(m: Message): preact.ComponentChildren;
}

function Feed({ messages, me, partner, typing, banner, tabName, renderMessage }: FeedProps) {
  const scroller = useRef<HTMLElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lastCount = useRef(0);
  const pullIndicator = usePullToRefresh(scroller);

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
      {pullIndicator}
      <div class="feed-inner" ref={inner}>
        {banner}
        {messages === null && <div class="sys">Loading…</div>}
        {messages && messages.length === 0 && (
          <>
            <div class="day-pill">Today</div>
            <div class="row center"><div class="sys">
              {tabName
                ? `This is "${tabName}". Keep everything about it here. `
                : partner.uid ? `Say hi to ${partner.name}. ` : `${partner.name} hasn't joined yet — you can start anyway. `}
              Tap + to drop a Feeling Map, Blind Reveal, Gap Slider or Story.
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

function PartnerStatus({ member, joined, invited }: { member?: Member; joined: boolean; invited: string }) {
  const now = useNow(30_000);
  if (!joined) return <div class="hdr-sub">{invited ? 'Invite sent · not joined yet' : 'No one invited yet'}</div>;
  const mood = member?.mood ? MOODS.find((m) => m.id === member.mood) : undefined;
  const seen = lastSeenLabel(member?.lastSeen ? member.lastSeen.toMillis() : null, now);
  return <div class="hdr-sub">{mood ? `${mood.label} · ${seen}` : seen}</div>;
}

function TypingIndicator({ member, name, tabId }: { member?: Member; name: string; tabId: string }) {
  const here = !member?.typingTab || member.typingTab === tabId;
  const until = here && member?.typingUntil ? member.typingUntil.toMillis() : 0;
  const now = useNow(1000, until > Date.now());
  if (until <= now) return null;
  return <div class="row"><div class="bubble theirs typing">{name} is typing…</div></div>;
}
