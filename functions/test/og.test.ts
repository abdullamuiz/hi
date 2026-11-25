import { describe, expect, it } from 'vitest';
import { decodeEntities, fetchPreview, isPrivateAddress, parseOpenGraph } from '../src/og';
import { notificationBody } from '../src/notify';

describe('parseOpenGraph', () => {
  it('prefers og tags, resolves relative images, decodes entities', () => {
    const html = `<html><head>
      <title>Fallback</title>
      <meta property="og:title" content="Interstellar &amp; Beyond">
      <meta content='A trailer &#39;n stuff' property='og:description'>
      <meta property="og:image" content="/img/poster.jpg">
      <meta property="og:site_name" content="YouTube">
    </head><body><meta property="og:title" content="ignored"></body></html>`;
    expect(parseOpenGraph(html, 'https://www.youtube.com/watch?v=1')).toEqual({
      title: 'Interstellar & Beyond',
      description: "A trailer 'n stuff",
      image: 'https://www.youtube.com/img/poster.jpg',
      siteName: 'YouTube',
    });
  });

  it('falls back to twitter tags, <title> and meta description', () => {
    const html = `<head><title> Plain  page </title><meta name="description" content="About it"><meta name="twitter:image" content="http://cdn.example.com/a.png"></head>`;
    expect(parseOpenGraph(html, 'https://example.com')).toEqual({
      title: 'Plain page', description: 'About it', image: 'https://cdn.example.com/a.png', siteName: null,
    });
  });

  it('drops javascript: images', () => {
    const html = `<head><meta property="og:image" content="javascript:alert(1)"></head>`;
    expect(parseOpenGraph(html, 'https://example.com').image).toBeNull();
  });

  it('decodes numeric entities', () => {
    expect(decodeEntities('&#x2014; &#8212; &unknown;')).toBe('— — &unknown;');
  });
});

describe('isPrivateAddress', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1'])('%s is private', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });
  it.each(['8.8.8.8', '142.250.1.1', '2607:f8b0::1'])('%s is public', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe('fetchPreview', () => {
  it('refuses internal addresses (SSRF)', async () => {
    await expect(fetchPreview('http://169.254.169.254/latest/meta-data')).rejects.toThrow(/non-public/);
    await expect(fetchPreview('http://127.0.0.1:8080/')).rejects.toThrow();
  });

  it('follows redirects and re-checks each hop', async () => {
    const calls: string[] = [];
    const fake = (async (u: URL) => {
      calls.push(String(u));
      if (calls.length === 1) return new Response(null, { status: 302, headers: { location: 'http://10.0.0.1/' } });
      return new Response('<head><title>x</title></head>', { headers: { 'content-type': 'text/html' } });
    }) as unknown as typeof fetch;
    await expect(fetchPreview('https://93.184.215.14/', fake)).rejects.toThrow(/non-public/);
    expect(calls).toHaveLength(1);
  });

  it('parses a fetched page', async () => {
    const fake = (async () => new Response('<head><meta property="og:title" content="Hi"></head>', { headers: { 'content-type': 'text/html; charset=utf-8' } })) as unknown as typeof fetch;
    const r = await fetchPreview('https://93.184.215.14/page', fake);
    expect(r.title).toBe('Hi');
  });
});

describe('notificationBody', () => {
  it('never leaks drop answers and summarises each kind', () => {
    expect(notificationBody({ kind: 'text', text: 'hello' })).toBe('hello');
    expect(notificationBody({ kind: 'voice', text: '' })).toBe('🎤 Voice note');
    expect(notificationBody({ kind: 'photo', text: '' })).toBe('Sent a photo');
    expect(notificationBody({ kind: 'drop', dropType: 'blind-reveal' })).toBe('Dropped a Blind Reveal — your move');
    expect(notificationBody({ kind: 'link', text: '', link: { domain: 'youtube.com' } })).toBe('Shared a link from youtube.com');
  });

  it('keeps sealed and whispered words off the lock screen, and marks screen effects', () => {
    expect(notificationBody({ kind: 'text', text: 'the secret', effect: 'sealed' })).toBe('✉️ Sent you a sealed message');
    expect(notificationBody({ kind: 'text', text: 'the secret', effect: 'whisper' })).toBe('🤫 Whispered something');
    expect(notificationBody({ kind: 'text', text: 'Happy birthday!', effect: 'balloons' })).toBe('🎈 Happy birthday!');
    expect(notificationBody({ kind: 'text', text: 'LOUD', effect: 'shout' })).toBe('LOUD');
  });
});

describe('Drops and threads in push text', async () => {
  const { DROP_TITLES, threadBody } = await import('../src/notify');
  it('names every Drop in the app', async () => {
    const fs = await import('node:fs');
    const files = fs.readdirSync(new URL('../../src/drops/', import.meta.url)).filter((f: string) => f.endsWith('.drop.tsx'));
    const types = files.map((f: string) => /type: '([a-z0-9-]+)'/.exec(fs.readFileSync(new URL(`../../src/drops/${f}`, import.meta.url), 'utf8'))![1]);
    for (const t of types) expect(DROP_TITLES[t], t).toBeTruthy();
    expect(notificationBody({ kind: 'drop', dropType: 'poll' })).toBe('Dropped a Poll — your move');
  });
  it('labels thread replies and keeps them short', () => {
    expect(threadBody('see  you\nthere')).toBe('💬 In a thread: see you there');
    expect(threadBody('x'.repeat(200)).length).toBeLessThan(140);
  });
});
