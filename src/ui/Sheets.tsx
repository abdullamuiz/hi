import { useState } from 'preact/hooks';
import type { User } from 'firebase/auth';
import type { DropDefinition } from '../drops/types';
import type { SessionTest } from '../sessions/types';
import type { PushStatus } from '../data/push';
import { signOut } from '../data/auth';
import { disablePush } from '../data/push';
import type { MoodId } from '../types';
import { MoodIcon, MOODS } from './icons';
import { MODES, PALETTES, type ThemePrefs } from '../lib/themes';
import { buildLabel, reloadApp } from '../lib/updates';
import { DeliverySettings } from './Delivery';
import { Options } from '../drops/parts';
import { EffectsSetting } from './Effects';
import { BlockedList } from './Profile';
import type { Blocked } from '../data/profile';
import { setSplashStyle, splashStyle, type SplashStyle } from '../lib/splash';

export function TraySheet({ drops, onPick, sessions = [], onSession, self = false }: {
  drops: DropDefinition<any>[]; onPick(d: DropDefinition<any>): void;
  sessions?: SessionTest[]; onSession?(t: SessionTest): void;
  /** Notes to self: only the Drops that work alone. */
  self?: boolean;
}) {
  return (
    <div class="stack" style={{ gap: '14px' }}>
      <div>
        <div class="sheet-title">Drop something</div>
        <div class="sheet-sub">{self ? 'The Drops that work just for you: countdowns, a capsule for future you, a wheel to decide' : 'Interactive cards you both play with, right in the chat'}</div>
      </div>
      <div class="tray-grid">
        {drops.map((d) => (
          <button type="button" key={d.type} class="tray-item" onClick={() => onPick(d)}>
            <span class="tray-name">{d.title}</span>
            <span class="tray-desc">{d.trayDescription}</span>
          </button>
        ))}
      </div>
      {sessions.length > 0 && onSession && (
        <>
          <div>
            <div class="field-label">Sessions</div>
            <div class="sheet-sub">Full screen, at your own pace. Revealed together when you've both finished.</div>
          </div>
          <div class="tray-grid">
            {sessions.map((t) => (
              <button type="button" key={t.id} class="tray-item session-item" onClick={() => onSession(t)}>
                <span class="tray-name"><span aria-hidden="true">{t.icon} </span>{t.title}</span>
                <span class="tray-desc">{t.subtitle}</span>
              </button>
            ))}
          </div>
        </>
      )}
      <div class="fine">New Drops show up here once they're added to the app.</div>
    </div>
  );
}

interface SetupProps {
  def: DropDefinition<any>;
  prefill?: Record<string, unknown>;
  /** `secrets`: private picks (setup fields of kind "secret"), sealed for the sender on create. */
  onDrop(content: Record<string, unknown>, secrets: Record<string, unknown>): void;
  onBack(): void;
}

/** Generic form built from a Drop's `setup` fields, pre-filled with its defaults. */
export function SetupSheet({ def, prefill, onDrop, onBack }: SetupProps) {
  const start = { ...def.content, ...(prefill || {}) };
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    (def.setup || []).forEach((f) => {
      if (f.kind === 'secret') { v[f.key] = ''; return; }
      const x = start[f.key];
      v[f.key] = Array.isArray(x) ? x.join('\n') : String(x ?? '');
    });
    return v;
  });
  const [err, setErr] = useState('');

  const submit = (e: Event) => {
    e.preventDefault();
    const content: Record<string, unknown> = { ...start };
    const secrets: Record<string, unknown> = {};
    for (const f of def.setup || []) {
      const raw = vals[f.key] || '';
      if (f.kind === 'secret') {
        if (raw === '') { setErr(`${f.label}: choose one.`); return; }
        secrets[f.key] = Number(raw);
        continue;
      }
      if (f.kind === 'lines') {
        const lines = raw.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, f.max ?? 20);
        if (lines.length < (f.min ?? 1)) { setErr(`${f.label}: add at least ${f.min ?? 1}.`); return; }
        content[f.key] = lines.map((s) => s.slice(0, 80));
      } else if (f.kind === 'date') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) { setErr(`${f.label}: pick a date.`); return; }
        content[f.key] = raw;
      } else {
        const t = raw.trim().slice(0, f.maxLength ?? 200);
        if (!t && !f.optional) { setErr(`${f.label} can't be empty.`); return; }
        content[f.key] = t;
      }
    }
    const ready = def.prepare ? def.prepare(content as any) : content;
    if (typeof ready === 'string') { setErr(ready); return; }
    onDrop(ready, secrets);
  };

  return (
    <form class="stack" style={{ gap: '14px' }} onSubmit={submit}>
      <div>
        <div class="sheet-title">{def.title}</div>
        <div class="sheet-sub">{def.trayDescription}</div>
      </div>
      {err && <div class="err" role="alert">{err}</div>}
      {(def.setup || []).map((f) => {
        const set = (v: string) => setVals({ ...vals, [f.key]: v });
        if (f.kind === 'secret') {
          const items = f.from.map((k) => (vals[k] || '').trim() || '…');
          return (
            <div class="stack setup-secret" style={{ gap: '6px' }} key={f.key}>
              <div class="field-label" id={`setup-${f.key}-label`}>{f.label} <span class="fine">· only you see this</span></div>
              <Options items={items} value={vals[f.key] === '' ? null : Number(vals[f.key])} onPick={(i) => set(String(i))} label={f.label} />
            </div>
          );
        }
        return (
          <div class="stack" style={{ gap: '6px' }} key={f.key}>
            <label class="field-label" for={`setup-${f.key}`}>{f.label}{f.kind === 'text' && f.optional ? <span class="fine"> · optional</span> : null}</label>
            {f.kind === 'lines'
              ? <textarea id={`setup-${f.key}`} class="field" rows={4} value={vals[f.key]} placeholder={f.placeholder} onInput={(e) => set(e.currentTarget.value)} />
              : f.kind === 'date'
                ? <input id={`setup-${f.key}`} class="field" type="date" value={vals[f.key]} onInput={(e) => set(e.currentTarget.value)} />
                : (
                  <div class="setup-row">
                    <input id={`setup-${f.key}`} class="field" value={vals[f.key]} placeholder={f.placeholder} maxLength={f.maxLength} onInput={(e) => set(e.currentTarget.value)} />
                    {f.suggest && <button type="button" class="icon-btn dice" aria-label={`Random ${f.label.toLowerCase()}`} onClick={() => set(f.suggest!())}>🎲</button>}
                  </div>
                )}
          </div>
        );
      })}
      <div style={{ display: 'flex', gap: '10px' }}>
        <button type="button" class="btn-ghost" onClick={onBack}>Back</button>
        <button class="btn-primary" style={{ flexGrow: 1 }}>Drop it</button>
      </div>
    </form>
  );
}

interface MoodProps { current: MoodId; onPick(m: MoodId): void }

export function MoodSheet({ current, onPick }: MoodProps) {
  return (
    <div class="stack">
      <div>
        <div class="sheet-title">Your mood weather</div>
        <div class="sheet-sub">Shows next to your name on the other person's screen</div>
      </div>
      {MOODS.map((w) => (
        <button type="button" key={w.id} class={`mood-row${current === w.id ? ' on' : ''}`} onClick={() => onPick(w.id)} aria-pressed={current === w.id}>
          <span class="mood-icon"><MoodIcon mood={w.id} size={28} /></span>
          <span class="mood-text">
            <span class="mood-label">{w.label}</span>
            <span class="mood-desc">{w.desc}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

interface SettingsProps {
  user: User;
  prefs: ThemePrefs;
  onTheme(p: ThemePrefs): void;
  push: PushStatus;
  onPush(): void;
  /** People I blocked, with Unblock. */
  blocked?: Blocked[];
  onUnblock?(uid: string): void;
  onEditProfile?(): void;
  onDeleteAccount?(): void;
  onToast?(text: string): void;
}

export function SettingsSheet({ user, prefs, onTheme, push, onPush, blocked = [], onUnblock, onEditProfile, onDeleteAccount, onToast }: SettingsProps) {
  const pushLabel: Record<PushStatus, string> = {
    granted: 'On',
    denied: 'Blocked in browser settings',
    unsupported: 'Not supported on this browser',
    'needs-install': 'Add to Home Screen first',
    default: '',
  };
  return (
    <div class="stack">
      <div class="sheet-title">Settings</div>

      <div class="settings-group">
        <div class="field-label" id="theme-label">Theme</div>
        <div class="theme-grid" role="radiogroup" aria-labelledby="theme-label">
          {PALETTES.map((t) => (
            <button
              type="button"
              key={t.id}
              role="radio"
              aria-checked={prefs.palette === t.id}
              class={`theme-opt${prefs.palette === t.id ? ' on' : ''}`}
              onClick={() => onTheme({ ...prefs, palette: t.id })}
              title={t.desc}
            >
              {/* Split swatch: the palette's light version on the left, its dark version on the right. */}
              <span class="split-swatch" aria-hidden="true">
                <span style={{ background: t.light[0] }}><i style={{ background: t.light[1] }} /></span>
                <span style={{ background: t.dark[0] }}><i style={{ background: t.dark[1] }} /></span>
              </span>
              <span class="theme-name">{t.label}</span>
              <span class="theme-desc">{t.desc}</span>
            </button>
          ))}
        </div>
        <div class="segmented" role="radiogroup" aria-label="Light or dark">
          {MODES.map((m) => (
            <button type="button" key={m.id} role="radio" aria-checked={prefs.mode === m.id}
              class={prefs.mode === m.id ? 'on' : ''} onClick={() => onTheme({ ...prefs, mode: m.id })}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <DeliverySettings uid={user.uid} onToast={onToast || (() => {})} />

      <SplashSetting />

      <EffectsSetting />

      {onUnblock && <BlockedList blocked={blocked} onUnblock={onUnblock} />}

      <div class="settings">
        <div class="settings-row">
          <span>Notifications</span>
          {push === 'default' ? <button type="button" class="link-btn" onClick={onPush}>Turn on</button> : <span>{pushLabel[push]}</span>}
        </div>
        {onEditProfile && (
          <div class="settings-row">
            <span>Profile</span>
            <button type="button" class="link-btn" onClick={onEditProfile}>Edit profile</button>
          </div>
        )}
        <div class="settings-row">
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.email}</span>
          <button type="button" class="link-btn" onClick={async () => { await disablePush(user.uid); await signOut(); }}>Sign out</button>
        </div>
        <div class="settings-row">
          <span>App version · {buildLabel()}</span>
          <button type="button" class="link-btn" onClick={() => reloadApp()}>Reload app</button>
        </div>
        {onDeleteAccount && (
          <div class="settings-row">
            <span>Account</span>
            <button type="button" class="link-btn danger-text" onClick={onDeleteAccount}>Delete account</button>
          </div>
        )}
        <div class="fine">About: messages are protected by access rules but are not end-to-end encrypted.</div>
      </div>
    </div>
  );
}

function SplashSetting() {
  const [style, setStyle] = useState<SplashStyle>(splashStyle);
  const choose = (s: SplashStyle) => { setSplashStyle(s); setStyle(s); };
  return (
    <div class="settings-group">
      <div class="field-label" id="splash-label">Opening screen</div>
      <div class="segmented" role="radiogroup" aria-labelledby="splash-label">
        {([['animated', 'Animated'], ['still', 'Still']] as const).map(([id, label]) => (
          <button type="button" key={id} role="radio" aria-checked={style === id}
            class={style === id ? 'on' : ''} onClick={() => choose(id)}>
            {label}
          </button>
        ))}
      </div>
      <div class="fine">
        {style === 'animated'
          ? 'Hi is drawn each time the app opens or reloads.'
          : 'The logo shows only while the app loads, then goes straight to your chat.'}
      </div>
    </div>
  );
}
