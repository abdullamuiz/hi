import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Message, ReactionCode } from '../types';
import { deleteReply, markThreadSeen, reactToReply, sendReply, threadUnread, watchReplies, type Reply } from '../data/threads';
import { REACTIONS, snippetOf } from '../lib/messages';
import { previewFor } from '../lib/effects';
import { markRoomThreadsSeen } from '../lib/moves';
import { closeOverlay, forgetOverlay, openOverlay } from '../lib/overlay';
import { ReactionChips } from './MessageActions';
import { BackIcon, SendIcon } from './icons';

/** The folded thread under a message: reply count, who replied last, unread dot. */
export function ThreadTile({ msg, me, nameOf, onOpen }: { msg: Message; me: string; nameOf(uid: string): string; onOpen(): void }) {
  const t = msg.thread;
  if (!t?.count || msg.deleted) return null;
  const unread = threadUnread(msg, me);
  const who = t.lastBy === me ? 'you' : nameOf(t.lastBy);
  return (
    <button type="button" class={`thread-tile${unread ? ' unread' : ''}`} onClick={(e) => { e.stopPropagation(); onOpen(); }}
      aria-label={`Thread, ${t.count} ${t.count === 1 ? 'reply' : 'replies'}, last from ${who}${unread ? ', new replies' : ''}`}>
      <span aria-hidden="true">💬</span>
      <span class="thread-count">{t.count} {t.count === 1 ? 'reply' : 'replies'}</span>
      <span class="thread-last">· last from {who}</span>
      {unread && <span class="thread-dot" aria-hidden="true" />}
    </button>
  );
}

interface ViewProps {
  roomId: string;
  root: Message;
  me: string;
  nameOf(uid: string): string;
  /** The chat is read-only (someone left). */
  readOnly?: boolean;
  onToast(text: string): void;
  onClose(): void;
}

/** A side discussion, full screen, with its own composer. The back gesture closes it. */
export function ThreadView({ roomId, root, me, nameOf, readOnly, onToast, onClose }: ViewProps) {
  const [replies, setReplies] = useState<Reply[]>([]);
  const [draft, setDraft] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    const close = () => closeRef.current();
    openOverlay(close);
    return () => forgetOverlay(close);
  }, []);
  useEffect(() => watchReplies(roomId, root.tabId, root.id, setReplies), [roomId, root.tabId, root.id]);
  // Everything shown counts as seen; keep the list scrolled to the newest.
  useEffect(() => {
    markThreadSeen(root.id);
    markRoomThreadsSeen(roomId);
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [replies.length]);
  useEffect(() => () => { markThreadSeen(root.id); markRoomThreadsSeen(roomId); }, []);

  const send = async () => {
    const t = draft.trim();
    if (!t || busy) return;
    setBusy(true);
    setDraft('');
    try { await sendReply(roomId, root, me, t); } catch (e: any) { setDraft(t); onToast(e?.message || 'Could not send.'); } finally { setBusy(false); }
  };

  return (
    <div class="thread-view" role="dialog" aria-modal="true" aria-label="Thread">
      <header class="thread-top">
        <button type="button" class="icon-btn" onClick={() => closeOverlay()} aria-label="Close thread"><BackIcon /></button>
        <div class="thread-title">Thread</div>
      </header>
      <div class="thread-list" ref={list}>
        <div class="thread-root">
          <div class="thread-root-who">{root.uid === me ? 'You' : nameOf(root.uid)}</div>
          <div class="thread-root-text">{previewFor(snippetOf(root, 'a Drop', 400), (root as any).effect)}</div>
        </div>
        <div class="thread-sep" role="status">{replies.length ? `${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}` : 'No replies yet. Start the side chat.'}</div>
        {replies.map((r) => {
          const mine = r.uid === me;
          const asMsg = r as unknown as Message;
          return (
            <div key={r.id} class={`msg${mine ? ' me' : ''}`}>
              <div class="msg-body">
                <button type="button" class={`bubble ${mine ? 'mine' : 'theirs'}${r.deleted ? ' deleted' : ''} thread-bubble`}
                  onClick={() => !r.deleted && setActive(active === r.id ? null : r.id)} aria-expanded={active === r.id}>
                  {r.deleted ? 'Message deleted' : r.text}
                </button>
                <ReactionChips msg={asMsg} me={me} onToggle={(code, on) => reactToReply(roomId, root.tabId, root.id, r, me, code, on).catch((e) => onToast(e.message))} />
                {active === r.id && !r.deleted && (
                  <div class="rx-row thread-rx" role="group" aria-label="React">
                    {REACTIONS.map((x) => {
                      const on = !!r.reactions?.[x.code as ReactionCode]?.includes(me);
                      return (
                        <button type="button" key={x.code} class={`rx-opt${on ? ' on' : ''}`} aria-pressed={on} aria-label={`React ${x.label}`}
                          onClick={() => { setActive(null); reactToReply(roomId, root.tabId, root.id, r, me, x.code, !on).catch((e) => onToast(e.message)); }}>
                          {x.emoji}
                        </button>
                      );
                    })}
                    {mine && <button type="button" class="link-btn danger-text" onClick={() => { setActive(null); deleteReply(roomId, root.tabId, root.id, r).catch((e) => onToast(e.message)); }}>Delete</button>}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {readOnly ? (
        <footer class="composer left-bar"><span class="fine">This chat is read-only.</span></footer>
      ) : (
        <footer class="composer">
          <label for="thread-input" class="sr">Reply in thread</label>
          <input id="thread-input" class="msg-input" value={draft} maxLength={4000} placeholder="Reply in thread…" autocomplete="off" enterKeyHint="send"
            onInput={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); send(); } }} />
          <button type="button" class="send-btn" onClick={send} disabled={!draft.trim() || busy} aria-label="Send reply"><SendIcon /></button>
        </footer>
      )}
    </div>
  );
}
