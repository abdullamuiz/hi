import { useEffect, useRef, useState } from 'preact/hooks';
import type { Timestamp } from 'firebase/firestore';
import { GENERAL, TAB_COLOURS, watchUnread } from '../data/tabs';
import type { Tab } from '../types';

interface BarProps {
  roomId: string;
  me: string;
  tabs: Tab[];
  active: string;
  lastRead: Record<string, Timestamp>;
  onSelect(tabId: string): void;
  onOptions(tabId: string): void;
  onAdd(): void;
  onArchived(): void;
  onUnreadTotal(n: number): void;
}

/** Horizontal tab bar under the header: colour dot, name, unread count, "+". */
export function TabBar({ roomId, me, tabs, active, lastRead, onSelect, onOptions, onAdd, onArchived, onUnreadTotal }: BarProps) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const activeRef = useRef<HTMLButtonElement>(null);
  const visible = tabs.filter((t) => !t.archived || t.id === active);
  const archived = tabs.filter((t) => t.archived).length;

  useEffect(() => {
    const total = Object.entries(counts).reduce((n, [id, c]) => n + (id === active ? 0 : c), 0);
    onUnreadTotal(total);
  }, [counts, active]);

  useEffect(() => { activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [active]);

  const setCount = (id: string, n: number) => setCounts((c) => (c[id] === n ? c : { ...c, [id]: n }));

  return (
    <nav class="tabbar" aria-label="Tabs">
      <div class="tabbar-row" role="tablist">
        {visible.map((t) => (
          <TabChip
            key={t.id}
            tab={t}
            selected={t.id === active}
            refEl={t.id === active ? activeRef : undefined}
            roomId={roomId}
            me={me}
            since={lastRead[t.id] ?? null}
            onCount={setCount}
            onClick={() => (t.id === active ? onOptions(t.id) : onSelect(t.id))}
          />
        ))}
        {archived > 0 && (
          <button type="button" class="tab-chip ghost" onClick={onArchived}>Archived · {archived}</button>
        )}
        <button type="button" class="tab-add" onClick={onAdd} aria-label="New tab">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      </div>
    </nav>
  );
}

interface ChipProps {
  tab: Tab;
  selected: boolean;
  refEl?: preact.RefObject<HTMLButtonElement | null>;
  roomId: string;
  me: string;
  since: Timestamp | null;
  onCount(id: string, n: number): void;
  onClick(): void;
}

function TabChip({ tab, selected, refEl, roomId, me, since, onCount, onClick }: ChipProps) {
  const [unread, setUnread] = useState(0);
  const sinceMs = since ? since.toMillis() : 0;

  // Count the other person's messages since I last read this tab (not for the open tab).
  useEffect(() => {
    if (selected) { setUnread(0); onCount(tab.id, 0); return; }
    return watchUnread(roomId, tab.id, since, me, (n) => { setUnread(n); onCount(tab.id, n); });
  }, [roomId, tab.id, sinceMs, selected, me]);

  return (
    <button
      ref={refEl}
      type="button"
      role="tab"
      aria-selected={selected}
      class={`tab-chip${selected ? ' on' : ''}`}
      onClick={onClick}
      aria-label={`${tab.name}${unread ? `, ${unread} unread` : ''}${selected ? ' (tap for options)' : ''}`}
    >
      <span class="tab-dot" style={{ background: tab.colour }} aria-hidden="true" />
      <span class="tab-name">{tab.name}</span>
      {unread > 0 && <span class="tab-unread" aria-hidden="true">{unread > 98 ? '99+' : unread}</span>}
      {selected && (
        <svg aria-hidden="true" class="tab-more" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------- sheets

interface TabSheetProps {
  tab?: Tab;
  onSave(name: string, colour: string): void;
  onArchive?(archived: boolean): void;
}

/** New tab, or options for an existing one: rename, colour, archive. */
export function TabSheet({ tab, onSave, onArchive }: TabSheetProps) {
  const [name, setName] = useState(tab?.name ?? '');
  const [colour, setColour] = useState(tab?.colour ?? TAB_COLOURS[1]);
  const isGeneral = tab?.id === GENERAL;

  const submit = (e: Event) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave(name, colour);
  };

  return (
    <form class="stack" style={{ gap: '14px' }} onSubmit={submit}>
      <div>
        <div class="sheet-title">{tab ? 'Tab options' : 'New tab'}</div>
        <div class="sheet-sub">{tab ? 'Changes show for both of you' : 'A separate conversation, e.g. "Trip plans" or "Films"'}</div>
      </div>
      <div class="stack" style={{ gap: '6px' }}>
        <label class="field-label" for="tab-name">Name</label>
        <input id="tab-name" class="field" value={name} maxLength={30} placeholder="Tab name" autocomplete="off"
          onInput={(e) => setName(e.currentTarget.value)} />
      </div>
      <div class="stack" style={{ gap: '6px' }}>
        <div class="field-label" id="tab-colour-label">Colour</div>
        <div class="colour-row" role="radiogroup" aria-labelledby="tab-colour-label">
          {TAB_COLOURS.map((c) => (
            <button type="button" key={c} role="radio" aria-checked={colour === c} aria-label={c}
              class={`colour-opt${colour === c ? ' on' : ''}`} style={{ background: c }} onClick={() => setColour(c)} />
          ))}
        </div>
      </div>
      <button class="btn-primary" disabled={!name.trim()}>{tab ? 'Save' : 'Create tab'}</button>
      {tab && onArchive && !isGeneral && (
        <button type="button" class="btn-ghost" onClick={() => onArchive(!tab.archived)}>
          {tab.archived ? 'Unarchive tab' : 'Archive tab'}
        </button>
      )}
      {isGeneral && <div class="fine">General is always here and can't be archived.</div>}
    </form>
  );
}

export function ArchivedSheet({ tabs, onOpen, onUnarchive }: { tabs: Tab[]; onOpen(id: string): void; onUnarchive(id: string): void }) {
  const list = tabs.filter((t) => t.archived);
  return (
    <div class="stack">
      <div>
        <div class="sheet-title">Archived tabs</div>
        <div class="sheet-sub">Hidden from the tab bar. Messages are kept.</div>
      </div>
      {list.length === 0 && <div class="empty">No archived tabs.</div>}
      {list.map((t) => (
        <div class="archived-row" key={t.id}>
          <span class="tab-dot" style={{ background: t.colour }} aria-hidden="true" />
          <span class="archived-name">{t.name}</span>
          <button type="button" class="link-btn" onClick={() => onOpen(t.id)}>Open</button>
          <button type="button" class="link-btn" onClick={() => onUnarchive(t.id)}>Unarchive</button>
        </div>
      ))}
    </div>
  );
}
