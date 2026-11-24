import { useMemo, useRef, useState } from 'preact/hooks';
import { emojiOf, phraseSegments, reactionChips, REACTIONS, wordsOf } from '../lib/messages';
import type { Message, PhraseReaction, ReactionCode, ReplyRef } from '../types';

// ---------------------------------------------------------------------------- long-press

const LONG_PRESS_MS = 450;
const MOVE_SLOP = 8;
/** Things inside a message that have their own touch behaviour (Drop inputs, sliders). */
const OWN_GESTURE = 'input, textarea, select, [role="slider"], .grid-btn, .no-lp';

/**
 * Long-press (touch/pen), or right-click (mouse), opens the message menu. Moving more
 * than 8px cancels, so scrolling and the pull-to-refresh hold never trigger it, and the
 * click that follows a long-press is swallowed.
 */
export function useLongPress(onLong: () => void, enabled = true) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const cancel = () => { if (timer.current != null) clearTimeout(timer.current); timer.current = null; start.current = null; };
  return {
    onPointerDown(e: PointerEvent) {
      fired.current = false;
      if (!enabled || e.pointerType === 'mouse' || e.button !== 0) return;
      if ((e.target as Element).closest?.(OWN_GESTURE)) return;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        timer.current = null;
        fired.current = true;
        swallowNextClick();
        navigator.vibrate?.(10);
        onLong();
      }, LONG_PRESS_MS);
    },
    onPointerMove(e: PointerEvent) {
      const s = start.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_SLOP) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu(e: MouseEvent) {
      if (!enabled || (e.target as Element).closest?.(OWN_GESTURE)) return;
      e.preventDefault();
      cancel();
      if (!fired.current) onLong();
    },
    onClickCapture(e: MouseEvent) {
      if (fired.current) { e.preventDefault(); e.stopPropagation(); fired.current = false; }
    },
  };
}

/**
 * The finger lifting after a long-press produces a click, and by then the menu's
 * backdrop is under the finger: without this, that click would close the menu again.
 */
function swallowNextClick() {
  const kill = (ev: Event) => { ev.preventDefault(); ev.stopPropagation(); };
  addEventListener('click', kill, { capture: true, once: true });
  setTimeout(() => removeEventListener('click', kill, { capture: true }), 800);
}

// ---------------------------------------------------------------------------- the menu

interface ActionProps {
  msg: Message;
  /** Short text of the message, shown at the top. */
  preview: string;
  canEdit: boolean;
  canCopy: boolean;
  canPin: boolean;
  pinned: boolean;
  myReactions: ReactionCode[];
  onReact(code: ReactionCode): void;
  onPhrase?(): void;
  onReply(): void;
  onCopy(): void;
  onPin(): void;
  onEdit(): void;
  onSelect(): void;
  onDelete(): void;
}

/** Reply · React · Copy · Pin · Edit · Select · Delete */
export function ActionSheet(p: ActionProps) {
  const alive = !p.msg.deleted;
  return (
    <div class="stack">
      <div class="act-preview">{p.preview || 'Message'}</div>
      {alive && (
        <div class="rx-row" role="group" aria-label="React">
          {REACTIONS.map((r) => (
            <button type="button" key={r.code} class={`rx-opt${p.myReactions.includes(r.code) ? ' on' : ''}`}
              aria-pressed={p.myReactions.includes(r.code)} aria-label={`React ${r.label}`} onClick={() => p.onReact(r.code)}>
              {r.emoji}
            </button>
          ))}
        </div>
      )}
      <div class="act-list">
        {alive && <ActBtn label="Reply" onClick={p.onReply} />}
        {alive && p.onPhrase && <ActBtn label="Phrase react" hint="React to a few words" onClick={p.onPhrase} />}
        {alive && p.canCopy && <ActBtn label="Copy" onClick={p.onCopy} />}
        {alive && p.canPin && <ActBtn label={p.pinned ? 'Pinned' : 'Pin'} disabled={p.pinned} onClick={p.onPin} />}
        {p.canEdit && <ActBtn label="Edit" hint="Up to 15 minutes after sending" onClick={p.onEdit} />}
        <ActBtn label="Select" onClick={p.onSelect} />
        <ActBtn label="Delete" danger onClick={p.onDelete} />
      </div>
    </div>
  );
}

function ActBtn({ label, hint, danger, disabled, onClick }: { label: string; hint?: string; danger?: boolean; disabled?: boolean; onClick(): void }) {
  return (
    <button type="button" class={`act-btn${danger ? ' danger' : ''}`} disabled={disabled} onClick={onClick}>
      <span>{label}</span>
      {hint && <span class="act-hint">{hint}</span>}
    </button>
  );
}

// ---------------------------------------------------------------------------- delete

interface DeleteProps {
  count: number;
  /** "For everyone" only when every selected message is mine (and not deleted already). */
  allMine: boolean;
  onForMe(): void;
  onForEveryone(): void;
  onCancel(): void;
}

export function DeleteSheet({ count, allMine, onForMe, onForEveryone, onCancel }: DeleteProps) {
  const [confirm, setConfirm] = useState(false);
  const many = count > 1;
  if (confirm) {
    return (
      <div class="stack" role="alertdialog" aria-labelledby="del-title" aria-describedby="del-body">
        <div class="sheet-title" id="del-title">{many ? `Delete ${count} messages for everyone?` : 'Delete for everyone?'}</div>
        <p class="lede" id="del-body">
          {many ? 'This removes them from both chats and can’t be undone.' : 'This removes it from both chats and can’t be undone.'}
        </p>
        <button type="button" class="btn-danger" onClick={onForEveryone}>Delete for everyone</button>
        <button type="button" class="btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    );
  }
  return (
    <div class="stack">
      <div class="sheet-title">{many ? `Delete ${count} messages?` : 'Delete message?'}</div>
      <button type="button" class="btn-ghost" onClick={onForMe}>Delete for me</button>
      <button type="button" class="btn-ghost danger-text" disabled={!allMine} onClick={() => setConfirm(true)}>Delete for everyone</button>
      {!allMine && <div class="fine">“For everyone” only works on your own messages.</div>}
      <button type="button" class="link-btn" onClick={onCancel}>Cancel</button>
    </div>
  );
}

// ---------------------------------------------------------------------------- phrase picker

/** Tap the first and last word, then a reaction. Works the same on phones and desktop. */
export function PhraseSheet({ text, onReact }: { text: string; onReact(start: number, end: number, code: ReactionCode): void }) {
  const words = useMemo(() => wordsOf(text), [text]);
  const [a, setA] = useState<number | null>(null);
  const [b, setB] = useState<number | null>(null);
  const lo = a == null ? null : b == null ? a : Math.min(a, b);
  const hi = a == null ? null : b == null ? a : Math.max(a, b);
  const tap = (i: number) => {
    if (a == null || b != null) { setA(i); setB(null); } else setB(i);
  };
  const phrase = lo == null ? '' : text.slice(words[lo].start, words[hi!].end);
  return (
    <div class="stack">
      <div>
        <div class="sheet-title">React to a phrase</div>
        <div class="sheet-sub">{a == null ? 'Tap the first word.' : b == null ? 'Now tap the last word (or the same one).' : 'Pick a reaction.'}</div>
      </div>
      <div class="word-pick" role="group" aria-label="Words">
        {words.map((w, i) => (
          <button type="button" key={i} class={`word${lo != null && i >= lo && i <= hi! ? ' on' : ''}`}
            aria-pressed={lo != null && i >= lo && i <= hi!} onClick={() => tap(i)}>{w.text}</button>
        ))}
      </div>
      {phrase && <div class="fine">“{phrase}”</div>}
      <div class="rx-row" role="group" aria-label="Reaction for the phrase">
        {REACTIONS.map((r) => (
          <button type="button" key={r.code} class="rx-opt" disabled={lo == null} aria-label={`Phrase reaction ${r.label}`}
            onClick={() => onReact(words[lo!].start, words[hi!].end, r.code)}>{r.emoji}</button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------- inside a bubble

export function ReplyQuote({ reply, name, mine, onJump }: { reply: ReplyRef; name: string; mine: boolean; onJump(): void }) {
  return (
    <button type="button" class={`quote${mine ? ' on-mine' : ''}`} onClick={(e) => { e.stopPropagation(); onJump(); }}
      aria-label={`Reply to ${name}: ${reply.snippet}. Show the original`}>
      <span class="quote-name">{name}</span>
      <span class="quote-text">{reply.snippet}</span>
    </button>
  );
}

/** Message text with reacted phrases underlined and their reaction chips. */
export function PhraseText({ text, phrases, me, nameOf, onRemove }: {
  text: string; phrases?: PhraseReaction[]; me: string; nameOf(uid: string): string; onRemove(p: PhraseReaction): void;
}) {
  const segs = useMemo(() => phraseSegments(text, phrases), [text, phrases]);
  return (
    <>
      {segs.map((s, i) => (
        <span key={i}>
          {s.marked ? <span class="phrase">{s.text}</span> : s.text}
          {s.chips.map((p) => {
            const label = `${emojiOf(p.reaction)} from ${p.uid === me ? 'you' : nameOf(p.uid)} on “${text.slice(p.start, p.end)}”`;
            return p.uid === me
              ? <button type="button" key={`${p.uid}${p.start}${p.end}${p.reaction}`} class="phrase-chip" aria-label={`${label}. Tap to remove`}
                  onClick={(e) => { e.stopPropagation(); onRemove(p); }}>{emojiOf(p.reaction)}</button>
              : <span key={`${p.uid}${p.start}${p.end}${p.reaction}`} class="phrase-chip" role="img" aria-label={label}>{emojiOf(p.reaction)}</span>;
          })}
        </span>
      ))}
    </>
  );
}

export function ReactionChips({ msg, me, onToggle }: { msg: Message; me: string; onToggle(code: ReactionCode, on: boolean): void }) {
  const chips = reactionChips(msg.reactions, me);
  if (!chips.length || msg.deleted) return null;
  return (
    <div class="rx-chips">
      {chips.map((c) => (
        <button type="button" key={c.code} class={`rx-chip${c.mine ? ' mine' : ''}`} aria-pressed={c.mine}
          aria-label={`${c.label}, ${c.count}${c.mine ? '. Tap to remove yours' : '. Tap to add yours'}`}
          onClick={(e) => { e.stopPropagation(); onToggle(c.code, !c.mine); }}>
          <span aria-hidden="true">{c.emoji}</span>{c.count > 1 && <span class="rx-n">{c.count}</span>}
        </button>
      ))}
    </div>
  );
}
