import type { Message, Tab } from '../types';
import { searchable } from './search';

/** What an export holds: one chat (all tabs, or one tab), messages I can see, oldest first. */
export interface ExportData {
  title: string;
  me: { uid: string; name: string };
  partner: { uid: string; name: string };
  tabs: Pick<Tab, 'id' | 'name' | 'colour'>[];
  messages: Message[];
  exportedAt: number;
}

const ms = (t: unknown) => {
  const x = t as { toMillis?: () => number } | null | undefined;
  return x && typeof x.toMillis === 'function' ? x.toMillis() : 0;
};

/** Messages worth exporting: not deleted, not deleted-for-me, not expired, not setting notices. */
export const exportable = (msgs: Message[], me: string, now = Date.now()) =>
  msgs.filter((m) => searchable(m, me, now)).sort((a, b) => ms(a.createdAt) - ms(b.createdAt));

const pad = (n: number) => String(n).padStart(2, '0');
/** "2026-11-24" in local time. */
export const dayOf = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
/** "18:05" in local time. */
export const timeOf = (t: number) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/** One line of text for a message (no hidden Drop answers, ever). */
export function lineText(m: Message, file?: string): string {
  switch (m.kind) {
    case 'text': return m.text;
    case 'link': return [m.text, m.link?.url].filter(Boolean).join(' ');
    case 'photo': return `[Photo${file ? `: ${file}` : ''}]${m.text ? ` ${m.text}` : ''}`;
    case 'voice': return `[Voice note, ${Math.round((m.voice?.durationMs || 0) / 1000)} s${file ? `: ${file}` : ''}]`;
    case 'drop': return '[Drop]';
    default: return '';
  }
}

export function dateRange(msgs: Message[]): string {
  if (!msgs.length) return 'No messages';
  const a = dayOf(ms(msgs[0].createdAt));
  const b = dayOf(ms(msgs[msgs.length - 1].createdAt));
  return a === b ? a : `${a} – ${b}`;
}

/** Messages grouped by tab (in tab order), then by day. */
export function groups(data: ExportData) {
  const msgs = exportable(data.messages, data.me.uid, data.exportedAt);
  return data.tabs
    .map((t) => {
      const inTab = msgs.filter((m) => m.tabId === t.id);
      const days: { day: string; messages: Message[] }[] = [];
      inTab.forEach((m) => {
        const day = dayOf(ms(m.createdAt));
        const last = days[days.length - 1];
        if (last && last.day === day) last.messages.push(m);
        else days.push({ day, messages: [m] });
      });
      return { tab: t, days, count: inTab.length };
    })
    .filter((g) => g.count > 0);
}

/**
 * chat.txt: a readable transcript.
 *   Hi · Alice & Bob
 *   2026-11-20 – 2026-11-24
 *
 *   == General ==
 *   -- 2026-11-24 --
 *   [18:05] Alice: hello
 */
export function toText(data: ExportData, files: Record<string, string> = {}): string {
  const nameOf = (uid: string) => (uid === data.me.uid ? data.me.name : uid === data.partner.uid ? data.partner.name : 'Someone');
  const all = exportable(data.messages, data.me.uid, data.exportedAt);
  const out = [data.title, dateRange(all), `Exported ${dayOf(data.exportedAt)} ${timeOf(data.exportedAt)}`, ''];
  for (const g of groups(data)) {
    out.push(`== ${g.tab.name} ==`);
    for (const d of g.days) {
      out.push(`-- ${d.day} --`);
      for (const m of d.messages) out.push(`[${timeOf(ms(m.createdAt))}] ${nameOf(m.uid)}: ${lineText(m, files[m.id])}`);
    }
    out.push('');
  }
  return out.join('\n');
}

/** chat.json: the same messages as plain data. */
export function toJson(data: ExportData, files: Record<string, string> = {}) {
  return {
    title: data.title,
    exportedAt: new Date(data.exportedAt).toISOString(),
    people: [data.me, data.partner],
    tabs: data.tabs.map((t) => ({ id: t.id, name: t.name })),
    messages: exportable(data.messages, data.me.uid, data.exportedAt).map((m) => ({
      id: m.id,
      tab: m.tabId,
      from: m.uid,
      at: new Date(ms(m.createdAt)).toISOString(),
      kind: m.kind,
      text: m.text || '',
      ...(m.link ? { link: { url: m.link.url, title: m.link.title } } : {}),
      ...(m.replyTo ? { replyTo: m.replyTo.msgId } : {}),
      ...(m.editedAt ? { edited: true } : {}),
      ...(files[m.id] ? { file: files[m.id] } : {}),
    })),
  };
}

/** A safe file name: "Hi chat - Alice & Bob - 2026-11-24". */
export const exportName = (data: Pick<ExportData, 'partner' | 'exportedAt'>) =>
  `Hi chat - ${data.partner.name.replace(/[\\/:*?"<>|]+/g, '').slice(0, 40) || 'chat'} - ${dayOf(data.exportedAt)}`;
