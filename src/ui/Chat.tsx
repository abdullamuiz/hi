import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { User } from 'firebase/auth';
import {
  addPhraseReaction, addVoiceReaction, createDrop, deleteForEveryone, editMessage, hideMessage, markPlayed, removePhraseReaction,
  removeVoiceReaction, sendPhoto, sendText, sendVoice, setDisappearing, setReaction, watchMessages, type VoiceRecording,
} from '../data/messages';
import { notExpired, systemText } from '../lib/disappear';
import { takeJump, type Jump } from '../lib/jump';
import { SearchSheet } from './Search';
import { ExportSheet } from './Export';
import type { SearchFilter } from '../lib/search';
import { addPin, moveTopPinToScrapbook, pinToTop, unpinFromTop, watchCountdowns, watchPins, type CountdownDrop, type NewPin } from '../data/pins';
import { topOrder } from '../lib/scrapbook';
import { Scrapbook } from './Scrapbook';
import { CountdownBanner, PinFullSheet, PinnedBar } from './TopBars';
import { GENERAL, createTab, ensureGeneralTab, updateTab, watchTabs } from '../data/tabs';
import { cancelScheduled, deliverScheduled, markRead, readUpTo, scheduleMessage, updateScheduled, useDeliveryPrefs, useMyReads } from '../data/delivery';
import { parseFailed, statuses, type Failed } from '../lib/delivery';
import { isMuted, muteFor, urgentLeft as urgentLeftOf, whenLabel } from '../lib/schedule';
import { FailedRow, ScheduledStrip, ScheduleSheet, SendOptionsSheet, StatusMark } from './Delivery';
import { Timestamp, type WriteBatch } from 'firebase/firestore';
import { lockInBatch } from '../data/drops';
import { ensureMember, heartbeat, makeSelfRoom, setMood, setTyping, watchMembers } from '../data/rooms';
import { AddContactSheet } from './AddContactSheet';
import { ActionSheet, DeleteSheet, PhraseSheet, PhraseText, ReactionChips, ReplyQuote, useLongPress } from './MessageActions';
import { canEdit, copyText, snippetOf, visibleTo } from '../lib/messages';
import { usePullToRefresh } from './PullToRefresh';
import { enablePush, pushStatus, type PushStatus } from '../data/push';
import { chooseTheme } from '../data/prefs';
import { currentPrefs, onThemeChange, type ThemePrefs } from '../lib/themes';
import { ModeToggle } from './ModeToggle';
import { drops, getDrop, trayDrops } from '../drops/registry';
import type { DropDefinition, Person } from '../drops/types';
import { firstName } from '../lib/names';
import { blockContact, deleteRoom, leaveRoom, setContact, unblock, type Blocked, type ContactPrefs } from '../data/profile';
import { displayName, noteLabel } from '../lib/profile';
import { Avatar, ContactSheet, DeleteAccountSheet, ProfileForm, useProfile } from './Profile';
import { dayLabel, lastSeenLabel, toMillis } from '../lib/time';
import type { Member, Message, MoodId, Pin, ReactionCode, ReplyRef, Room, Scheduled, Tab, TopPin } from '../types';
import { DropCard } from './DropCard';
import { ThreadTile, ThreadView } from './Thread';
import { DailyBanner } from './Daily';
import { MilestoneCard, OnThisDayCard, RewindScreen, StreakChip, StreakInvite, StreakSheet, useStreak } from './Memories';
import { countMessages, ensureMonthlyRewind, findOnThisDay, setRoomZone, type Memory } from '../data/memories';
import { nextMilestone, reachedMilestones, type Milestone } from '../lib/milestones';
import { rewindPeriod, type RewindPeriod } from '../lib/rewind';
import { dayKeyIn } from '../lib/streak';
import { OPEN_REWIND } from '../drops/rewind.drop';
import { OPEN_SESSION } from '../drops/session.drop';
import { SessionScreen } from './Session';
import { startSession } from '../data/sessions';
import { trayTests } from '../sessions/registry';
import type { SessionTest } from '../sessions/types';
import { ensureDailyQuestion, roomDayKey } from '../data/daily';
import { MicIcon, RecordBar, VoiceBubble, useVoiceRecorder } from './Voice';
import { LinkCard, PhotoBubble, PhotoViewer } from './Bubbles';
import { EffectArmed, EffectsSheet, EffectSuggestion, EffectTag, EffectText, isCanvasEffect, playScreen } from './Effects';
import { loadPlayed, motionOn, pickArrival, previewFor, savePlayed, suggestEffect, type EffectCode } from '../lib/effects';
import { MoodSheet, SettingsSheet, SetupSheet, TraySheet } from './Sheets';
import { ArchivedSheet, TabBar, TabSheet } from './Tabs';
import { BackIcon, BookmarkIcon, XIcon, MoodIcon, MOODS, PhotoIcon, PlusIcon, SendIcon, SettingsIcon } from './icons';

type Sheet =
  | null
  | { kind: 'tray' }
  | { kind: 'mood' }
  | { kind: 'settings' }
  | { kind: 'pin-full'; msgId: string }
  | { kind: 'setup'; type: string; prefill?: Record<string, unknown> }
  | { kind: 'tab-new' }
  | { kind: 'tab-edit'; tabId: string }
  | { kind: 'archived' }
  | { kind: 'invite' }
  | { kind: 'actions'; msgId: string }
  | { kind: 'delete'; ids: string[] }
  | { kind: 'phrase'; msgId: string }
  | { kind: 'contact' }
  | { kind: 'profile' }
  | { kind: 'delete-account' }
  | { kind: 'send-options' }
  | { kind: 'effects' }
  | { kind: 'schedule'; id?: string }
  | { kind: 'search'; filter?: SearchFilter }
  | { kind: 'export' }
  | { kind: 'streak' }
  | { kind: 'self-info' };

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

interface ChatProps {
  user: User;
  room: Room;
  /** My private nicknames / mutes. */
  contacts: Record<string, ContactPrefs>;
  blocked: Blocked[];
  /** My scheduled messages in this chat (sent on time by the app / the server). */
  scheduled?: Scheduled[];
  onBack(): void;
}

const failedKey = (roomId: string) => `hi.failed.${roomId}`;

export function Chat({ user, room, contacts, blocked, scheduled = [], onBack }: ChatProps) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  // A search result (here or on the chat list) can ask this chat to open at a message.
  const [jump, setJump] = useState<Jump | null>(() => takeJump(room.id));
  const [activeTab, setActiveTabState] = useState<string>(() => jump?.tabId || initialTab(room.id));
  // Read the open tab from this time on (instead of only its latest messages), to reach an older message.
  const [windowFrom, setWindowFrom] = useState<number | null>(null);
  const setActiveTab = (id: string) => { setWindowFrom(null); setActiveTabState(id); };
  const [members, setMembers] = useState<Record<string, Member>>({});
  const [pins, setPins] = useState<Pin[]>([]);
  const [countdowns, setCountdowns] = useState<CountdownDrop[]>([]);
  const [scrapOpen, setScrapOpen] = useState(false);
  // A Drop opened on its own (from the countdown banner), as a pop-up.
  const [dropPop, setDropPop] = useState<string | null>(null);
  // dropId → Drop type, reported by each Drop card (for reply / pin / list previews).
  const [dropTypes, setDropTypes] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState('');
  const [sheet, setSheet] = useState<Sheet>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const [thread, setThread] = useState<string | null>(null);
  // Full-screen Session (Type Test …) by session id.
  const [session, setSession] = useState<string | null>(null);
  const [toast, setToastState] = useState<Toast | null>(null);
  const [replyTo, setReplyTo] = useState<ReplyRef | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [highlight, setHighlight] = useState('');
  // Full-screen Rewind (null = closed; a period when opened from a Rewind Drop).
  const [rewind, setRewind] = useState<{ period: RewindPeriod | null } | null>(null);
  const [memory, setMemory] = useState<Memory | null>(null);
  const [milestone, setMilestone] = useState<Milestone | null>(null);
  // Effects: the one chosen for the next message, a dismissed suggestion, and replay counters.
  const [fx, setFx] = useState<EffectCode | null>(null);
  const [fxDismissed, setFxDismissed] = useState<EffectCode | null>(null);
  const [fxRun, setFxRun] = useState<Record<string, number>>({});
  const fxPlayed = useRef<Set<string>>(loadPlayed());
  const inputRef = useRef<HTMLInputElement>(null);
  const [theme, setTheme] = useState<ThemePrefs>(currentPrefs);
  const [push, setPush] = useState<PushStatus>('unsupported');
  const [bannerHidden, setBannerHidden] = useState(() => { try { return !!localStorage.getItem(BANNER_KEY); } catch { return false; } });
  const lastTypingWrite = useRef(0);
  const delivery = useDeliveryPrefs(user.uid);
  const reads = useMyReads(user.uid);
  // Messages the server refused, kept on this phone to retry.
  const [failed, setFailedState] = useState<Failed[]>(() => { try { return parseFailed(localStorage.getItem(failedKey(room.id))); } catch { return []; } });
  const setFailed = (f: (cur: Failed[]) => Failed[]) => setFailedState((cur) => {
    const next = f(cur);
    try { if (next.length) localStorage.setItem(failedKey(room.id), JSON.stringify(next)); else localStorage.removeItem(failedKey(room.id)); } catch { /* ignore */ }
    return next;
  });
  const fileInput = useRef<HTMLInputElement>(null);

  // After the other person left (removed the contact) the room only lists me; their profile stays readable.
  const partnerUid = room.members.find((u) => u !== user.uid) || (room.left && room.left !== user.uid ? room.left : '');
  const left = !!room.left;
  // Notes to self: just me, forever. No partner things (typing, ticks, mood, invites, Today's question).
  const isSelf = room.self;
  const meMember = members[user.uid];
  const partnerMember = partnerUid ? members[partnerUid] : undefined;
  const partnerProfile = useProfile(partnerUid || null);
  const myProfile = useProfile(user.uid);
  const prefs = partnerUid ? contacts[partnerUid] : undefined;

  const me = useMemo<Person>(() => ({ uid: user.uid, name: firstName(myProfile?.name || meMember?.name || user.displayName || user.email, 'You'), isMe: true }), [user.uid, myProfile?.name, meMember?.name, user.displayName, user.email]);
  const partner = useMemo<Person>(() => ({
    uid: partnerUid,
    name: partnerUid ? displayName(prefs?.nickname, partnerProfile?.name, partnerMember?.name, 'Them') : room.self ? 'Notes to self' : room.invites[0] ? firstName(room.invites[0], 'Them') : 'Just you',
    isMe: false,
  }), [partnerUid, prefs?.nickname, partnerProfile?.name, partnerMember?.name, room.invites[0], room.self]);

  // --- streak & memories -------------------------------------------------------
  useEffect(() => { setRoomZone(room.id, room.timezone); }, [room.id, room.timezone]);
  const streak = useStreak(room, user.uid, partnerUid);
  const memoriesOn = !!partnerUid && !left && prefs?.memories !== false;
  useEffect(() => {
    const open = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d && typeof d.from === 'number') setRewind({ period: { from: d.from, to: d.to, label: String(d.label || 'Rewind') } });
    };
    addEventListener(OPEN_REWIND, open);
    return () => removeEventListener(OPEN_REWIND, open);
  }, []);
  useEffect(() => {
    const open = (e: Event) => {
      const id = (e as CustomEvent).detail?.sessionId;
      if (typeof id === 'string' && id) setSession(id);
    };
    addEventListener(OPEN_SESSION, open);
    return () => removeEventListener(OPEN_SESSION, open);
  }, []);

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
      watchCountdowns(room.id, setCountdowns, (e) => console.warn('countdowns', e)),
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
    return watchMessages(room.id, activeTab, setMessages, (e) => flash(e.message), windowFrom);
  }, [room.id, activeTab, windowFrom]);

  // Jump to a message from search: once the tab has loaded, scroll to it; if it's older
  // than what's loaded, load the tab from that message on and try again.
  useEffect(() => {
    if (!jump || !messages || jump.tabId !== activeTab) return;
    if (messages.some((m) => m.id === jump.msgId)) {
      const id = jump.msgId;
      setJump(null);
      setTimeout(() => jumpTo(id), 80);
    } else if (windowFrom == null || windowFrom > jump.atMs) {
      setWindowFrom(Math.max(0, jump.atMs - 1000));
    } else {
      setJump(null);
      flash('That message isn’t available any more.');
    }
  }, [jump, messages, activeTab, windowFrom]);
  const openFromSearch = (j: Jump) => {
    setSheet(null);
    if (j.tabId !== activeTab) setActiveTab(j.tabId);
    setJump(j);
  };

  // Mark the open tab read when it opens and whenever new messages arrive while visible.
  useEffect(() => {
    if (!messages || document.visibilityState !== 'visible') return;
    markRead(room.id, user.uid, activeTab, delivery.readReceipts).catch(() => {});
  }, [room.id, activeTab, messages?.length, delivery.readReceipts]);
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') markRead(room.id, user.uid, activeTab, delivery.readReceipts).catch(() => {}); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [room.id, activeTab, delivery.readReceipts]);

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

  useEffect(() => {
    if (!dropPop) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setDropPop(null); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [dropPop]);

  const toastTimer = useRef<number | null>(null);
  function showToast(t: Toast | null, ms = 4000) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToastState(t);
    if (t) toastTimer.current = window.setTimeout(() => setToastState(null), ms);
  }
  const flash = (text: string) => showToast({ text });
  const setToast = (text: string) => showToast(text ? { text } : null);

  // --- actions ---------------------------------------------------------------
  // Stop showing "typing…" as soon as I clear the box or leave it.
  const stopTyping = () => {
    if (!lastTypingWrite.current) return;
    lastTypingWrite.current = 0;
    setTyping(room.id, user.uid, activeTab, false).catch(() => {});
  };
  const onDraft = (v: string) => {
    setDraft(v);
    if (!v) { stopTyping(); return; }
    const now = Date.now();
    if (v && !room.self && now - lastTypingWrite.current > 3000) {
      lastTypingWrite.current = now;
      setTyping(room.id, user.uid, activeTab, true).catch(() => {});
    }
  };

  // A brand-new room's tab may still be being created; messages need it to exist.
  const tabReady = tabs.some((t) => t.id === activeTab);
  const dailyOn = !!partnerUid && !left && prefs?.dailyQuestion !== false;
  const generalReady = tabs.some((t) => t.id === GENERAL);
  // Today's question: whichever of us opens the chat first drops it (once a day).
  useEffect(() => {
    if (!dailyOn || !generalReady) return;
    const key = `hi.daily.${room.id}`;
    const today = roomDayKey(new Date(), room.timezone);
    try {
      // hi.daily.off: a per-device switch (the end-to-end test keeps it off until it tests it).
      if (localStorage.getItem(key) === today || localStorage.getItem('hi.daily.off') === '1') return;
    } catch { /* ignore */ }
    ensureDailyQuestion(room.id, user.uid, room.timezone)
      .then((id) => { if (id) { try { localStorage.setItem(key, today); } catch { /* ignore */ } } })
      .catch(() => {});
  }, [dailyOn, generalReady, room.id]);
  // On This Day: once a day per chat, look for something from this date in past years.
  const tabsLoaded = tabs.length > 0;
  useEffect(() => {
    setMemory(null);
    if (!memoriesOn || !tabsLoaded) return;
    const today = dayKeyIn(Date.now(), room.timezone);
    try { if (localStorage.getItem(`hi.otd.${room.id}`) === today) return; } catch { /* ignore */ }
    let alive = true;
    findOnThisDay(room.id, tabs, user.uid, room.timezone).then((m) => { if (alive) setMemory(m); }).catch(() => {});
    return () => { alive = false; };
  }, [memoriesOn, tabsLoaded, room.id]);
  const dismissMemory = () => {
    try { localStorage.setItem(`hi.otd.${room.id}`, dayKeyIn(Date.now(), room.timezone)); } catch { /* ignore */ }
    setMemory(null);
  };

  // Last month's Rewind, dropped into General once (by whichever phone opens the chat first).
  useEffect(() => {
    if (!memoriesOn || !generalReady) return;
    const p = rewindPeriod('last-month', Date.now(), room.timezone);
    const month = dayKeyIn(p.from + 12 * 3_600_000, room.timezone).slice(0, 7);
    const key = `hi.rewind.${room.id}`;
    try { if (localStorage.getItem(key) === month || localStorage.getItem('hi.rewind.off') === '1') return; } catch { /* ignore */ }
    if (room.createdAt && room.createdAt.toMillis() > p.to) return;
    ensureMonthlyRewind(room.id, user.uid, tabs, p, month)
      .finally(() => { try { localStorage.setItem(key, month); } catch { /* ignore */ } })
      .catch(() => {});
  }, [memoriesOn, generalReady, room.id]);

  // Milestones: streak lengths, message counts and the chat's anniversary — each celebrated once per phone.
  const [msgCount, setMsgCount] = useState<number | null>(null);
  useEffect(() => {
    if (!partnerUid || left || !tabsLoaded) return;
    countMessages(room.id, tabs).then(setMsgCount).catch(() => {});
  }, [room.id, tabsLoaded, !!partnerUid]);
  useEffect(() => {
    if (!partnerUid || left) return;
    const reached = reachedMilestones({
      streak: streak.result?.count ?? 0, runStart: streak.result?.runStart ?? '', messages: msgCount,
      startedOn: room.createdAt ? dayKeyIn(room.createdAt.toMillis(), room.timezone) : '',
      todayKey: dayKeyIn(Date.now(), room.timezone), partner: partner.name,
    });
    const key = `hi.milestones.${room.id}`;
    let seen = new Set<string>();
    try { seen = new Set(JSON.parse(localStorage.getItem(key) || '[]')); } catch { /* ignore */ }
    const { show, mark } = nextMilestone(reached, seen);
    if (!show) return;
    try { localStorage.setItem(key, JSON.stringify([...seen, ...mark].slice(-100))); } catch { /* ignore */ }
    setMilestone(show);
    if (motionOn()) playScreen('confetti');
  }, [streak.result?.count, streak.result?.runStart, msgCount, partnerUid, left]);

  const notReady = () => { flash('One moment — setting up your room…'); };

  // If you hit send before a brand-new tab has loaded, keep the message and send it
  // the moment the tab is ready instead of refusing it.
  const queued = useRef<string | null>(null);
  useEffect(() => {
    if (!tabReady || queued.current == null) return;
    const t = queued.current;
    queued.current = null;
    sendText(room.id, activeTab, user.uid, t).catch((e) => keepFailed(activeTab, t, null, e));
  }, [tabReady, activeTab]);

  /** The server refused a message: keep it here as "Not sent · Tap to retry". */
  const keepFailed = (tabId: string, text: string, reply: ReplyRef | null, e: any, effect: EffectCode | null = null, urgent = false) => {
    setFailed((cur) => [...cur, { localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, tabId, text, replyTo: reply, effect, ...(urgent ? { urgent: true } : {}), at: Date.now(), error: String(e?.message || e) }]);
    flash('Message not sent. Tap it to try again.');
  };
  const retry = (f: Failed) => {
    setFailed((cur) => cur.filter((x) => x.localId !== f.localId));
    const effect = (f.effect as EffectCode | null | undefined) ?? null;
    const urgent = f.urgent === true;
    sendText(room.id, f.tabId, user.uid, f.text, f.replyTo, { effect, urgent }).catch((e) => keepFailed(f.tabId, f.text, f.replyTo, e, effect, urgent));
  };

  const send = (opts: { urgent?: boolean } = {}) => {
    const t = draft.trim();
    if (!t) return;
    if (editing) {
      const m = editing;
      setEditing(null);
      setDraft('');
      editMessage(room.id, m, t, room.lastMessage).catch((e) => { flash(e?.code === 'permission-denied' ? 'Too late to edit — messages can be edited for 15 minutes.' : e.message); });
      return;
    }
    lastTypingWrite.current = 0;
    setTyping(room.id, user.uid, activeTab, false).catch(() => {});
    if (!tabReady) { queued.current = t; setDraft(''); return; }
    const reply = replyTo;
    const effect = fx;
    setDraft('');
    setReplyTo(null);
    setFx(null);
    setFxDismissed(null);
    const tab = activeTab;
    sendText(room.id, tab, user.uid, t, reply, { ...opts, effect }).catch((e) => keepFailed(tab, t, reply, e, effect, opts.urgent === true));
  };

  // --- scheduled messages ------------------------------------------------------
  const saveSchedule = async (text: string, at: number, existing?: Scheduled) => {
    setSheet(null);
    try {
      if (existing) {
        await updateScheduled(existing, text, at);
        flash(`Scheduled for ${whenLabel(at)}`);
        return;
      }
      if (!tabReady) return notReady();
      await scheduleMessage(room.id, activeTab, user.uid, text, at, replyTo);
      setDraft('');
      setReplyTo(null);
      stopTyping();
      flash(`Scheduled for ${whenLabel(at)}`);
    } catch (e: any) { flash(e?.message || 'Could not schedule that.'); }
  };
  const sendNow = (s: Scheduled) => deliverScheduled(s).then((ok) => flash(ok ? 'Sent' : 'Already sent')).catch((e) => flash(e.message));
  const cancelSched = (s: Scheduled) => cancelScheduled(s).then(() => flash('Scheduled message cancelled')).catch((e) => flash(e.message));
  const sendLong = useLongPress(() => { if (!editing) setSheet({ kind: 'send-options' }); });
  const urgentLeft = urgentLeftOf(delivery.urgent);

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

  // --- voice notes --------------------------------------------------------------
  const sendRecording = async (rec: VoiceRecording) => {
    if (!tabReady) return notReady();
    const reply = replyTo;
    setReplyTo(null);
    const tab = activeTab;
    flash('Sending voice note…');
    try {
      await sendVoice(room.id, tab, user.uid, rec, reply);
      setToast('');
    } catch (e: any) {
      if (reply) setReplyTo(reply);
      flash(e?.message || 'Voice note could not be sent.');
    }
  };
  const voice = useVoiceRecorder({ onDone: sendRecording, onError: (m) => flash(m) });
  const recording = voice.state !== 'idle';

  const startDrop = (def: DropDefinition<any>, prefill?: Record<string, unknown>) => {
    if (def.setup?.length) setSheet({ kind: 'setup', type: def.type, prefill });
    else {
      // No form to fill in: still let the Drop check or derive its content (e.g. Rewind's period).
      const c = { ...def.content, ...(prefill || {}) };
      const ready = def.prepare ? def.prepare(c) : c;
      if (typeof ready === 'string') flash(ready);
      else dropIt(def, ready);
    }
  };

  const dropIt = async (def: DropDefinition<any>, content: Record<string, unknown>, secrets: Record<string, unknown> = {}) => {
    setSheet(null);
    if (!tabReady) return notReady();
    try {
      // Private picks made in the setup form (e.g. which statement is the lie) are sealed
      // and locked for me in the same write, so they're never readable before a guess.
      const extra = Object.keys(secrets).length
        ? (b: WriteBatch, id: string) => Object.entries(secrets).forEach(([k, v]) => lockInBatch(b, room.id, id, user.uid, k, v))
        : undefined;
      await createDrop(room.id, activeTab, user.uid, def.type, content, def.initialEntries?.(content) || [], `a ${def.title}`, { extra });
    } catch (e: any) {
      flash(e?.message || 'Could not drop that.');
    }
  };

  const beginSession = async (test: SessionTest) => {
    setSheet(null);
    if (!partnerUid) return flash('Sessions need two people. Invite someone first.');
    if (!tabReady) return notReady();
    try {
      setSession(await startSession(room.id, activeTab, user.uid, test));
    } catch (e: any) {
      flash(e?.message || 'Could not start that.');
    }
  };

  const pin = (p: NewPin) =>
    addPin(room.id, user.uid, { tabId: activeTab, ...p, order: topOrder(pins) }).then(() => flash('Pinned to scrapbook')).catch((e) => flash(e.message));
  /** A message (or photo) as a scrap. */
  const scrapOf = (m: Message): NewPin => m.kind === 'photo' && m.photo
    ? { title: `Photo from ${nameOf(m.uid)}`, detail: m.text || 'No caption', messageId: m.id, tabId: m.tabId || activeTab, kind: 'photo', photoPath: m.photo.path, senderId: m.uid }
    : { title: nameOf(m.uid), detail: snip(m), messageId: m.id, tabId: m.tabId || activeTab, kind: 'message', senderId: m.uid };

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
  // My unread counts use my private copy of "read up to" (it works with read receipts off).
  const myLastRead = useMemo(() => {
    const out: Record<string, Timestamp> = {};
    tabs.forEach((t) => {
      const ms = readUpTo(reads, room.id, t.id, meMember?.lastRead?.[t.id]);
      if (ms) out[t.id] = Timestamp.fromMillis(ms);
    });
    return out;
  }, [tabs, reads, room.id, meMember?.lastRead]);
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
  // Disappearing tabs: hide messages the moment they expire (the server deletes them later).
  const expiring = !!messages?.some((m) => m.expiresAt);
  const nowTick = useNow(15_000, expiring);
  const shown = useMemo(() => (messages ? notExpired(visibleTo(messages, user.uid), Math.max(nowTick, Date.now())) : null), [messages, user.uid, nowTick]);

  // --- effects -------------------------------------------------------------------
  const motion = motionOn(currentTab);
  /** Plays a message's effect (on arrival, or when its label is tapped). */
  const playFx = (m: Message) => {
    if (!m.effect || !motionOn(currentTab)) return;
    setFxRun((r) => ({ ...r, [m.id]: (r[m.id] || 0) + 1 }));
    if (isCanvasEffect(m.effect)) {
      const code = m.effect;
      requestAnimationFrame(() => playScreen(code, document.getElementById(`m-${m.id}`)?.getBoundingClientRect()));
    }
  };
  // A new message with an effect plays once on each phone as it arrives (the sender's too);
  // played ids are remembered on this device so a reload doesn't replay them.
  useEffect(() => {
    if (!shown) return;
    const items = shown
      .filter((m) => m.effect && !m.deleted)
      .map((m) => ({ id: m.id, effect: m.effect!, createdMs: toMillis(m.createdAt) }));
    const { play, mark } = pickArrival(items, fxPlayed.current, Date.now());
    if (!mark.length) return;
    mark.forEach((id) => fxPlayed.current.add(id));
    savePlayed(fxPlayed.current);
    const m = play && shown.find((x) => x.id === play.id);
    if (m) playFx(m);
  }, [shown]);
  // Suggest an effect from the draft's words ("congrats" → confetti); never applied without a tap.
  const fxSuggestion = !fx && !editing ? suggestEffect(draft) : null;
  const photos = useMemo(() => (shown || []).filter((m) => m.kind === 'photo' && m.photo && !m.deleted), [shown]);
  // Ticks: read only when we both share read receipts.
  const partnerRead = delivery.readReceipts ? partnerMember?.lastRead?.[activeTab] : undefined;
  const ticks = useMemo(() => statuses(
    (isSelf ? [] : shown || []).map((m) => ({ id: m.id, uid: m.uid, createdMs: m.pending ? null : m.createdAt ? m.createdAt.toMillis() : null, pending: m.pending, deleted: m.deleted })),
    user.uid,
    partnerRead ? partnerRead.toMillis() : null,
  ), [shown, user.uid, partnerRead?.toMillis(), isSelf]);
  const byId = (id: string) => messages?.find((m) => m.id === id);
  const dropTitle = (m: Message) => `a ${(m.dropId && dropTypes[m.dropId] && getDrop(dropTypes[m.dropId])?.title) || 'Drop'}`;
  // Sealed/whisper text stays hidden in reply quotes and pins, as in the chat list and pushes.
  const snip = (m: Message) => previewFor(snippetOf(m, dropTitle(m)), (m as any).effect);
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
      const base = topOrder(pins);
      await Promise.all(todo.map((m, i) => addPin(room.id, user.uid, { ...scrapOf(m), order: base + todo.length - i })));
      flash(todo.length ? 'Pinned to scrapbook' : 'Already pinned');
    } catch (e: any) { flash(e.message); }
  };
  // --- pinned to the top of the chat (max 3) ---------------------------------------
  const topPins = room.pinned || [];
  const topOf = (m: Message): Omit<TopPin, 'at' | 'by'> => ({ msgId: m.id, tabId: m.tabId || activeTab, uid: m.uid, text: snip(m).slice(0, 160) });
  const pinTop = async (m: Message) => {
    setSheet(null);
    try {
      const r = await pinToTop(room.id, topOf(m), user.uid);
      if (r === 'full') setSheet({ kind: 'pin-full', msgId: m.id });
      else flash(r === 'already' ? 'Already pinned' : 'Pinned to the top');
    } catch (e: any) { flash(e?.message || 'Could not pin that.'); }
  };
  const topToScrapbook = (p: TopPin) =>
    moveTopPinToScrapbook(room.id, user.uid, p, nameOf(p.uid), topOrder(pins)).then(() => flash('Moved to Scrapbook')).catch((e) => flash(e.message));
  const openPinnedMessage = (tabId: string | null, msgId: string) => {
    const tab = tabId || activeTab;
    if (tab === activeTab && messages?.some((x) => x.id === msgId)) return jumpTo(msgId);
    openFromSearch({ roomId: room.id, tabId: tab, msgId, atMs: 0 });
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
        <button type="button" class="hdr-who" disabled={!partnerUid && !isSelf} onClick={() => setSheet({ kind: isSelf ? 'self-info' : 'contact' })}
          aria-label={isSelf ? 'About Notes to self' : partnerUid ? `${partner.name}’s profile` : undefined}>
          {isSelf
            ? <span class="self-avatar"><Avatar profile={myProfile} name={me.name} /><span class="self-badge" aria-hidden="true">📝</span></span>
            : <Avatar profile={partnerUid ? partnerProfile : null} fallbackPhoto={partnerMember?.photoURL} name={partner.name} />}
        </button>
        <div class="hdr-text">
          <div class="hdr-name-row">
            <span class="hdr-name">{partner.name}</span>
            {partnerUid && partnerMember?.mood && (
              <span class="their-mood" role="img" aria-label={`${partner.name}'s mood: ${MOODS.find((m) => m.id === partnerMember.mood)?.label}`}>
                <MoodIcon mood={partnerMember.mood} size={22} />
              </span>
            )}
          </div>
          {isSelf ? <div class="hdr-sub">Only you can see this</div> : left ? <div class="hdr-sub">Left this chat</div> : (
            <div class="hdr-sub-row">
              {streak.state === 'on' && streak.result && <StreakChip count={streak.result.count} onClick={() => setSheet({ kind: 'streak' })} />}
              <PartnerStatus member={partnerMember} joined={!!partnerUid} invited={room.invites[0] || ''} />
            </div>
          )}
        </div>
        <div class="hdr-actions">
          {!isSelf && (
            <button type="button" class="icon-btn" onClick={() => setSheet({ kind: 'mood' })}
              aria-label={`Your mood weather: ${MOODS.find((m) => m.id === myMood)?.label}. Change it`}>
              <MoodIcon mood={myMood} size={24} />
            </button>
          )}
          <ModeToggle uid={user.uid} />
          <button type="button" class="icon-btn" onClick={() => setSheet({ kind: 'settings' })} aria-label="Settings">
            <SettingsIcon />
          </button>
        <button type="button" class="icon-btn" onClick={() => { setSheet(null); setScrapOpen(true); }} aria-label="Open scrapbook">
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
        lastRead={myLastRead}
        onSelect={setActiveTab}
        onOptions={(tabId) => setSheet({ kind: 'tab-edit', tabId })}
        onAdd={() => setSheet({ kind: 'tab-new' })}
        onArchived={() => setSheet({ kind: 'archived' })}
        onUnreadTotal={setUnreadTotal}
        onSearch={() => setSheet({ kind: 'search' })}
      />
      {topPins.length > 0 && (
        <PinnedBar pins={topPins} nameOf={(uid) => (uid === user.uid ? 'You' : partner.name)}
          onJump={(p) => openPinnedMessage(p.tabId, p.msgId)}
          onUnpin={(p) => unpinFromTop(room.id, p.msgId).then(() => flash('Unpinned')).catch((e) => flash(e.message))}
          onToScrapbook={topToScrapbook} />
      )}
      <CountdownBanner items={countdowns} onOpen={setDropPop} />

      <Feed
        messages={shown}
        me={me}
        partner={partner}
        typing={<>
          {failed.filter((f) => f.tabId === activeTab).map((f) => (
            <FailedRow key={f.localId} f={f} onRetry={() => retry(f)} onDiscard={() => setFailed((cur) => cur.filter((x) => x.localId !== f.localId))} />
          ))}
          <TypingIndicator member={partnerMember} name={partner.name} tabId={activeTab} />
        </>}
        tabName={currentTab && currentTab.id !== GENERAL ? currentTab.name : ''}
        banner={<>
          {activeTab === GENERAL && dailyOn && (
            <DailyBanner roomId={room.id} tz={room.timezone} me={user.uid} partner={partnerUid} partnerName={partner.name} onOpen={jumpTo} />
          )}
          {left && (
            <div class="sys-card" role="status">
              <span>{room.left === user.uid ? 'You left this chat.' : `${partner.name} left this chat. You can read it, but you can’t send messages here any more.`}</span>
            </div>
          )}
          {!partnerUid && !isSelf && (
            <div class="sys-card">
              <span>{room.invites[0]
                ? `Waiting for ${room.invites[0]} to join. Send them the link so they can sign in with that e-mail.`
                : 'It’s just you here for now. Invite someone when you’re ready.'}</span>
              <button type="button" onClick={() => setSheet({ kind: 'invite' })}>{room.invites[0] ? 'Invite' : 'Invite someone'}</button>
            </div>
          )}
          {partnerUid && !left && !bannerHidden && (push === 'default' || push === 'needs-install') ? (
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
          if (m.kind === 'system') {
            return <div class="row center" id={`m-${m.id}`}><div class="sys sys-line">{systemText(m, mine ? 'You' : partner.name)}</div></div>;
          }
          let body: preact.ComponentChildren = null;
          if (m.deleted) {
            body = <div class={`bubble ${mine ? 'mine' : 'theirs'} deleted`}>Message deleted</div>;
          } else if (m.kind === 'text') {
            const run = m.effect ? fxRun[m.id] || 0 : 0;
            body = (
              <div key={`fx${run}`} class={`bubble ${mine ? 'mine' : 'theirs'}${m.effect ? ` fx-${m.effect}` : ''}${run && motion ? ' fx-go' : ''}`}>
                {m.replyTo && <ReplyQuote reply={m.replyTo} name={quoteName(m.replyTo.senderId)} mine={mine} onJump={() => jumpTo(m.replyTo!.msgId)} />}
                {m.replyToNote && (
                  <div class={`quote note-reply${mine ? '' : ' on-accent'}`}>
                    <span class="quote-name">{mine ? `Replied to ${partner.name}’s note` : 'Replied to your note'}</span>
                    <span class="quote-text">{noteLabel({ ...m.replyToNote, atMs: null })}</span>
                  </div>
                )}
                {(() => {
                  const textEl = (
                    <PhraseText text={m.text} phrases={m.phraseReactions} me={user.uid} nameOf={nameOf}
                      onRemove={(p) => removePhraseReaction(room.id, m, p).catch((e) => flash(e.message))} />
                  );
                  return m.effect
                    ? <EffectText msgId={m.id} effect={m.effect} mine={mine} text={m.text} run={run} motion={motion}>{textEl}</EffectText>
                    : textEl;
                })()}
                {m.editedAt && <span class="edited"> · edited</span>}
                {m.scheduled && <span class="edited"> · scheduled</span>}
                {mine && ticks.byId[m.id] && <StatusMark status={ticks.byId[m.id]} showRead={false} />}
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
          } else if (m.kind === 'voice' && m.voice) {
            body = (<>
              {m.replyTo && <ReplyQuote reply={m.replyTo} name={quoteName(m.replyTo.senderId)} mine={mine} onJump={() => jumpTo(m.replyTo!.msgId)} />}
              <VoiceBubble
                msg={m}
                mine={mine}
                me={user.uid}
                playedByPartner={(m.playedBy || []).some((u) => u !== user.uid)}
                nameOf={(uid) => (uid === user.uid ? 'You' : partner.name)}
                onFirstPlay={() => markPlayed(room.id, m, user.uid).catch(() => {})}
                onReact={(r) => addVoiceReaction(room.id, m, r).catch((e) => flash(e.message))}
                onUnreact={(r) => removeVoiceReaction(room.id, m, r).catch((e) => flash(e.message))}
              />
            </>);
          } else if (m.kind === 'drop' && m.dropId) {
            const dropId = m.dropId;
            body = (
              <DropCard
                roomId={room.id}
                dropId={dropId}
                me={me}
                partner={partner}
                pinned={pinnedDrops.has(dropId)}
                onPin={(title, detail) => pin({ title, detail, dropId, kind: 'drop' })}
                onType={(type) => setDropTypes((t) => (t[dropId] === type ? t : { ...t, [dropId]: type }))}
                moves={room.left || room.self ? undefined : room.moves}
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
              {m.urgent && !m.deleted && <span class="urgent-tag">Urgent</span>}
              {body}
              {m.effect && !m.deleted && <EffectTag effect={m.effect} motion={motion} onReplay={() => playFx(m)} />}
              <ReactionChips msg={m} me={user.uid} onToggle={(code, on) => react(m, code, on)} />
              <ThreadTile msg={m} me={user.uid} nameOf={nameOf} onOpen={() => setThread(m.id)} />
              {mine && m.kind !== 'text' && !m.deleted && ticks.byId[m.id] && (
                <span class="msg-meta"><StatusMark status={ticks.byId[m.id]} showRead={false} /></span>
              )}
              {ticks.lastReadId === m.id && <span class="msg-meta read-label">Read</span>}
            </MsgRow>
          );
        }}
      />

      {left ? (
        <footer class="composer left-bar">
          <button type="button" class="btn-ghost danger-text" onClick={async () => {
            try { await deleteRoom(room.id); onBack(); } catch (e: any) { flash(e.message); }
          }}>Delete chat</button>
        </footer>
      ) : selected ? (
        <footer class="composer select-bar" aria-label="Selected messages">
          <button type="button" class="round-btn" onClick={() => setSelected(null)} aria-label="Cancel selection"><XIcon /></button>
          <span class="select-count" role="status">{selected.size} selected</span>
          <button type="button" class="chip-btn" disabled={!selectedMsgs.length} onClick={() => copyMsgs(selectedMsgs)}>Copy</button>
          <button type="button" class="chip-btn" disabled={!selectedMsgs.length} onClick={() => pinMsgs(selectedMsgs)}>Pin</button>
          <button type="button" class="chip-btn danger-text" disabled={!selectedMsgs.length} onClick={() => setSheet({ kind: 'delete', ids: selectedMsgs.map((m) => m.id) })}>Delete</button>
        </footer>
      ) : (<>
      {/* Above the composer, where it's seen: one at a time — a streak request, a milestone, or On this day. */}
      {streak.state === 'proposed-to-me' && room.streak ? (
        <StreakInvite room={room} name={partner.name} onToast={flash} />
      ) : milestone ? (
        <MilestoneCard m={milestone} onReplay={() => playScreen('confetti')}
          onPin={() => pin({ title: `${milestone.emoji} ${milestone.title}`, detail: milestone.body })}
          onClose={() => setMilestone(null)} />
      ) : memory ? (
        <OnThisDayCard memory={memory} who={nameOf(memory.message.uid)}
          tabName={tabs.find((t) => t.id === memory.message.tabId)?.name || ''}
          onOpen={() => openFromSearch({ roomId: room.id, tabId: memory.message.tabId, msgId: memory.message.id, atMs: toMillis(memory.message.createdAt) })}
          onPin={() => pin({ title: `On this day, ${memory.ago} ${memory.unit}${memory.ago === 1 ? '' : 's'} ago`, detail: snippetOf(memory.message, 'a Drop', 300), messageId: memory.message.id })}
          onClose={dismissMemory} />
      ) : null}
      <ScheduledStrip
        items={scheduled}
        tabName={(id) => (id === activeTab ? '' : tabName(id))}
        onEdit={(s) => setSheet({ kind: 'schedule', id: s.id })}
        onSendNow={sendNow}
        onCancel={cancelSched}
      />
      {fx ? (
        <EffectArmed effect={fx} onClear={() => setFx(null)} />
      ) : fxSuggestion && fxSuggestion !== fxDismissed ? (
        <EffectSuggestion effect={fxSuggestion} onApply={() => setFx(fxSuggestion)} onDismiss={() => setFxDismissed(fxSuggestion)} />
      ) : null}
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
      <footer class={`composer${recording ? ' recording' : ''}`}>
        {recording && (
          <RecordBar state={voice.state} elapsed={voice.elapsed} level={voice.level} slide={voice.slide}
            onCancel={voice.cancel} onSend={voice.finish} sendIcon={<SendIcon />} />
        )}
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
          onBlur={stopTyping}
          placeholder="Message"
          autocomplete="off"
          enterKeyHint="send"
        />
        {!draft.trim() && !editing ? (
          <button type="button" class={`send-btn mic${recording ? ' live' : ''}`} {...voice.micProps}
            aria-label="Record a voice note" aria-description="Hold to record, slide left to cancel, slide up to lock. Tap for hands-free.">
            <MicIcon />
          </button>
        ) : (
          <button type="button" class="send-btn" {...sendLong} onClick={() => send()}
            aria-label={editing ? 'Save edit' : 'Send'} aria-description={editing ? undefined : 'Press and hold for Effects, Schedule and Urgent'}><SendIcon /></button>
        )}
      </footer>
      </>)}

      {rewind && partnerUid && (
        <RewindScreen roomId={room.id} me={user.uid} them={partnerUid} myName={me.name} theirName={partner.name}
          tz={room.timezone} period={rewind.period} onToast={flash} onClose={() => setRewind(null)} />
      )}
      {session && (
        <SessionScreen key={session} roomId={room.id} sessionId={session}
          me={{ uid: user.uid, name: me.name }} them={{ uid: partnerUid, name: partner.name }}
          onToast={flash} onClose={() => setSession(null)}
          onTalk={(text) => { setDraft(text); setTimeout(() => inputRef.current?.focus(), 50); }}
          onPin={(title, detail, dropId) => pin({ title, detail, dropId })}
          onRetake={(test) => beginSession(test)} />
      )}
      {thread && byId(thread) && (
        <ThreadView roomId={room.id} root={byId(thread)!} me={user.uid} nameOf={nameOf} readOnly={left}
          onToast={flash} onClose={() => setThread(null)} />
      )}
      {viewer && photos.some((p) => p.id === viewer) && (
        <PhotoViewer
          photos={photos}
          startId={viewer}
          nameOf={(uid) => (uid === user.uid ? 'You' : partner.name)}
          isPinned={(id) => pinnedMsgs.has(id)}
          onPin={(m) => pin(scrapOf(m))}
          onClose={() => setViewer(null)}
        />
      )}

      {scrapOpen && (
        <Scrapbook roomId={room.id} pins={pins} me={me} partner={partner} nameOf={nameOf} tabName={tabName}
          onToast={flash} onClose={() => setScrapOpen(false)}
          onOpenMessage={(p) => {
            // The panel is closing (back through its history entry); jump once it's gone.
            setTimeout(() => openPinnedMessage(p.tabId, p.messageId!), 120);
          }} />
      )}
      {dropPop && (
        <div class="scrap-pop chat-pop" role="dialog" aria-modal="true" aria-label="Countdown">
          <button type="button" class="scrim" onClick={() => setDropPop(null)} aria-label="Close" />
          <div class="scrap-pop-card">
            <button type="button" class="scrap-pop-x" onClick={() => setDropPop(null)} aria-label="Close Drop"><XIcon /></button>
            <DropCard roomId={room.id} dropId={dropPop} me={me} partner={partner} pinned={pinnedDrops.has(dropPop)}
              onPin={(title, detail) => pin({ title, detail, dropId: dropPop, kind: 'drop' })} />
          </div>
        </div>
      )}

      {sheet && (
        <div class="sheet-wrap">
          <button type="button" class="scrim" onClick={() => setSheet(null)} aria-label="Close" />
          <div class="sheet" role="dialog" aria-modal="true">
            {sheet.kind === 'tray' && <TraySheet drops={trayDrops(drops, isSelf)} onPick={(d) => startDrop(d)}
              sessions={isSelf ? [] : trayTests()} onSession={beginSession} self={isSelf} />}
            {sheet.kind === 'setup' && (() => {
              const def = getDrop(sheet.type);
              return def ? <SetupSheet def={def} prefill={sheet.prefill} onDrop={(c, sec) => dropIt(def, c, sec)} onBack={() => setSheet({ kind: 'tray' })} /> : null;
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
                blocked={blocked}
                onUnblock={(uid) => unblock(user.uid, uid).then(() => flash('Unblocked')).catch((e) => flash(e.message))}
                onEditProfile={() => setSheet({ kind: 'profile' })}
                onDeleteAccount={() => setSheet({ kind: 'delete-account' })}
                onToast={flash}
              />
            )}
            {sheet.kind === 'pin-full' && (() => {
              const m = byId(sheet.msgId);
              const oldest = topPins[0];
              if (!m || !oldest) return null;
              return (
                <PinFullSheet oldest={oldest} nameOf={(uid) => (uid === user.uid ? 'you' : partner.name)}
                  onMoveOldest={async () => {
                    setSheet(null);
                    try { await moveTopPinToScrapbook(room.id, user.uid, oldest, nameOf(oldest.uid), topOrder(pins)); await pinTop(m); } catch (e: any) { flash(e.message); }
                  }}
                  onToScrapbook={() => { setSheet(null); pinMsgs([m]); }}
                  onCancel={() => setSheet(null)} />
              );
            })()}
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
                  onDisappearing={left ? undefined : (hours) => {
                    setSheet(null);
                    setDisappearing(room.id, t.id, user.uid, hours).catch((e) => flash(e.message));
                  }}
                />
              ) : null;
            })()}
            {sheet.kind === 'invite' && (
              <AddContactSheet user={user} room={room} onToast={flash} onClose={() => setSheet(null)}
                onMakeSelf={async () => { await makeSelfRoom(room, user.uid); flash('This is now your Notes to self'); }} />
            )}
            {sheet.kind === 'self-info' && (
              <div class="stack">
                <div>
                  <div class="sheet-title">📝 Notes to self</div>
                  <div class="sheet-sub">Messages, photos, voice notes and reminders only you can see. Nobody can be invited here.</div>
                </div>
                <button type="button" class="btn-ghost" onClick={() => setSheet({ kind: 'search' })}>Search</button>
                <button type="button" class="btn-ghost" onClick={() => setSheet({ kind: 'search', filter: 'photos' })}>Photos and media</button>
                <button type="button" class="btn-ghost" onClick={() => { setSheet(null); setScrapOpen(true); }}>Scrapbook</button>
                <button type="button" class="btn-ghost" onClick={() => setSheet({ kind: 'export' })}>Export</button>
                <div class="fine">Tip: long-press Send → Schedule… to remind yourself later.</div>
              </div>
            )}
            {sheet.kind === 'search' && (
              <SearchSheet me={user.uid} scope={[{ roomId: room.id, name: partner.name }]} initialFilter={sheet.filter} onOpen={openFromSearch} />
            )}
            {sheet.kind === 'export' && (
              <ExportSheet
                roomId={room.id}
                me={{ uid: user.uid, name: me.name }}
                partner={{ uid: partnerUid, name: partner.name }}
                tab={{ id: activeTab, name: currentTab?.name || 'General' }}
                onToast={flash}
                onDone={() => setSheet(null)}
              />
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
                  onThread={m.kind !== 'system' ? () => { setSheet(null); setThread(m.id); } : undefined}
                  threadLabel={m.thread?.count ? 'Open thread' : 'Start a thread'}
                  onCopy={() => { setSheet(null); copyMsgs([m]); }}
                  onPin={() => { setSheet(null); pinMsgs([m]); }}
                  onPinTop={m.kind !== 'system' && !left ? () => pinTop(m) : undefined}
                  pinnedTop={topPins.some((x) => x.msgId === m.id)}
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
            {sheet.kind === 'streak' && (
              <StreakSheet room={room} me={user.uid} name={partner.name} view={streak} onToast={flash} onClose={() => setSheet(null)} />
            )}
            {sheet.kind === 'contact' && partnerUid && (
              <ContactSheet
                name={partner.name}
                realName={firstName(partnerProfile?.name || partnerMember?.name, '')}
                profile={partnerProfile}
                member={partnerMember}
                sinceMs={toMillis(room.createdAt)}
                pinCount={pins.length}
                nickname={prefs?.nickname || ''}
                muted={isMuted(prefs)}
                daily={prefs?.dailyQuestion !== false}
                onDaily={(on) => setContact(user.uid, partnerUid, { dailyQuestion: on }).then(() => flash(on ? 'Daily question on' : 'Daily question off')).catch((e) => flash(e.message))}
                onNickname={(nickname) => setContact(user.uid, partnerUid, { nickname }).then(() => flash(nickname ? 'Nickname saved' : 'Nickname removed')).catch((e) => flash(e.message))}
                onMute={(muted) => setContact(user.uid, partnerUid, muteFor(muted ? 'always' : 'off')).then(() => flash(muted ? 'Muted' : 'Unmuted')).catch((e) => flash(e.message))}
                onRemove={async () => {
                  setSheet(null);
                  try { if (left) await deleteRoom(room.id); else await leaveRoom(room.id, user.uid); onBack(); } catch (e: any) { flash(e.message); }
                }}
                onExport={() => setSheet({ kind: 'export' })}
                streak={left ? undefined : streak.state === 'on' ? `On · ${streak.result?.count ?? 0} ${streak.result?.count === 1 ? 'day' : 'days'}` : streak.state === 'off' ? 'Off' : streak.state === 'proposed-by-me' ? `Waiting for ${partner.name}` : `${partner.name} asked`}
                onStreak={() => setSheet({ kind: 'streak' })}
                onRewind={() => { setSheet(null); setRewind({ period: null }); }}
                memories={prefs?.memories !== false}
                onMemories={(on) => setContact(user.uid, partnerUid, { memories: on }).then(() => flash(on ? 'Memories on' : 'Memories off')).catch((e) => flash(e.message))}
                onMedia={() => setSheet({ kind: 'search', filter: 'photos' })}
                onBlock={async () => {
                  setSheet(null);
                  try { await blockContact(user.uid, partnerUid, partnerProfile?.name || partnerMember?.name || partner.name, left ? [] : [room.id]); if (left) await deleteRoom(room.id); onBack(); } catch (e: any) { flash(e.message); }
                }}
              />
            )}
            {sheet.kind === 'profile' && (<>
              <div class="sheet-title">Your profile</div>
              <ProfileForm user={user} profile={myProfile} roomIds={[room.id]} submitLabel="Save" onSaved={() => { setSheet(null); flash('Profile saved'); }} />
            </>)}
            {sheet.kind === 'delete-account' && <DeleteAccountSheet user={user} onCancel={() => setSheet(null)} />}
            {sheet.kind === 'send-options' && (
              <SendOptionsSheet
                hasText={!!draft.trim()}
                urgentLeft={urgentLeft}
                partnerName={partner.name}
                onSchedule={() => setSheet({ kind: 'schedule' })}
                onEffects={() => setSheet({ kind: 'effects' })}
                onUrgent={() => { setSheet(null); send({ urgent: true }); }}
              />
            )}
            {sheet.kind === 'effects' && (
              <EffectsSheet current={fx} onPick={(e) => { setFx(e); setSheet(null); inputRef.current?.focus(); }} />
            )}
            {sheet.kind === 'schedule' && (() => {
              const existing = sheet.id ? scheduled.find((x) => x.id === sheet.id) : undefined;
              if (sheet.id && !existing) return <div class="sys">That message has already been sent.</div>;
              return <ScheduleSheet text={draft} existing={existing} onSave={(t, at) => saveSchedule(t, at, existing)} onCancel={() => setSheet(null)} />;
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
  if (until <= Math.max(now, Date.now())) return null;
  return <div class="row"><div class="bubble theirs typing">{name} is typing…</div></div>;
}
