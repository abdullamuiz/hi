import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { User } from 'firebase/auth';
import {
  approveDevice, makePrimary, nameOf, renameDevice, requestEmailApproval, setProtection, signOutDevice,
  signOutOthers, watchDevices, watchSecurity, type Device, type Security,
} from '../data/devices';
import { signOut } from '../data/auth';
import { activeAgo, deviceId } from '../lib/device';
import { closeDevices, onDevicesUi } from '../lib/devicesUi';
import { closeOverlay, forgetOverlay, openOverlay } from '../lib/overlay';
import { BackIcon } from './icons';

const TWO_STEP = 'https://myaccount.google.com/signinoptions/two-step-verification';
const icon = (d: Device) => (d.kind === 'phone' ? '📱' : d.kind === 'tablet' ? '📲' : '💻');
const since = (d: Device) => (d.createdAt ? d.createdAt.toDate().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'just now');

/** Mounted once at the app root: shows the Devices panel when something opens it. */
export function DevicesHost({ user }: { user: User }) {
  const [ui, setUi] = useState<{ open: boolean; focus: string | null }>({ open: false, focus: null });
  useEffect(() => onDevicesUi(setUi), []);
  if (!ui.open) return null;
  return <DevicesPanel user={user} focus={ui.focus} onClose={closeDevices} />;
}

function DevicesPanel({ user, focus, onClose }: { user: User; focus: string | null; onClose(): void }) {
  const me = deviceId();
  const [list, setList] = useState<Device[] | null>(null);
  const [sec, setSec] = useState<Security>({ primaryDevice: null, deviceProtection: false });
  const [open, setOpen] = useState<string | null>(focus);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [confirmAll, setConfirmAll] = useState<false | 'all' | 'not-me'>(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    const close = () => closeRef.current();
    openOverlay(close);
    return () => forgetOverlay(close);
  }, []);
  useEffect(() => watchDevices(user.uid, setList), [user.uid]);
  useEffect(() => watchSecurity(user.uid, setSec), [user.uid]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') closeOverlay(); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);

  const run = async (f: () => Promise<unknown>, done?: string) => {
    setBusy(true); setNote('');
    try { await f(); if (done) setNote(done); } catch (e: any) { setNote(e?.message || 'Something went wrong.'); } finally { setBusy(false); }
  };
  const others = (list || []).filter((d) => d.id !== me);
  const doSignOutOthers = (notMe: boolean) => run(async () => {
    const r = await signOutOthers(user, others);
    setConfirmAll(false);
    if (!r.done) {
      setNote(r.pending === 'email'
        ? `We sent a link to ${user.email}. Open it on this device to finish signing the others out.`
        : 'Confirming it’s you…');
      return;
    }
    setNote(notMe
      ? `Signed out ${r.count} other device${r.count === 1 ? '' : 's'}. Turn on 2-Step Verification for your Google account too.`
      : `Signed out ${r.count} other device${r.count === 1 ? '' : 's'}.`);
  });

  return (
    <div class="devices-panel" role="dialog" aria-modal="true" aria-label="Devices">
      <header class="scrap-top">
        <button type="button" class="icon-btn" onClick={() => closeOverlay()} aria-label="Close devices"><BackIcon /></button>
        <div class="scrap-heading">
          <div class="scrap-h1">Devices</div>
          <div class="scrap-h2">Where you're signed in to Hi</div>
        </div>
      </header>
      <div class="devices-body">
        {note && <div class="note" role="status">{note}</div>}
        {list === null && <div class="sys">Loading…</div>}
        <ul class="device-list">
          {(list || []).map((d) => {
            const isMe = d.id === me;
            const primary = sec.primaryDevice === d.id;
            const expanded = open === d.id;
            return (
              <li key={d.id} class={`device-row${expanded ? ' open' : ''}${focus === d.id ? ' flash' : ''}`}>
                <button type="button" class="device-main" aria-expanded={expanded} onClick={() => { setOpen(expanded ? null : d.id); setRenaming(null); }}>
                  <span class="device-icon" aria-hidden="true">{icon(d)}</span>
                  <span class="device-text">
                    <span class="device-name">{nameOf(d)}{primary && <span class="device-tag" title="Primary device"> ⭐ Primary</span>}</span>
                    <span class="device-meta">
                      {isMe ? 'This device' : d.status === 'pending' ? 'Waiting for approval' : activeAgo(d.lastActiveAt?.toMillis() || null)}
                      {' · '}since {since(d)}
                      {d.customName ? ` · ${d.label}` : ''}
                    </span>
                  </span>
                </button>
                {expanded && (
                  <div class="device-actions">
                    {d.status === 'pending' && (
                      <div class="device-approve">
                        <button type="button" class="btn-primary small" disabled={busy} onClick={() => run(() => approveDevice(user.uid, d.id), 'Approved.')}>Approve</button>
                        <button type="button" class="btn-ghost small" disabled={busy} onClick={() => run(() => signOutDevice(user.uid, d.id), 'Denied and signed out.')}>Deny</button>
                      </div>
                    )}
                    {focus === d.id && !isMe && d.status !== 'pending' && (
                      <div class="device-approve">
                        <button type="button" class="btn-soft small" onClick={() => { setOpen(null); setNote('Thanks — nothing to do.'); }}>That was me</button>
                        <button type="button" class="btn-ghost small danger-text" disabled={busy} onClick={() => setConfirmAll('not-me')}>That wasn't me</button>
                      </div>
                    )}
                    {renaming?.id === d.id ? (
                      <form class="inline-form" onSubmit={(e) => { e.preventDefault(); run(() => renameDevice(user.uid, d.id, renaming.name), 'Renamed.'); setRenaming(null); }}>
                        <input class="field" value={renaming.name} maxLength={40} aria-label="Device name" placeholder={d.label}
                          onInput={(e) => setRenaming({ id: d.id, name: e.currentTarget.value })} autoFocus />
                        <button class="btn-primary small" disabled={busy}>Save</button>
                      </form>
                    ) : (
                      <div class="device-buttons">
                        <button type="button" class="link-btn" onClick={() => setRenaming({ id: d.id, name: d.customName || '' })}>Rename</button>
                        {!primary && <button type="button" class="link-btn" disabled={busy} onClick={() => run(() => makePrimary(user.uid, d.id), `${nameOf(d)} is now your primary device.`)}>Make primary</button>}
                        {isMe
                          ? <button type="button" class="link-btn danger-text" onClick={() => signOut()}>Sign out</button>
                          : <button type="button" class="link-btn danger-text" disabled={busy} onClick={() => run(() => signOutDevice(user.uid, d.id), `${nameOf(d)} will be signed out.`)}>Sign out</button>}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {others.length > 0 && (
          confirmAll ? (
            <div class="card stack device-confirm">
              <div class="sheet-title">{confirmAll === 'not-me' ? 'Secure your account' : 'Sign out all other devices?'}</div>
              <div class="fine">
                Every device except this one is signed out straight away, and can't read your chats until it signs in again.
                {user.providerData.some((p) => p.providerId === 'google.com') ? ' You may be asked to confirm with Google first.' : ' We’ll e-mail you a link to confirm first.'}
              </div>
              <button type="button" class="btn-primary danger-bg" disabled={busy} onClick={() => doSignOutOthers(confirmAll === 'not-me')}>Sign out other devices</button>
              <button type="button" class="btn-ghost" onClick={() => setConfirmAll(false)}>Cancel</button>
            </div>
          ) : (
            <button type="button" class="btn-ghost danger-text" onClick={() => setConfirmAll('all')}>Sign out all other devices</button>
          )
        )}

        <div class="settings-group">
          <div class="settings-row">
            <span>Device protection</span>
            <button type="button" role="switch" aria-checked={sec.deviceProtection} class={`switch${sec.deviceProtection ? ' on' : ''}`}
              aria-label="Device protection" disabled={busy}
              onClick={() => run(() => setProtection(user.uid, !sec.deviceProtection, sec), sec.deviceProtection ? 'Device protection is off.' : 'Device protection is on.')}>
              <span />
            </button>
          </div>
          <div class="fine">
            When it's on, a new sign-in has to be approved on your primary device
            ({sec.primaryDevice ? nameOf((list || []).find((d) => d.id === sec.primaryDevice) || { label: 'not set' }) : 'this one, once you turn it on'}).
            It's a lock inside Hi: your chats belong to your account, not to a device. For real protection, turn on
            {' '}<a href={TWO_STEP} target="_blank" rel="noopener">2-Step Verification</a> for your Google account.
          </div>
        </div>
      </div>
    </div>
  );
}

/** A new device, held back until the primary device approves it. */
export function PendingScreen({ user }: { user: User }) {
  const [sec, setSec] = useState<Security | null>(null);
  const [primaryName, setPrimaryName] = useState('your primary device');
  const [msg, setMsg] = useState('');
  useEffect(() => watchSecurity(user.uid, setSec), [user.uid]);
  useEffect(() => watchDevices(user.uid, (l) => {
    const p = l.find((d) => d.id === sec?.primaryDevice);
    if (p) setPrimaryName(nameOf(p));
  }), [user.uid, sec?.primaryDevice]);
  return (
    <div class="app">
      <div class="screen pending-screen">
        <div class="pending-pulse" aria-hidden="true">🔐</div>
        <div class="sheet-title">Waiting for approval on {primaryName}…</div>
        <div class="fine">Device protection is on for this account. Open Hi on {primaryName} and tap Approve.</div>
        {msg && <div class="note" role="status">{msg}</div>}
        <button type="button" class="btn-ghost" onClick={() => requestEmailApproval(user)
          .then(() => setMsg(`We sent a link to ${user.email}. Open it on this device to approve it.`))
          .catch((e) => setMsg(e?.message || 'Could not send the link.'))}>
          Can't reach it? Approve by e-mail
        </button>
        <button type="button" class="link-btn" onClick={() => signOut()}>Cancel and sign out</button>
      </div>
    </div>
  );
}

/** On the primary device: a new sign-in is waiting. */
export function ApprovalBanner({ uid, pending }: { uid: string; pending: Device[] }) {
  const d = pending[0];
  if (!d) return null;
  return (
    <div class="approval-banner" role="alert">
      <span>🔐 New sign-in: <b>{nameOf(d)}</b></span>
      <button type="button" class="btn-primary small" onClick={() => approveDevice(uid, d.id)}>Approve</button>
      <button type="button" class="link-btn danger-text" onClick={() => signOutDevice(uid, d.id)}>Deny</button>
    </div>
  );
}
