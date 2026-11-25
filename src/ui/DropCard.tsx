import { useEffect, useMemo, useState } from 'preact/hooks';
import { addEntry, emptyDropState, lockAnswer, saveDraft, setProgress, watchDrop, type DropState } from '../data/drops';
import { getDrop, withDefaults } from '../drops/registry';
import type { DropApi, Person } from '../drops/types';
import { BookmarkIcon, DropIcon } from './icons';

interface Props {
  roomId: string;
  dropId: string;
  me: Person;
  partner: Person;
  pinned: boolean;
  onPin(title: string, detail: string): void;
  /** Tells the chat which kind of Drop this is (for previews). */
  onType?(type: string): void;
}

export function DropCard({ roomId, dropId, me, partner, pinned, onPin, onType }: Props) {
  const [s, setS] = useState<DropState>(emptyDropState);
  const partnerUid = partner.uid || null;
  useEffect(() => watchDrop(roomId, dropId, me.uid, partnerUid, setS), [roomId, dropId, me.uid, partnerUid]);

  const def = s.drop ? getDrop(s.drop.type) : undefined;
  useEffect(() => { if (s.drop?.type) onType?.(s.drop.type); }, [s.drop?.type]);
  const createdBy: Person = s.drop?.createdBy === me.uid ? me : partner;

  const api = useMemo<DropApi>(() => {
    const has = (uid: string, key: string) => s.locks.has(`${uid}_${key}`);
    return {
      roomId, me, partner, createdBy,
      mine: (key) => s.mine[key]?.value as any,
      theirs: (key) => s.theirs[key]?.value as any,
      iLocked: (key) => !!s.mine[key]?.locked || has(me.uid, key),
      theyLocked: (key) => !!partner.uid && has(partner.uid, key),
      revealed: (key) => !!s.theirs[key] && has(me.uid, key),
      saveDraft: (key, value) => saveDraft(roomId, dropId, me.uid, key, value),
      lock: (key, value) => lockAnswer(roomId, dropId, me.uid, key, value),
      entries: s.entries,
      addEntry: (text) => addEntry(roomId, dropId, me.uid, text),
      myProgress: s.progress[me.uid] || {},
      theirProgress: (partner.uid && s.progress[partner.uid]) || {},
      setMyProgress: (patch) => setProgress(roomId, dropId, me.uid, patch),
    };
  }, [s, me, partner, createdBy, roomId, dropId]);

  if (!s.drop) {
    return <section class="drop" aria-busy="true"><div class="drop-sub">Loading Drop…</div></section>;
  }
  if (!def) {
    return (
      <section class="drop">
        <Head title="New Drop" sub={`"${s.drop.type}"`} from={createdBy} />
        <div class="note">This Drop needs a newer version of the app. Reload to update.</div>
      </section>
    );
  }

  const content = withDefaults(def, s.drop.content);
  const Renderer = def.Renderer;
  const pin = () => onPin(def.pinTitle ? def.pinTitle(content) : def.title, def.pinDetail(content, api));

  return (
    <section class="drop" aria-label={def.title}>
      <Head title={def.title} sub={def.subtitle(content)} from={createdBy} />
      <Renderer content={content} api={api} />
      <div class="drop-foot">
        {pinned
          ? <span class="pinned">Pinned</span>
          : <button type="button" class="pin-btn" onClick={pin}><BookmarkIcon size={15} />Pin to scrapbook</button>}
      </div>
    </section>
  );
}

function Head({ title, sub, from }: { title: string; sub: string; from: Person }) {
  return (
    <div class="drop-head">
      <div class="drop-icon"><DropIcon /></div>
      <div class="drop-titles">
        <div class="drop-title">{title}</div>
        <div class="drop-sub">{sub} · dropped by {from.isMe ? 'you' : from.name}</div>
      </div>
    </div>
  );
}
