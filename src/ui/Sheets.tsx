import { useState } from 'preact/hooks';
import type { User } from 'firebase/auth';
import type { DropDefinition } from '../drops/types';
import type { PushStatus } from '../data/push';
import { signOut } from '../data/auth';
import { disablePush } from '../data/push';
import type { MoodId, Pin } from '../types';
import { MoodIcon, MOODS } from './icons';

export function TraySheet({ drops, onPick }: { drops: DropDefinition<any>[]; onPick(d: DropDefinition<any>): void }) {
  return (
    <div class="stack" style={{ gap: '14px' }}>
      <div>
        <div class="sheet-title">Drop something</div>
        <div class="sheet-sub">Interactive cards you both play with, right in the chat</div>
      </div>
      <div class="tray-grid">
        {drops.map((d) => (
          <button type="button" key={d.type} class="tray-item" onClick={() => onPick(d)}>
            <span class="tray-name">{d.title}</span>
            <span class="tray-desc">{d.trayDescription}</span>
          </button>
        ))}
      </div>
      <div class="fine">New Drops show up here once they're added to the app.</div>
    </div>
  );
}

interface SetupProps {
  def: DropDefinition<any>;
  prefill?: Record<string, unknown>;
  onDrop(content: Record<string, unknown>): void;
  onBack(): void;
}

/** Generic form built from a Drop's `setup` fields, pre-filled with its defaults. */
export function SetupSheet({ def, prefill, onDrop, onBack }: SetupProps) {
  const start = { ...def.content, ...(prefill || {}) };
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    (def.setup || []).forEach((f) => {
      const x = start[f.key];
      v[f.key] = Array.isArray(x) ? x.join('\n') : String(x ?? '');
    });
    return v;
  });
  const [err, setErr] = useState('');

  const submit = (e: Event) => {
    e.preventDefault();
    const content: Record<string, unknown> = { ...start };
    for (const f of def.setup || []) {
      const raw = vals[f.key] || '';
      if (f.kind === 'lines') {
        const lines = raw.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, f.max ?? 20);
        if (lines.length < (f.min ?? 1)) { setErr(`${f.label}: add at least ${f.min ?? 1}.`); return; }
        content[f.key] = lines.map((s) => s.slice(0, 80));
      } else {
        const t = raw.trim().slice(0, f.maxLength ?? 200);
        if (!t) { setErr(`${f.label} can't be empty.`); return; }
        content[f.key] = t;
      }
    }
    onDrop(content);
  };

  return (
    <form class="stack" style={{ gap: '14px' }} onSubmit={submit}>
      <div>
        <div class="sheet-title">{def.title}</div>
        <div class="sheet-sub">{def.trayDescription}</div>
      </div>
      {err && <div class="err" role="alert">{err}</div>}
      {(def.setup || []).map((f) => (
        <div class="stack" style={{ gap: '6px' }} key={f.key}>
          <label class="field-label" for={`setup-${f.key}`}>{f.label}</label>
          {f.kind === 'lines'
            ? <textarea id={`setup-${f.key}`} class="field" rows={4} value={vals[f.key]} placeholder={f.placeholder} onInput={(e) => setVals({ ...vals, [f.key]: e.currentTarget.value })} />
            : <input id={`setup-${f.key}`} class="field" value={vals[f.key]} placeholder={f.placeholder} maxLength={f.maxLength} onInput={(e) => setVals({ ...vals, [f.key]: e.currentTarget.value })} />}
        </div>
      ))}
      <div style={{ display: 'flex', gap: '10px' }}>
        <button type="button" class="btn-ghost" onClick={onBack}>Back</button>
        <button class="btn-primary" style={{ flexGrow: 1 }}>Drop it</button>
      </div>
    </form>
  );
}

interface MoodProps { current: MoodId; onPick(m: MoodId): void; push: PushStatus; onPush(): void; user: User }

export function MoodSheet({ current, onPick, push, onPush, user }: MoodProps) {
  const pushLabel: Record<PushStatus, string> = {
    granted: 'On',
    denied: 'Blocked in browser settings',
    unsupported: 'Not supported on this browser',
    'needs-install': 'Add to Home Screen first',
    default: '',
  };
  return (
    <div class="stack">
      <div>
        <div class="sheet-title">Your mood weather</div>
        <div class="sheet-sub">Shows next to your name instead of "online"</div>
      </div>
      {MOODS.map((w) => (
        <button type="button" key={w.id} class={`mood-row${current === w.id ? ' on' : ''}`} onClick={() => onPick(w.id)} aria-pressed={current === w.id}>
          <span class="mood-icon"><MoodIcon mood={w.id} /></span>
          <span class="mood-text">
            <span class="mood-label">{w.label}</span>
            <span class="mood-desc">{w.desc}</span>
          </span>
        </button>
      ))}
      <div class="settings">
        <div class="settings-row">
          <span>Notifications</span>
          {push === 'default' ? <button type="button" class="link-btn" onClick={onPush}>Turn on</button> : <span>{pushLabel[push]}</span>}
        </div>
        <div class="settings-row">
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.email}</span>
          <button type="button" class="link-btn" onClick={async () => { await disablePush(user.uid); await signOut(); }}>Sign out</button>
        </div>
      </div>
    </div>
  );
}

export function ScrapSheet({ pins, nameOf }: { pins: Pin[]; nameOf(uid: string): string }) {
  return (
    <div class="stack">
      <div>
        <div class="sheet-title">Scrapbook</div>
        <div class="sheet-sub">Moments you both pinned</div>
      </div>
      {pins.length === 0 && <div class="empty">Nothing pinned yet. Tap "Pin to scrapbook" on any Drop.</div>}
      {pins.map((p) => (
        <div class="scrap-item" key={p.id}>
          <div class="scrap-title">{p.title}</div>
          <div class="scrap-detail">{p.detail}</div>
          <div class="fine">Pinned by {nameOf(p.by)}</div>
        </div>
      ))}
    </div>
  );
}
