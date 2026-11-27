import { describe, expect, it } from 'vitest';
import { blockedHelp } from '../../src/data/push';

describe('blockedHelp', () => {
  it('iPhone → Settings app', () => expect(blockedHelp('iPhone', true)).toMatch(/iPhone Settings → Notifications → Hi/));
  it('Mac Safari → Websites → Notifications', () =>
    expect(blockedHelp('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15', false)).toMatch(/Safari → Settings → Websites/));
  it('Chrome on Mac → site settings', () =>
    expect(blockedHelp('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', false)).toMatch(/Site settings/));
  it('Firefox', () => expect(blockedHelp('Mozilla/5.0 (Windows NT 10.0; rv:133.0) Gecko/20100101 Firefox/133.0', false)).toMatch(/Firefox/));
});
