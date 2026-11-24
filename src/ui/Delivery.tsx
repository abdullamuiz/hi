import { useEffect, useRef, useState } from 'preact/hooks';
import type { Status, Failed } from '../lib/delivery';
import {
  fromLocalInput, isMuted, muteLabel, phoneZone, quickPicks, scheduleProblem, toLocalInput, validHHMM, whenLabel,
  type MuteChoice, type MuteState, type QuietHours,
} from '../lib/schedule';
import { deliverScheduled, setQuietHours, setReadReceipts, useDeliveryPrefs, watchScheduled } from '../data/delivery';
import type { Room, Scheduled } from '../types';

// ---------------------------------------------------------------------------- ticks

/** Clock while sending, ✓ once the server has it, ✓✓ once read. */
export function StatusMark({ status, showRead }: { status: Status; showRead: boolean }) {
  const label = status === 'sending' ? 'Sending' : status === 'read' ? 'Read' : 'Sent';
  return (
    <span class={`status-mark ${status}`} role="img" aria-label={label} title={label}>
      {status === 'sending' ? (
        <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
      ) : (
        <svg aria-hidden="true" width={status === 'read' ? 18 : 13} height="13" viewBox={status === 'read' ? '0 0 32 24' : '0 0 24 24'} fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 13l5 5L20 6" />
          {status === 'read' && <path d="M14 17l1 1L28 6" />}
        </svg>
      )}
      {status === 'read' && showRead && <span class="status-text">Read</span>}
    </span>
  );
}

/** A message the server refused, kept on this phone: tap to send again, or remove. */
export function FailedRow({ f, onRetry, onDiscard }: { f: Failed; onRetry(): void; onDiscard(): void }) {
  return (
    <div class="msg me failed">
      <div class="msg-body">
        <button type="button" class="bubble mine failed-bubble" onClick={onRetry} aria-label={`Not sent: ${f.text}. Tap to retry`}>
          {f.text}
        </button>
        <span class="failed-line" role="status">
          <span class="failed-dot" aria-hidden="true">!</span> Not sent · <button type="button" class="link-btn" onClick={onRetry}>Tap to retry</button>
          {' · '}<button type="button" class="link-btn" onClick={onDiscard}>Remove</button>
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------- scheduled strip

interface StripProps {
  items: Scheduled[];
  tabName(id: string): string;
  onEdit(s: Scheduled): void;
  onSendNow(s: Scheduled): void;
  onCancel(s: Scheduled): void;
}

/** "Scheduled" list above the composer: Edit · Send now · Cancel. */
export function ScheduledStrip({ items, tabName, onEdit, onSendNow, onCancel }: StripProps) {
  // Open by default for one or two; folded for more (the person can always toggle it).
  const [choice, setChoice] = useState<boolean | null>(null);
  const open = choice ?? items.length <= 2;
  if (!items.length) return null;
  return (
    <section class="sched-strip" aria-label="Scheduled messages">
      <button type="button" class="sched-head" onClick={() => setChoice(!open)} aria-expanded={open}>
        <ClockIcon /> <span>{items.length} scheduled</span>
        <span class="sched-toggle" aria-hidden="true">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <ul class="sched-list">
          {items.map((s) => (
            <li key={s.id} class="sched-item">
              <span class="sched-text">
                <span class="sched-when">{whenLabel(s.sendAt)}{tabName(s.tabId) ? ` · ${tabName(s.tabId)}` : ''}</span>
                <span class="sched-snip">{s.text}</span>
              </span>
              <span class="sched-actions">
                <button type="button" class="mini-btn" onClick={() => onEdit(s)} aria-label={`Edit scheduled message: ${s.text}`}>Edit</button>
                <button type="button" class="mini-btn" onClick={() => onSendNow(s)} aria-label={`Send now: ${s.text}`}>Send now</button>
                <button type="button" class="mini-btn icon danger-text" onClick={() => onCancel(s)} aria-label={`Cancel scheduled message: ${s.text}`}>
                  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ClockIcon() {
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
}

// ---------------------------------------------------------------------------- long-press Send

interface SendOptionsProps {
  hasText: boolean;
  urgentLeft: number;
  partnerName: string;
  onSchedule(): void;
  onUrgent(): void;
  onEffects(): void;
}

/** Long-press Send: Effects… · Schedule… · Send as urgent. */
export function SendOptionsSheet({ hasText, urgentLeft, partnerName, onSchedule, onUrgent, onEffects }: SendOptionsProps) {
  return (
    <div class="stack">
      <div class="sheet-title">Send options</div>
      {!hasText && <div class="fine">Type your message first.</div>}
      <div class="act-list">
        <button type="button" class="act-btn" disabled={!hasText} onClick={onEffects}>
          Effects…<span class="act-hint">Confetti, balloons, a sealed envelope…</span>
        </button>
        <button type="button" class="act-btn" disabled={!hasText} onClick={onSchedule}>
          Schedule…<span class="act-hint">Pick a time and it sends itself</span>
        </button>
        <button type="button" class="act-btn" disabled={!hasText || urgentLeft <= 0} onClick={onUrgent}>
          Send as urgent
          <span class="act-hint">
            {urgentLeft > 0
              ? `Notifies ${partnerName} even in their quiet hours · ${urgentLeft} left today`
              : 'You’ve used today’s 3 urgent messages'}
          </span>
        </button>
      </div>
    </div>
  );
}

interface ScheduleProps {
  text: string;
  /** Editing an existing scheduled message. */
  existing?: Scheduled;
  onSave(text: string, at: number): void;
  onCancel(): void;
}

/** Pick when to send: quick picks or any date and time (the phone's time zone). */
export function ScheduleSheet({ text: initialText, existing, onSave, onCancel }: ScheduleProps) {
  const now = Date.now();
  const picks = quickPicks(now);
  const [text, setText] = useState(existing?.text ?? initialText);
  const [custom, setCustom] = useState(() => toLocalInput(existing?.sendAt ?? picks[0].at));
  const [err, setErr] = useState('');
  const save = (at: number | null) => {
    const problem = !text.trim() ? 'Write a message first.' : scheduleProblem(at);
    if (problem) { setErr(problem); return; }
    onSave(text, at!);
  };
  return (
    <form class="stack" style={{ gap: '12px' }} onSubmit={(e) => { e.preventDefault(); save(fromLocalInput(custom)); }}>
      <div>
        <div class="sheet-title">{existing ? 'Edit scheduled message' : 'Schedule message'}</div>
        <div class="sheet-sub">It sends itself at that time. Only you can see it until then.</div>
      </div>
      <label class="field-label" for="sched-text">Message</label>
      <textarea id="sched-text" class="field sched-area" value={text} maxLength={4000} rows={3}
        onInput={(e) => { setText(e.currentTarget.value); setErr(''); }} />
      {!existing && (
        <div class="act-list" role="group" aria-label="Quick picks">
          {picks.map((p) => (
            <button type="button" key={p.id} class="act-btn" onClick={() => save(p.at)}>
              {p.label}<span class="act-hint">{whenLabel(p.at, now)}</span>
            </button>
          ))}
        </div>
      )}
      <label class="field-label" for="sched-at">{existing ? 'Send at' : 'Or pick a date and time'}</label>
      <input id="sched-at" type="datetime-local" class="field" value={custom} min={toLocalInput(now)}
        onInput={(e) => { setCustom(e.currentTarget.value); setErr(''); }} />
      {err && <div class="err" role="alert">{err}</div>}
      <div class="btn-row">
        <button class="btn-primary">{existing ? 'Save' : 'Schedule'}</button>
        <button type="button" class="btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------- mute

const MUTE_OPTIONS: { id: MuteChoice; label: string }[] = [
  { id: '8h', label: 'For 8 hours' },
  { id: 'week', label: 'For a week' },
  { id: 'always', label: 'Always' },
];

/** Mute a chat's notifications for a while, for good, or unmute. */
export function MuteSheet({ name, state, onPick }: { name: string; state: Partial<MuteState>; onPick(c: MuteChoice): void }) {
  const muted = isMuted(state);
  return (
    <div class="stack">
      <div>
        <div class="sheet-title">Mute {name}</div>
        <div class="sheet-sub">{muted ? muteLabel(state) : 'No notifications from this chat. Messages still arrive.'}</div>
      </div>
      <div class="act-list">
        {MUTE_OPTIONS.map((o) => <button type="button" key={o.id} class="act-btn" onClick={() => onPick(o.id)}>{o.label}</button>)}
        {muted && <button type="button" class="act-btn" onClick={() => onPick('off')}>Unmute</button>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------- settings

/** Settings: read receipts and quiet hours. */
export function DeliverySettings({ uid, onToast }: { uid: string; onToast(t: string): void }) {
  const prefs = useDeliveryPrefs(uid);
  const [q, setQ] = useState<QuietHours>(prefs.quiet);
  useEffect(() => setQ(prefs.quiet), [prefs.quiet.on, prefs.quiet.start, prefs.quiet.end]);
  const saveQuiet = (next: QuietHours) => {
    setQ(next);
    if (!validHHMM(next.start) || !validHHMM(next.end)) return;
    setQuietHours(uid, { ...next, tz: phoneZone() }).catch((e) => onToast(e.message));
  };
  return (<>
    <div class="settings-group">
      <div class="field-label" id="rr-label">Read receipts</div>
      <div class="segmented" role="radiogroup" aria-labelledby="rr-label">
        {([[true, 'On'], [false, 'Off']] as const).map(([on, label]) => (
          <button type="button" key={label} role="radio" aria-checked={prefs.readReceipts === on} class={prefs.readReceipts === on ? 'on' : ''}
            onClick={() => setReadReceipts(uid, on).then(() => onToast(on ? 'Read receipts on' : 'Read receipts off')).catch((e) => onToast(e.message))}>
            {label}
          </button>
        ))}
      </div>
      <div class="fine">{prefs.readReceipts
        ? 'People see when you’ve read their messages, and you see when they’ve read yours.'
        : 'Nobody sees when you’ve read their messages, and you don’t see theirs either.'}</div>
    </div>
    <div class="settings-group">
      <div class="field-label" id="quiet-label">Quiet hours</div>
      <div class="segmented" role="radiogroup" aria-labelledby="quiet-label">
        {([[true, 'On'], [false, 'Off']] as const).map(([on, label]) => (
          <button type="button" key={label} role="radio" aria-checked={q.on === on} class={q.on === on ? 'on' : ''}
            onClick={() => saveQuiet({ ...q, on })}>{label}</button>
        ))}
      </div>
      {q.on && (
        <div class="quiet-times">
          <label>From <input type="time" class="field" value={q.start} onChange={(e) => saveQuiet({ ...q, start: e.currentTarget.value })} aria-label="Quiet hours start" /></label>
          <label>to <input type="time" class="field" value={q.end} onChange={(e) => saveQuiet({ ...q, end: e.currentTarget.value })} aria-label="Quiet hours end" /></label>
        </div>
      )}
      <div class="fine">{q.on
        ? `Notifications wait until ${q.end}, then arrive as one summary. Urgent messages (3 a day) still come through.`
        : 'Hold notifications overnight and get one summary in the morning.'}</div>
    </div>
  </>);
}

// ---------------------------------------------------------------------------- sending on time

const TICK_MS = 10_000;

/**
 * While the app is open, sends my scheduled messages when they're due (the server
 * does the same every minute once Cloud Functions are deployed; the shared id means
 * a message is never sent twice). Returns my scheduled messages per room.
 */
export function useScheduledDelivery(uid: string | undefined, rooms: Room[] | null): Record<string, Scheduled[]> {
  const [byRoom, setByRoom] = useState<Record<string, Scheduled[]>>({});
  const ref = useRef(byRoom);
  ref.current = byRoom;
  const ids = (rooms || []).filter((r) => !r.left && uid && r.members.includes(uid)).map((r) => r.id).sort().join(',');

  useEffect(() => {
    if (!uid || !ids) { setByRoom({}); return; }
    const unsubs = ids.split(',').map((roomId) => watchScheduled(roomId, uid, (list) => {
      setByRoom((cur) => ({ ...cur, [roomId]: list }));
    }, () => {}));
    return () => unsubs.forEach((u) => u());
  }, [uid, ids]);

  const busy = useRef(new Set<string>());
  const tick = () => {
    const now = Date.now();
    Object.values(ref.current).flat().forEach((s) => {
      if (s.sendAt > now || busy.current.has(s.id)) return;
      busy.current.add(s.id);
      deliverScheduled(s).catch((e) => console.warn('scheduled send', e)).finally(() => busy.current.delete(s.id));
    });
  };

  // A regular check, plus one when the app comes back to the front.
  useEffect(() => {
    if (!uid) return;
    const t = setInterval(tick, TICK_MS);
    const onVis = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [uid]);

  // And exactly when the next one is due.
  useEffect(() => {
    const next = Math.min(...Object.values(byRoom).flat().map((s) => s.sendAt));
    if (!Number.isFinite(next)) return;
    const t = setTimeout(tick, Math.min(Math.max(0, next - Date.now()) + 250, 2 ** 31 - 1));
    return () => clearTimeout(t);
  }, [byRoom]);

  return byRoom;
}
