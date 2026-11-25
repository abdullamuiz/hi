import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Message, Pin } from '../types';
import type { Person } from '../drops/types';
import { addNote, editNote, movePin, removePin } from '../data/pins';
import {
  NOTE_COLOURS, NOTE_MAX, kindOf, matchesFilter, moveOrder, sortScraps, topOrder, type ScrapFilter,
} from '../lib/scrapbook';
import { closeOverlay, forgetOverlay, openOverlay } from '../lib/overlay';
import { DropCard } from './DropCard';
import { PhotoViewer, usePhoto } from './Bubbles';
import { BackIcon, DropIcon, PlusIcon, XIcon } from './icons';

interface Props {
  roomId: string;
  pins: Pin[];
  me: Person;
  partner: Person;
  nameOf(uid: string): string;
  tabName(id: string | null): string;
  /** Jump to a pinned message in the chat (the panel closes first). */
  onOpenMessage(p: Pin): void;
  onToast(text: string): void;
  onClose(): void;
}

const FILTERS: { id: ScrapFilter; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'note', label: 'Notes' }, { id: 'photo', label: 'Photos' },
  { id: 'message', label: 'Messages' }, { id: 'drop', label: 'Drops' },
];
const LONG_PRESS_MS = 350;
const MOVE_SLOP = 8;

const dateOf = (p: Pin) => (p.createdAt ? p.createdAt.toDate().toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');

/**
 * The scrapbook: a full-screen board that slides in from the right. Pinned Drops,
 * messages and photos, plus notes written right here. Press and hold a scrap to drag it.
 */
export function Scrapbook({ roomId, pins, me, partner, nameOf, tabName, onOpenMessage, onToast, onClose }: Props) {
  const [filter, setFilter] = useState<ScrapFilter>('all');
  const [editing, setEditing] = useState<Pin | 'new' | null>(null);
  const [dropOpen, setDropOpen] = useState<string | null>(null);
  const [photoOpen, setPhotoOpen] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  // While dragging: the id being moved and where it would land (index in the shown list).
  const [drag, setDrag] = useState<{ id: string; to: number } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Back gesture / ← close the panel, not the chat.
  useLayoutEffect(() => {
    const close = () => closeRef.current();
    openOverlay(close);
    return () => forgetOverlay(close);
  }, []);
  const close = () => closeOverlay();

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // The note editor and photo viewer handle their own Escape.
      if (dropOpen) setDropOpen(null);
      else if (!editing && !photoOpen) close();
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [editing, dropOpen, photoOpen]);

  const board = useMemo(() => sortScraps(pins), [pins]);
  const shown = useMemo(() => board.filter((p) => matchesFilter(p, filter)), [board, filter]);
  // Live preview of a drag: the moved scrap sits where it would land.
  const view = useMemo(() => {
    if (!drag) return shown;
    const from = shown.findIndex((p) => p.id === drag.id);
    if (from < 0) return shown;
    const rest = shown.filter((p) => p.id !== drag.id);
    rest.splice(Math.max(0, Math.min(rest.length, drag.to)), 0, shown[from]);
    return rest;
  }, [shown, drag]);

  /** Move a scrap to position `to` among the shown ones (one write). */
  const moveTo = (id: string, to: number) => {
    const v = moveOrder(shown, id, to);
    if (v == null) return;
    movePin(roomId, id, v).catch((e) => onToast(e?.message || 'Could not move that.'));
  };

  const canRemove = (p: Pin) => kindOf(p) === 'note' || p.by === me.uid;
  const remove = (p: Pin) => {
    setMenu(null);
    removePin(roomId, p.id).then(() => onToast(kindOf(p) === 'note' ? 'Note deleted' : 'Removed from the scrapbook')).catch((e) => onToast(e.message));
  };

  const open = (p: Pin) => {
    if (menu) { setMenu(null); return; }
    const k = kindOf(p);
    if (k === 'note') setEditing(p);
    else if (k === 'drop' && p.dropId) setDropOpen(p.dropId);
    else if (k === 'photo' && p.photoPath) setPhotoOpen(p.id);
    else if (p.messageId) { close(); onOpenMessage(p); }
  };

  // ---- drag to reorder (press and hold, then move) -------------------------------------
  const press = useRef<{ id: string; x: number; y: number; timer: number; dragging: boolean } | null>(null);
  const suppressClick = useRef(false);
  const stopScroll = (e: TouchEvent) => { if (press.current?.dragging) e.preventDefault(); };
  useEffect(() => () => removeEventListener('touchmove', stopScroll), []);

  const endPress = () => {
    const p = press.current;
    if (!p) return;
    clearTimeout(p.timer);
    press.current = null;
    removeEventListener('touchmove', stopScroll);
  };
  const onDown = (e: PointerEvent, id: string) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    endPress();
    const start = { id, x: e.clientX, y: e.clientY, dragging: false, timer: 0 };
    start.timer = window.setTimeout(() => {
      if (press.current !== start) return;
      start.dragging = true;
      suppressClick.current = true;
      addEventListener('touchmove', stopScroll, { passive: false });
      navigator.vibrate?.(10);
      setMenu(null);
      setDrag({ id, to: shown.findIndex((p) => p.id === id) });
    }, LONG_PRESS_MS);
    press.current = start;
  };
  const onMove = (e: PointerEvent) => {
    const p = press.current;
    if (!p) return;
    if (!p.dragging) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_SLOP) endPress(); // it's a scroll
      return;
    }
    e.preventDefault();
    // Which scrap is under the finger? Land there.
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-scrap]') as HTMLElement | null;
    const overId = el?.dataset.scrap;
    if (!overId || overId === p.id) return;
    const rest = shown.filter((x) => x.id !== p.id);
    const idx = rest.findIndex((x) => x.id === overId);
    if (idx < 0) return;
    const r = el!.getBoundingClientRect();
    // Past the middle of the target (reading order: right half, or lower half) → after it.
    const after = e.clientY > r.top + r.height * 0.75 || (e.clientY > r.top + r.height * 0.25 && e.clientX > r.left + r.width / 2);
    setDrag({ id: p.id, to: idx + (after ? 1 : 0) });
  };
  const onUp = () => {
    const p = press.current;
    const d = drag;
    endPress();
    if (p?.dragging && d) {
      const rest = shown.filter((x) => x.id !== d.id);
      const to = Math.max(0, Math.min(rest.length, d.to));
      moveTo(d.id, to);
    }
    setDrag(null);
    setTimeout(() => { suppressClick.current = false; }, 0);
  };

  const saveNote = async (text: string, colour: string) => {
    const target = editing;
    setEditing(null);
    try {
      if (target === 'new') {
        await addNote(roomId, me.uid, text, colour, topOrder(pins));
        onToast('Note added');
      } else if (target) {
        await editNote(roomId, target.id, me.uid, text, colour);
        onToast('Note saved');
      }
    } catch (e: any) { onToast(e?.message || 'Could not save the note.'); }
  };

  const photos = useMemo(() => board.filter((p) => kindOf(p) === 'photo' && p.photoPath).map((p) => ({
    id: p.id, uid: p.senderId || p.by, kind: 'photo', text: p.detail === 'No caption' ? '' : p.detail,
    photo: { path: p.photoPath!, width: 1, height: 1 }, createdAt: p.createdAt,
  }) as unknown as Message), [board]);

  return (
    <div class="scrapbook" role="dialog" aria-modal="true" aria-label="Scrapbook">
      <header class="scrap-top">
        <button type="button" class="icon-btn" onClick={close} aria-label="Close scrapbook"><BackIcon /></button>
        <div class="scrap-heading">
          <div class="scrap-h1">Scrapbook</div>
          <div class="scrap-h2">{pins.length ? `${pins.length} saved · hold to move` : 'Moments you keep'}</div>
        </div>
        <button type="button" class="btn-soft scrap-add" onClick={() => setEditing('new')}><PlusIcon /> Note</button>
      </header>
      <div class="scrap-filters" role="radiogroup" aria-label="Show">
        {FILTERS.map((f) => (
          <button type="button" key={f.id} role="radio" aria-checked={filter === f.id}
            class={`chip-btn${filter === f.id ? ' on' : ''}`} onClick={() => setFilter(f.id)}>{f.label}</button>
        ))}
      </div>

      <div class={`scrap-board${drag ? ' dragging' : ''}`} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        {view.length === 0 && (
          <div class="empty scrap-empty">
            {filter === 'all'
              ? 'Nothing here yet. Pin a Drop, a message or a photo — or write a note.'
              : `No ${FILTERS.find((f) => f.id === filter)?.label.toLowerCase()} pinned yet.`}
          </div>
        )}
        {view.map((p, i) => (
          <Scrap
            key={p.id}
            pin={p}
            me={me.uid}
            nameOf={nameOf}
            tabName={tabName}
            lifted={drag?.id === p.id}
            menuOpen={menu === p.id}
            canRemove={canRemove(p)}
            first={i === 0}
            last={i === view.length - 1}
            onDown={(e) => onDown(e, p.id)}
            onOpen={() => { if (!suppressClick.current) open(p); }}
            onMenu={() => setMenu((m) => (m === p.id ? null : p.id))}
            onEarlier={() => { setMenu(null); moveTo(p.id, i - 1); }}
            onLater={() => { setMenu(null); moveTo(p.id, i + 1); }}
            onRemove={() => remove(p)}
          />
        ))}
      </div>

      {editing && (
        <NoteEditor
          pin={editing === 'new' ? null : editing}
          editedBy={editing !== 'new' && editing.editedBy ? (editing.editedBy === me.uid ? 'you' : nameOf(editing.editedBy)) : ''}
          onSave={saveNote}
          onDelete={editing !== 'new' ? () => { const p = editing; setEditing(null); remove(p); } : undefined}
          onCancel={() => setEditing(null)}
        />
      )}
      {dropOpen && (
        <div class="scrap-pop" role="dialog" aria-modal="true" aria-label="Drop">
          <button type="button" class="scrim" onClick={() => setDropOpen(null)} aria-label="Close" />
          <div class="scrap-pop-card">
            <button type="button" class="scrap-pop-x" onClick={() => setDropOpen(null)} aria-label="Close Drop"><XIcon /></button>
            <DropCard roomId={roomId} dropId={dropOpen} me={me} partner={partner} pinned onPin={() => {}} />
          </div>
        </div>
      )}
      {photoOpen && photos.some((x) => x.id === photoOpen) && (
        <PhotoViewer photos={photos} startId={photoOpen} nameOf={(uid) => (uid === me.uid ? 'You' : nameOf(uid))}
          isPinned={() => true} onPin={() => {}} onClose={() => setPhotoOpen(null)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------- one scrap

interface ScrapProps {
  pin: Pin;
  me: string;
  nameOf(uid: string): string;
  tabName(id: string | null): string;
  lifted: boolean;
  menuOpen: boolean;
  canRemove: boolean;
  first: boolean;
  last: boolean;
  onDown(e: PointerEvent): void;
  onOpen(): void;
  onMenu(): void;
  onEarlier(): void;
  onLater(): void;
  onRemove(): void;
}

function Scrap(p: ScrapProps) {
  const { pin } = p;
  const kind = kindOf(pin);
  const who = (uid: string) => (uid === p.me ? 'you' : p.nameOf(uid));
  const meta = [kind === 'note' ? `by ${who(pin.by)}` : `pinned by ${who(pin.by)}`, dateOf(pin)].filter(Boolean).join(' · ');
  const tab = pin.tabId ? p.tabName(pin.tabId) : '';
  const label = kind === 'note' ? `Note: ${pin.detail}` : kind === 'photo' ? `Photo: ${pin.title}` : `${pin.title}: ${pin.detail}`;

  return (
    <div
      data-scrap={pin.id}
      class={`scrap kind-${kind}${p.lifted ? ' lifted' : ''}`}
      style={kind === 'note' ? { background: pin.colour || NOTE_COLOURS[0] } : undefined}
      onPointerDown={p.onDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button type="button" class="scrap-open" onClick={p.onOpen} aria-label={label}>
        {kind === 'note' && <div class="scrap-note-text">{pin.detail}</div>}
        {kind === 'drop' && (
          <div class="scrap-drop">
            <div class="scrap-drop-head">
              <span class="drop-icon small"><DropIcon size={14} /></span>
              <span class="scrap-drop-title">{pin.title}</span>
            </div>
            <div class="scrap-drop-detail">{pin.detail}</div>
            <div class="scrap-drop-open">Tap to open</div>
          </div>
        )}
        {kind === 'message' && (
          <div class={`scrap-msg${pin.senderId === p.me ? ' mine' : ''}`}>
            <div class="scrap-msg-who">{pin.senderId ? who(pin.senderId) : pin.title}</div>
            <div class="scrap-msg-text">{pin.detail}</div>
          </div>
        )}
        {kind === 'photo' && <ScrapPhoto path={pin.photoPath || ''} caption={pin.detail === 'No caption' ? '' : pin.detail} />}
      </button>
      <div class="scrap-meta">
        <span class="scrap-meta-text">{meta}{tab && tab !== 'General' ? ` · ${tab}` : ''}{pin.editedBy && kind === 'note' ? ` · edited by ${who(pin.editedBy)}` : ''}</span>
        <button type="button" class="scrap-more" onClick={p.onMenu} aria-expanded={p.menuOpen} aria-label="Scrap options">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
        </button>
      </div>
      {p.menuOpen && (
        <div class="scrap-menu" role="group" aria-label="Scrap options">
          <button type="button" disabled={p.first} onClick={p.onEarlier}>Move earlier</button>
          <button type="button" disabled={p.last} onClick={p.onLater}>Move later</button>
          {p.canRemove && <button type="button" class="danger-text" onClick={p.onRemove}>{kind === 'note' ? 'Delete' : 'Remove'}</button>}
        </div>
      )}
    </div>
  );
}

function ScrapPhoto({ path, caption }: { path: string; caption: string }) {
  const url = usePhoto(path);
  return (
    <div class="scrap-photo">
      {url ? <img src={url} alt={caption || 'Pinned photo'} loading="lazy" decoding="async" draggable={false} /> : <span class="uploading">Loading…</span>}
      {caption && <div class="scrap-photo-cap">{caption}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------- note editor

function NoteEditor({ pin, editedBy, onSave, onDelete, onCancel }: {
  pin: Pin | null; editedBy: string; onSave(text: string, colour: string): void; onDelete?(): void; onCancel(): void;
}) {
  const [text, setText] = useState(pin?.detail || '');
  const [colour, setColour] = useState(pin?.colour || NOTE_COLOURS[0]);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { area.current?.focus(); }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);
  return (
    <div class="sheet-wrap scrap-editor-wrap">
      <button type="button" class="scrim" onClick={onCancel} aria-label="Close" />
      <div class="sheet" role="dialog" aria-modal="true" aria-label={pin ? 'Edit note' : 'New note'}>
      <form class="stack" onSubmit={(e) => { e.preventDefault(); if (text.trim()) onSave(text, colour); }}>
        <div class="sheet-title">{pin ? 'Edit note' : 'New note'}</div>
        {editedBy && <div class="sheet-sub">Last edited by {editedBy}</div>}
        <label for="note-text" class="sr">Note</label>
        <textarea id="note-text" ref={area} class="field note-field" style={{ background: colour }} rows={6} maxLength={NOTE_MAX}
          value={text} placeholder="Plans, a memory, a list…" onInput={(e) => setText(e.currentTarget.value)} />
        <div class="fine note-count">{text.length}/{NOTE_MAX}</div>
        <div class="colour-row" role="radiogroup" aria-label="Note colour">
          {NOTE_COLOURS.map((c) => (
            <button type="button" key={c} role="radio" aria-checked={colour === c} aria-label={`Colour ${c}`}
              class={`colour-opt${colour === c ? ' on' : ''}`} style={{ background: c }} onClick={() => setColour(c)} />
          ))}
        </div>
        <button class="btn-primary" disabled={!text.trim()}>{pin ? 'Save note' : 'Add note'}</button>
        {onDelete && <button type="button" class="btn-ghost danger-text" onClick={onDelete}>Delete note</button>}
      </form>
      </div>
    </div>
  );
}
