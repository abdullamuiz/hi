import { describe, expect, it } from 'vitest';
import { INSTALL_STEPS, installHow } from '../../src/lib/install';

const UA = {
  chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  edgeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  firefoxWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  firefoxAndroid: 'Mozilla/5.0 (Android 14; Mobile; rv:133.0) Gecko/133.0 Firefox/133.0',
};

describe('installHow', () => {
  it('knows when Hi is already installed', () => expect(installHow(UA.chromeMac, true)).toBe('installed'));
  it('Chrome and Edge without a prompt yet → address-bar steps', () => {
    expect(installHow(UA.chromeMac, false)).toBe('chromium');
    expect(installHow(UA.edgeWin, false)).toBe('chromium');
  });
  it('Safari on Mac → Add to Dock', () => expect(installHow(UA.safariMac, false)).toBe('safari-mac'));
  it('iPhone → Add to Home Screen', () => expect(installHow(UA.iphone, false)).toBe('ios'));
  it('Firefox: desktop unsupported, Android menu', () => {
    expect(installHow(UA.firefoxWin, false)).toBe('firefox');
    expect(installHow(UA.firefoxAndroid, false)).toBe('firefox-android');
  });
  it('has steps for every non-prompt case', () => {
    for (const k of ['ios', 'safari-mac', 'firefox', 'firefox-android', 'chromium', 'other'] as const) expect(INSTALL_STEPS[k].length).toBeGreaterThan(10);
  });
});
