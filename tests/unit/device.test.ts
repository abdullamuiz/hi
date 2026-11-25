import { describe, expect, it } from 'vitest';
import { activeAgo, labelFor, needsReauth } from '../../src/lib/device';

const UA = {
  chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  edgeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  chromeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1',
  pixel: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  samsungTab: 'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Safari/537.36',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
};

describe('device labels', () => {
  it('names the browser and the system', () => {
    expect(labelFor(UA.chromeMac)).toEqual({ label: 'Chrome on Mac', kind: 'computer' });
    expect(labelFor(UA.edgeWin).label).toBe('Edge on Windows');
    expect(labelFor(UA.safariMac).label).toBe('Safari on Mac');
    expect(labelFor(UA.iphone)).toEqual({ label: 'Safari on iPhone', kind: 'phone' });
    expect(labelFor(UA.chromeIos).label).toBe('Chrome on iPhone');
    expect(labelFor(UA.pixel)).toEqual({ label: 'Chrome on Android', kind: 'phone' });
    expect(labelFor(UA.samsungTab)).toEqual({ label: 'Samsung Internet on Android', kind: 'tablet' });
    expect(labelFor(UA.firefoxLinux).label).toBe('Firefox on Linux');
  });
  it('says "Hi app" when installed, and spots iPads that look like Macs', () => {
    expect(labelFor(UA.iphone, true).label).toBe('Hi app on iPhone');
    expect(labelFor(UA.safariMac, false, 5)).toEqual({ label: 'Safari on iPad', kind: 'tablet' });
  });
});

describe('active time and re-auth', () => {
  const now = 1_800_000_000_000;
  it('reads like a person would say it', () => {
    expect(activeAgo(now - 60_000, now)).toBe('Active now');
    expect(activeAgo(now - 30 * 60_000, now)).toBe('Active 30 min ago');
    expect(activeAgo(now - 2 * 86_400_000, now)).toBe('Active 2 days ago');
    expect(activeAgo(null, now)).toBe('Not active yet');
  });
  it('asks to confirm unless this sign-in is recent and the newest', () => {
    const t = now / 1000;
    expect(needsReauth(t - 30, [t - 3600], now)).toBe(false);
    expect(needsReauth(t - 3600, [], now)).toBe(true);
    expect(needsReauth(t - 30, [t - 10], now)).toBe(true);
  });
});
