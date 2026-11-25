import { describe, expect, it } from 'vitest';
import { expiryFor, isExpired, notExpired, systemText, tabTtl, ttlLabel, validTtl } from '../../src/lib/disappear';
import { excerpt, highlight, matches, normalise, search, searchable, terms } from '../../src/lib/search';
import { dateRange, exportable, exportName, groups, lineText, toJson, toText, type ExportData } from '../../src/lib/exportFormat';
import type { Message } from '../../src/types';

const ts = (ms: number) => ({ toMillis: () => ms }) as any;
const H = 3_600_000;
const NOW = Date.UTC(2026, 10, 24, 12, 0);
const msg = (id: string, extra: Partial<Message> = {}): Message =>
  ({ id, tabId: 'general', uid: 'a', kind: 'text', text: '', createdAt: ts(NOW - 60_000), ...extra }) as Message;

describe('disappearing tabs', () => {
  it('only offers 24 hours, 7 days and 90 days', () => {
    expect(validTtl(168)).toBe(168);
    expect(validTtl(5)).toBe(24);
    expect(validTtl(undefined)).toBe(24);
    expect(ttlLabel(2160)).toBe('90 days');
  });
  it('a tab’s lifetime is 0 when it keeps messages', () => {
    expect(tabTtl({ disappearing: false, ttlHours: 168 })).toBe(0);
    expect(tabTtl({ disappearing: true, ttlHours: 168 })).toBe(168);
    expect(tabTtl(undefined)).toBe(0);
  });
  it('expiry is sent time plus the setting', () => {
    expect(expiryFor(24, NOW)).toBe(NOW + 24 * H);
    expect(expiryFor(0, NOW)).toBeNull();
  });
  it('hides expired messages straight away', () => {
    const list = [msg('keep'), msg('soon', { expiresAt: ts(NOW + 1000) }), msg('gone', { expiresAt: ts(NOW - 1) })];
    expect(isExpired(list[2], NOW)).toBe(true);
    expect(isExpired(list[0], NOW)).toBe(false);
    expect(notExpired(list, NOW).map((m) => m.id)).toEqual(['keep', 'soon']);
  });
  it('announces changes in words', () => {
    expect(systemText({ system: 'disappearing', ttlHours: 168 }, 'Alice')).toBe('Alice turned on disappearing messages (7 days)');
    expect(systemText({ system: 'disappearing', ttlHours: 0 }, 'You')).toBe('You turned off disappearing messages');
  });
});

describe('search', () => {
  it('ignores case and accents', () => {
    expect(normalise('Café CRÈME')).toBe('cafe creme');
    expect(terms('  Café   au lait ')).toEqual(['cafe', 'au', 'lait']);
  });
  it('needs every word, in any order, in text or link details', () => {
    expect(matches({ text: 'Dinner at the café tonight' }, terms('tonight cafe'))).toBe(true);
    expect(matches({ text: 'Dinner tonight' }, terms('cafe'))).toBe(false);
    expect(matches({ text: '', link: { title: 'Best ramen in Malé', url: 'https://x.mv' } as any }, terms('ramen male'))).toBe(true);
  });
  it('leaves out deleted, hidden, expired and setting messages', () => {
    expect(searchable(msg('1'), 'a', NOW)).toBe(true);
    expect(searchable(msg('2', { deleted: true }), 'a', NOW)).toBe(false);
    expect(searchable(msg('3', { hiddenFor: ['a'] }), 'a', NOW)).toBe(false);
    expect(searchable(msg('3', { hiddenFor: ['b'] }), 'a', NOW)).toBe(true);
    expect(searchable(msg('4', { expiresAt: ts(NOW - 1) }), 'a', NOW)).toBe(false);
    expect(searchable(msg('5', { kind: 'system' }), 'a', NOW)).toBe(false);
  });
  it('orders newest first; a kind filter with no words is a gallery', () => {
    const items = [
      { msg: msg('old', { text: 'pizza', createdAt: ts(NOW - 2 * H) }) },
      { msg: msg('new', { text: 'more pizza', createdAt: ts(NOW - H) }) },
      { msg: msg('pic', { kind: 'photo', text: '', createdAt: ts(NOW - 3 * H) }) },
    ];
    expect(search(items, 'pizza', 'all', 'a', NOW).map((i) => i.msg.id)).toEqual(['new', 'old']);
    expect(search(items, '', 'all', 'a', NOW)).toEqual([]);
    expect(search(items, '', 'photos', 'a', NOW).map((i) => i.msg.id)).toEqual(['pic']);
    expect(search(items, 'pizza', 'photos', 'a', NOW)).toEqual([]);
  });
  it('highlights matches but keeps the original characters', () => {
    expect(highlight('See you at the Café!', terms('cafe'))).toEqual([
      { text: 'See you at the ', hit: false }, { text: 'Café', hit: true }, { text: '!', hit: false },
    ]);
    expect(highlight('abc', [])).toEqual([{ text: 'abc', hit: false }]);
  });
  it('shows the part of a long message around the match', () => {
    const long = `${'x '.repeat(100)}needle ${'y '.repeat(100)}`;
    const e = excerpt(long, terms('needle'), 60);
    expect(e).toContain('needle');
    expect(e.startsWith('…')).toBe(true);
    expect(e.length).toBeLessThanOrEqual(62);
  });
});

describe('export', () => {
  const data: ExportData = {
    title: 'Hi · Alice & Bob',
    me: { uid: 'a', name: 'Alice' },
    partner: { uid: 'b', name: 'Bob' },
    tabs: [{ id: 'general', name: 'General', colour: '#000000' }, { id: 'trip', name: 'Trip', colour: '#111111' }],
    messages: [
      msg('m2', { uid: 'b', text: 'second', createdAt: ts(NOW - H) }),
      msg('m1', { text: 'first', createdAt: ts(NOW - 2 * H) }),
      msg('t1', { tabId: 'trip', kind: 'link', text: 'look', link: { url: 'https://example.com' } as any, createdAt: ts(NOW - 3 * H) }),
      msg('gone', { text: 'secret', deleted: true }),
      msg('hid', { text: 'hidden', hiddenFor: ['a'] }),
      msg('sys', { kind: 'system', text: 'Disappearing messages: 24 hours' }),
      msg('p1', { kind: 'photo', text: 'sunset', photo: { path: 'x', width: 1, height: 1 }, createdAt: ts(NOW - 30 * 60_000) }),
    ],
    exportedAt: NOW,
  };
  it('keeps only messages I can see, oldest first', () => {
    expect(exportable(data.messages, 'a', NOW).map((m) => m.id)).toEqual(['t1', 'm1', 'm2', 'p1']);
  });
  it('groups by tab (in tab order), then by day', () => {
    const g = groups(data);
    expect(g.map((x) => x.tab.name)).toEqual(['General', 'Trip']);
    expect(g[0].days[0].messages.map((m) => m.id)).toEqual(['m1', 'm2', 'p1']);
  });
  it('writes a readable transcript without deleted or hidden messages', () => {
    const txt = toText(data, { p1: 'photos/p1.jpg' });
    expect(txt.split('\n')[0]).toBe('Hi · Alice & Bob');
    expect(txt).toContain('== General ==');
    expect(txt).toMatch(/\] Alice: first/);
    expect(txt).toMatch(/\] Bob: second/);
    expect(txt).toContain('[Photo: photos/p1.jpg] sunset');
    expect(txt).toContain('look https://example.com');
    expect(txt).not.toContain('secret');
    expect(txt).not.toContain('hidden');
    expect(txt).not.toContain('Disappearing');
  });
  it('json lists people, tabs and messages', () => {
    const j = toJson(data);
    expect(j.people.map((p) => p.name)).toEqual(['Alice', 'Bob']);
    expect(j.messages).toHaveLength(4);
    expect(j.messages[0]).toMatchObject({ id: 't1', tab: 'trip', kind: 'link', link: { url: 'https://example.com' } });
  });
  it('describes voice notes and Drops without their contents', () => {
    expect(lineText(msg('v', { kind: 'voice', voice: { durationMs: 12_400 } as any }))).toBe('[Voice note, 12 s]');
    expect(lineText(msg('d', { kind: 'drop', dropId: 'x' }))).toBe('[Drop]');
  });
  it('has a sensible range and file name', () => {
    expect(dateRange([])).toBe('No messages');
    expect(exportName({ partner: { uid: 'b', name: 'Bob/Smith' }, exportedAt: NOW })).toMatch(/^Hi chat - BobSmith - 2026-11-2\d$/);
    expect(exportName({ partner: { uid: 'b', name: 'Bobby 🐻' }, exportedAt: NOW })).toMatch(/^Hi chat - Bobby - 2026-11-2\d$/);
    expect(exportName({ partner: { uid: 'b', name: 'Zoë 🌸' }, exportedAt: NOW })).toMatch(/^Hi chat - Zoë - /);
    expect(exportName({ partner: { uid: 'b', name: '🐻' }, exportedAt: NOW })).toMatch(/^Hi chat - chat - /);
  });
});
