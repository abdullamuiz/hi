import { useEffect, useState } from 'preact/hooks';
import { INSTALL_STEPS, installHow, onInstallChange, promptInstall, type InstallHow } from '../lib/install';

function useInstallHow(): InstallHow {
  const [how, setHow] = useState<InstallHow>(installHow);
  useEffect(() => onInstallChange(() => setHow(installHow())), []);
  return how;
}

/** Settings row: "Install Hi" with the browser's prompt or the steps for this browser. */
export function InstallRow() {
  const how = useInstallHow();
  const [open, setOpen] = useState(false);
  if (how === 'installed') return <div class="settings-row"><span>App</span><span>Installed ✓</span></div>;
  return (
    <>
      <div class="settings-row">
        <span>Install Hi on this device</span>
        {how === 'prompt'
          ? <button type="button" class="link-btn" onClick={() => promptInstall()}>Install</button>
          : <button type="button" class="link-btn" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide' : 'How?'}</button>}
      </div>
      {open && how !== 'prompt' && <div class="fine install-steps">{INSTALL_STEPS[how]}</div>}
    </>
  );
}

const DISMISS_KEY = 'hi.install.dismissed';

/** A small, dismissible banner shown only when the browser can install Hi in one tap. */
export function InstallBanner() {
  const how = useInstallHow();
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; } });
  if (how !== 'prompt' || hidden) return null;
  const dismiss = () => { setHidden(true); try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ } };
  return (
    <div class="install-banner" role="region" aria-label="Install Hi">
      <img src="./icons/icon-192.png" alt="" width={32} height={32} />
      <span>Install Hi for quick access and notifications.</span>
      <button type="button" class="btn-primary small" onClick={() => promptInstall()}>Install</button>
      <button type="button" class="link-btn" aria-label="Not now" onClick={dismiss}>✕</button>
    </div>
  );
}
