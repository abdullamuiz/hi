import { useEffect, useState } from 'preact/hooks';
import {
  EFFECTS, effectDef, effectsSetting, loadOpened, prefersReducedMotion, saveOpened, setEffectsSetting,
  type EffectCode, type EffectDef,
} from '../lib/effects';

// ============================================================================ canvas layer
// One fixed, click-through canvas over the app for the screen effects. No libraries:
// a few hundred particles with simple physics, drawn with requestAnimationFrame.

type Particle = {
  x: number; y: number; vx: number; vy: number;
  size: number; rot: number; vr: number; color: string;
  life: number; max: number;
  shape: 'rect' | 'dot' | 'balloon';
  /** Balloons: popped, and the string's sway phase. */
  popped?: boolean; phase?: number;
};

const COLORS = ['#F2A15F', '#1E7F93', '#E8C547', '#D96C8A', '#6FB36F', '#7C8CF0', '#F2EFE6'];
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

interface Run { code: EffectCode; until: number; dim: number; parts: Particle[]; bursts: { at: number; x: number; y: number; done?: boolean }[] }

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let run: Run | null = null;
let raf = 0;
let last = 0;

/** For tests: how many screen effects have started, and which ran last. */
const stats = ((window as any).__hiFx ||= { count: 0, last: null as string | null });

function ensureCanvas() {
  if (canvas && document.body.contains(canvas)) return;
  canvas = document.createElement('canvas');
  canvas.id = 'fx-layer';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  ctx = canvas.getContext('2d');
  resize();
  addEventListener('resize', resize);
}

function resize() {
  if (!canvas) return;
  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function stop() {
  cancelAnimationFrame(raf);
  removeEventListener('pointerdown', popAt, true);
  run = null;
  if (canvas) { canvas.remove(); canvas = null; ctx = null; }
  removeEventListener('resize', resize);
}

function confetti(ox: number, oy: number, n = 160): Particle[] {
  return Array.from({ length: n }, () => {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1;
    const sp = 6 + Math.random() * 9;
    return {
      x: ox, y: oy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      size: 5 + Math.random() * 6, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
      color: pick(COLORS), life: 0, max: 2200 + Math.random() * 600, shape: 'rect',
    } as Particle;
  });
}

function balloons(): Particle[] {
  const n = 10;
  return Array.from({ length: n }, (_, i) => ({
    x: (innerWidth / (n + 1)) * (i + 1) + (Math.random() - 0.5) * 30,
    y: innerHeight + 60 + Math.random() * 220,
    vx: 0, vy: -(2.1 + Math.random() * 1.4),
    size: 26 + Math.random() * 10, rot: 0, vr: 0, color: pick(COLORS.slice(0, 6)),
    life: 0, max: 4800, shape: 'balloon', phase: Math.random() * 6,
  } as Particle));
}

function sparks(x: number, y: number, color: string, n = 70, speed = 5): Particle[] {
  return Array.from({ length: n }, () => {
    const a = Math.random() * Math.PI * 2;
    const sp = speed * (0.4 + Math.random() * 0.8);
    return { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, size: 2 + Math.random() * 2, rot: 0, vr: 0, color, life: 0, max: 900 + Math.random() * 500, shape: 'dot' } as Particle;
  });
}

/** Balloons pop when tapped; the tap still reaches the chat underneath. */
function popAt(e: PointerEvent) {
  if (!run || run.code !== 'balloons') return;
  for (const p of run.parts) {
    if (p.shape !== 'balloon' || p.popped) continue;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < p.size * 1.1) {
      p.popped = true;
      p.life = p.max;
      run.parts.push(...sparks(p.x, p.y, p.color, 24, 3.5));
      break;
    }
  }
}

function frame(t: number) {
  if (!run || !ctx || !canvas) return;
  const dt = Math.min(48, t - (last || t));
  last = t;
  const k = dt / 16.7;
  ctx.clearRect(0, 0, innerWidth, innerHeight);

  if (run.code === 'fireworks') {
    // Dim the screen, fading in and out.
    const left = run.until - performance.now();
    run.dim = Math.min(0.5, run.dim + 0.04 * k, Math.max(0, left / 600) * 0.5);
    ctx.fillStyle = `rgba(8, 12, 28, ${run.dim})`;
    ctx.fillRect(0, 0, innerWidth, innerHeight);
    for (const b of run.bursts) {
      if (!b.done && performance.now() >= b.at) {
        b.done = true;
        run.parts.push(...sparks(b.x, b.y, pick(COLORS), 90, 6));
      }
    }
  }

  for (const p of run.parts) {
    p.life += dt;
    if (p.shape === 'balloon') {
      if (p.popped) continue;
      p.phase! += 0.03 * k;
      p.x += Math.sin(p.phase!) * 0.6 * k;
      p.y += p.vy * k;
      drawBalloon(p);
      continue;
    }
    p.vy += (p.shape === 'rect' ? 0.22 : 0.08) * k;
    p.vx *= p.shape === 'rect' ? 0.985 : 0.97;
    p.x += p.vx * k;
    p.y += p.vy * k;
    p.rot += p.vr * k;
    const alpha = Math.max(0, 1 - p.life / p.max);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    if (p.shape === 'rect') {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  run.parts = run.parts.filter((p) => p.life < p.max && p.y < innerHeight + 300 && !(p.shape === 'balloon' && (p.popped || p.y < -120)));

  if (performance.now() > run.until && run.parts.length === 0) { stop(); return; }
  if (performance.now() > run.until + 2500) { stop(); return; }
  raf = requestAnimationFrame(frame);
}

function drawBalloon(p: Particle) {
  if (!ctx) return;
  const r = p.size;
  ctx.strokeStyle = 'rgba(120,120,120,.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y + r * 1.2);
  ctx.quadraticCurveTo(p.x + Math.sin(p.phase! * 2) * 6, p.y + r * 1.9, p.x, p.y + r * 2.6);
  ctx.stroke();
  ctx.fillStyle = p.color;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, r * 0.85, r * 1.05, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(p.x - 4, p.y + r * 1.15);
  ctx.lineTo(p.x + 4, p.y + r * 1.15);
  ctx.lineTo(p.x, p.y + r * 0.98);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.35)';
  ctx.beginPath();
  ctx.ellipse(p.x - r * 0.3, p.y - r * 0.4, r * 0.18, r * 0.3, -0.5, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Plays a full-screen effect (confetti, balloons or fireworks) from `origin`, usually the
 * bubble. Does nothing with reduced motion or effects turned off; callers check that too.
 */
export function playScreen(code: EffectCode, origin?: DOMRect | null) {
  if (code !== 'confetti' && code !== 'balloons' && code !== 'fireworks') return;
  if (!effectsSetting() || prefersReducedMotion()) return;
  stop();
  ensureCanvas();
  canvas!.dataset.effect = code;
  stats.count++;
  stats.last = code;
  const now = performance.now();
  const ox = origin ? origin.left + origin.width / 2 : innerWidth / 2;
  const oy = origin ? origin.top + origin.height / 2 : innerHeight * 0.7;
  if (code === 'confetti') {
    run = { code, until: now + 2500, dim: 0, parts: confetti(ox, oy), bursts: [] };
  } else if (code === 'balloons') {
    run = { code, until: now + 4800, dim: 0, parts: balloons(), bursts: [] };
    addEventListener('pointerdown', popAt, true);
  } else {
    const at = (i: number) => now + 250 + i * 650;
    run = {
      code, until: now + 3200, dim: 0, parts: [],
      bursts: [0, 1, 2, 3].map((i) => ({ at: at(i), x: innerWidth * (0.2 + Math.random() * 0.6), y: innerHeight * (0.18 + Math.random() * 0.35) })),
    };
  }
  last = 0;
  raf = requestAnimationFrame(frame);
}

/** Effects drawn on the canvas (the others are CSS on the bubble). */
export const isCanvasEffect = (c: string | null | undefined) => c === 'confetti' || c === 'balloons' || c === 'fireworks';

// ============================================================================ bubble content

interface TextProps {
  msgId: string;
  effect: EffectCode;
  mine: boolean;
  text: string;
  /** Increases each time the effect plays (arrival or replay); 0 = never played here. */
  run: number;
  motion: boolean;
  /** The normal rendering of the text (phrase reactions etc.). */
  children: preact.ComponentChildren;
}

/** The inside of a text bubble sent with a bubble effect. */
export function EffectText({ msgId, effect, mine, text, run, motion, children }: TextProps) {
  if (effect === 'sealed') return <Sealed msgId={msgId} mine={mine}>{children}</Sealed>;
  if (effect === 'whisper') return <Whisper mine={mine}>{children}</Whisper>;
  if (effect === 'slow' && motion && run > 0) return <SlowText key={run} text={text}>{children}</SlowText>;
  return <>{children}</>;
}

function Sealed({ msgId, mine, children }: { msgId: string; mine: boolean; children: preact.ComponentChildren }) {
  const [open, setOpen] = useState(() => mine || loadOpened().has(msgId));
  if (open) return <span class={mine ? '' : 'fx-unsealed'}>{children}</span>;
  return (
    <button type="button" class="fx-envelope" onClick={(e) => {
      e.stopPropagation();
      const s = loadOpened();
      s.add(msgId);
      saveOpened(s);
      setOpen(true);
    }}>
      <span class="fx-envelope-art" aria-hidden="true">✉️</span>
      <span>Sealed message · <b>Tap to open</b></span>
    </button>
  );
}

function Whisper({ mine, children }: { mine: boolean; children: preact.ComponentChildren }) {
  const [shown, setShown] = useState(mine);
  useEffect(() => {
    if (!shown || mine) return;
    const t = setTimeout(() => setShown(false), 5000);
    return () => clearTimeout(t);
  }, [shown, mine]);
  if (shown) return <span class="fx-whisper-text">{children}</span>;
  return (
    <button type="button" class="fx-whisper-btn" aria-label="Whispered message. Tap to reveal" onClick={(e) => { e.stopPropagation(); setShown(true); }}>
      <span class="fx-whisper-blur" aria-hidden="true">{children}</span>
      <span class="fx-whisper-hint">🤫 Tap to reveal</span>
    </button>
  );
}

function SlowText({ text, children }: { text: string; children: preact.ComponentChildren }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const step = Math.max(14, Math.min(60, 1800 / Math.max(1, text.length)));
    const t = setInterval(() => setN((x) => (x >= text.length ? (clearInterval(t), x) : x + 1)), step);
    return () => clearInterval(t);
  }, [text]);
  if (n >= text.length) return <>{children}</>;
  return <span class="fx-typing" aria-label={text}>{text.slice(0, n)}<span class="fx-caret" aria-hidden="true" /></span>;
}

/** Small label under a bubble sent with an effect; replays it when motion is allowed. */
export function EffectTag({ effect, motion, onReplay }: { effect: EffectCode; motion: boolean; onReplay(): void }) {
  const def = effectDef(effect);
  if (!def) return null;
  const replayable = motion && effect !== 'sealed' && effect !== 'whisper';
  if (!replayable) return <span class="fx-tag">Sent with {def.label}</span>;
  return (
    <button type="button" class="fx-tag fx-replay" onClick={(e) => { e.stopPropagation(); onReplay(); }} aria-label={`Replay ${def.label}`}>
      {def.emoji} {def.label} · replay
    </button>
  );
}

// ============================================================================ composer

/** "Send with 🎉 Confetti?" — a suggestion from the draft's words, never applied by itself. */
export function EffectSuggestion({ effect, onApply, onDismiss }: { effect: EffectCode; onApply(): void; onDismiss(): void }) {
  const def = effectDef(effect)!;
  return (
    <div class="fx-suggest" role="status">
      <button type="button" class="fx-suggest-btn" onClick={onApply}>Send with {def.emoji} {def.label}?</button>
      <button type="button" class="strip-x" onClick={onDismiss} aria-label="No effect">✕</button>
    </div>
  );
}

/** The effect chosen for the next message. */
export function EffectArmed({ effect, onClear }: { effect: EffectCode; onClear(): void }) {
  const def = effectDef(effect)!;
  return (
    <div class="fx-suggest armed" role="status">
      <span class="fx-armed-label">{def.emoji} Sending with {def.label}</span>
      <button type="button" class="strip-x" onClick={onClear} aria-label="Remove effect">✕</button>
    </div>
  );
}

/** Long-press Send → Effects: pick one for the next message. */
export function EffectsSheet({ current, onPick }: { current: EffectCode | null; onPick(e: EffectCode | null): void }) {
  const group = (kind: EffectDef['kind'], title: string) => (
    <div class="stack" style={{ gap: '6px' }}>
      <div class="field-label">{title}</div>
      <div class="fx-grid">
        {EFFECTS.filter((e) => e.kind === kind).map((e) => (
          <button type="button" key={e.code} class={`fx-opt${current === e.code ? ' on' : ''}`} aria-pressed={current === e.code} onClick={() => onPick(e.code)}>
            <span class="fx-opt-emoji" aria-hidden="true">{e.emoji}</span>
            <span class="fx-opt-name">{e.label}</span>
            <span class="fx-opt-desc">{e.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <div class="stack">
      <div>
        <div class="sheet-title">Effects</div>
        <div class="sheet-sub">Pick one, then send your message.</div>
      </div>
      {group('screen', 'Screen')}
      {group('bubble', 'Bubble')}
      {current && <button type="button" class="btn-ghost" onClick={() => onPick(null)}>No effect</button>}
      {(!effectsSetting() || prefersReducedMotion()) && (
        <div class="fine">Effects are off on this phone, so you’ll see a label instead of the animation. The other person still sees it.</div>
      )}
    </div>
  );
}

// ============================================================================ settings

export function EffectsSetting() {
  const [on, setOn] = useState(effectsSetting);
  const reduced = prefersReducedMotion();
  return (
    <div class="settings-group">
      <div class="field-label" id="fx-label">Play effects</div>
      <div class="segmented" role="radiogroup" aria-labelledby="fx-label">
        {([[true, 'On'], [false, 'Off']] as const).map(([v, label]) => (
          <button type="button" key={label} role="radio" aria-checked={on === v} class={on === v ? 'on' : ''}
            onClick={() => { setEffectsSetting(v); setOn(v); }}>{label}</button>
        ))}
      </div>
      <div class="fine">
        {reduced
          ? 'Your phone asks for reduced motion, so effects show as a small label instead.'
          : on ? 'Confetti, balloons and other effects play when they arrive.' : 'Effects show as a small label instead of playing.'}
      </div>
    </div>
  );
}
