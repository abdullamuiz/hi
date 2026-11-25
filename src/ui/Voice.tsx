import { useEffect, useRef, useState } from 'preact/hooks';
import { photoURL } from '../data/photos';
import { REACTIONS, emojiOf } from '../lib/messages';
import {
  computePeaks, formatDuration, formatFromBlobType, markerPercent, pickVoiceFormat, resampleLevels, slideIntent,
  VOICE_MAX_MS, VOICE_MIN_MS, type VoiceFormat,
} from '../lib/voice';
import type { VoiceRecording } from '../data/messages';
import type { Message, ReactionCode, VoiceReaction } from '../types';

// ============================================================================ recording

export type RecState = 'idle' | 'starting' | 'held' | 'locked' | 'finishing';

interface RecorderOpts {
  onDone(rec: VoiceRecording): void;
  onError(message: string): void;
}

const AudioCtx = (): typeof AudioContext | undefined =>
  (window as any).AudioContext || (window as any).webkitAudioContext;

/** Decodes the recording for a true waveform; falls back to the live meter's levels. */
async function analyse(blob: Blob, levels: number[], elapsedMs: number): Promise<{ peaks: number[]; durationMs: number }> {
  const Ctx = AudioCtx();
  if (Ctx) {
    let ctx: AudioContext | null = null;
    try {
      ctx = new Ctx();
      const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
      const peaks = computePeaks(buf.getChannelData(0));
      const durationMs = Number.isFinite(buf.duration) && buf.duration > 0 ? buf.duration * 1000 : elapsedMs;
      if (peaks.some((p) => p > 0)) return { peaks, durationMs };
      return { peaks: resampleLevels(levels), durationMs };
    } catch { /* fall through */ } finally { ctx?.close().catch(() => {}); }
  }
  return { peaks: resampleLevels(levels), durationMs: elapsedMs };
}

/**
 * Hold-to-record with slide-to-cancel and slide-up-to-lock; a quick tap starts a
 * hands-free (locked) recording. Returns props for the mic button plus the live state.
 */
export function useVoiceRecorder({ onDone, onError }: RecorderOpts) {
  const [state, setState] = useState<RecState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [slide, setSlide] = useState(0);

  const st = useRef<RecState>('idle');
  const set = (s: RecState) => { st.current = s; setState(s); };
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const chunks = useRef<Blob[]>([]);
  const levels = useRef<number[]>([]);
  const startedAt = useRef(0);
  const pressAt = useRef(0);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const released = useRef(false);
  const cancelled = useRef(false);
  const raf = useRef(0);
  const format = useRef<VoiceFormat | null>(null);
  const cbs = useRef({ onDone, onError });
  cbs.current = { onDone, onError };

  const cleanup = () => {
    cancelAnimationFrame(raf.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    ctx.current?.close().catch(() => {});
    ctx.current = null;
    rec.current = null;
    origin.current = null;
    setSlide(0);
    setLevel(0);
  };
  useEffect(() => () => { cancelled.current = true; try { rec.current?.stop(); } catch { /* ignore */ } cleanup(); }, []);

  const meter = (analyser: AnalyserNode) => {
    const data = new Uint8Array(analyser.fftSize);
    let last = 0;
    const tick = (now: number) => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / data.length);
      setLevel(Math.min(1, rms * 4));
      if (now - last > 80) { levels.current.push(rms); last = now; }
      const ms = Date.now() - startedAt.current;
      setElapsed(ms);
      if (ms >= VOICE_MAX_MS) { finish(); return; }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };

  const begin = async (locked: boolean) => {
    if (st.current !== 'idle') return;
    const md = navigator.mediaDevices;
    if (!md?.getUserMedia || typeof MediaRecorder === 'undefined') {
      cbs.current.onError('Voice notes aren’t supported in this browser.');
      return;
    }
    const fmt = pickVoiceFormat((m) => MediaRecorder.isTypeSupported(m));
    format.current = fmt;
    cancelled.current = false;
    released.current = locked;
    set('starting');
    try {
      stream.current = await md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e: any) {
      set('idle');
      cleanup();
      cbs.current.onError(e?.name === 'NotAllowedError' ? 'Allow the microphone to send voice notes.' : 'Couldn’t start the microphone.');
      return;
    }
    if (cancelled.current) { set('idle'); cleanup(); return; }
    chunks.current = [];
    levels.current = [];
    try {
      rec.current = new MediaRecorder(stream.current, fmt?.recorderMime ? { mimeType: fmt.recorderMime, audioBitsPerSecond: 32_000 } : undefined);
    } catch {
      rec.current = new MediaRecorder(stream.current);
    }
    const r = rec.current;
    r.ondataavailable = (e) => { if (e.data && e.data.size) chunks.current.push(e.data); };
    r.onstop = async () => {
      const elapsedMs = Date.now() - startedAt.current;
      const type = r.mimeType || chunks.current[0]?.type || fmt?.recorderMime || 'audio/webm';
      const blob = new Blob(chunks.current, { type });
      const keep = !cancelled.current;
      cleanup();
      if (!keep) { set('idle'); return; }
      if (elapsedMs < VOICE_MIN_MS || !blob.size) { set('idle'); cbs.current.onError('Too short — hold the mic a little longer.'); return; }
      set('finishing');
      const { peaks, durationMs } = await analyse(blob, levels.current, elapsedMs);
      const f = formatFromBlobType(blob.type, fmt || { recorderMime: '', contentType: 'audio/webm', ext: 'webm' });
      set('idle');
      cbs.current.onDone({ blob, durationMs: Math.min(durationMs, VOICE_MAX_MS + 1000), peaks, format: f });
    };
    const Ctx = AudioCtx();
    if (Ctx) {
      try {
        ctx.current = new Ctx();
        const analyser = ctx.current.createAnalyser();
        analyser.fftSize = 512;
        ctx.current.createMediaStreamSource(stream.current).connect(analyser);
        startedAt.current = Date.now();
        meter(analyser);
      } catch { startedAt.current = Date.now(); }
    } else startedAt.current = Date.now();
    r.start(250);
    setElapsed(0);
    navigator.vibrate?.(10);
    // Released while the permission prompt was up, or a quick tap: keep recording hands-free.
    set(released.current ? 'locked' : 'held');
  };

  /** Stop and send. */
  const finish = () => {
    const r = rec.current;
    if (!r || st.current === 'idle' || st.current === 'finishing') return;
    cancelAnimationFrame(raf.current);
    set('finishing');
    try { r.requestData(); } catch { /* ignore */ }
    try { r.stop(); } catch { set('idle'); cleanup(); }
  };

  /** Throw the recording away. */
  const cancel = () => {
    cancelled.current = true;
    if (rec.current && rec.current.state !== 'inactive') {
      try { rec.current.stop(); } catch { /* ignore */ }
    } else cleanup();
    set('idle');
  };

  const micProps = {
    onPointerDown(e: PointerEvent) {
      if (e.button !== 0) return;
      e.preventDefault();
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      origin.current = { x: e.clientX, y: e.clientY };
      pressAt.current = Date.now();
      begin(false);
    },
    onPointerMove(e: PointerEvent) {
      const o = origin.current;
      if (!o || (st.current !== 'held' && st.current !== 'starting')) return;
      const dx = e.clientX - o.x;
      const dy = e.clientY - o.y;
      setSlide(Math.min(0, dx));
      const intent = slideIntent(dx, dy);
      if (intent === 'cancel') { origin.current = null; cancel(); }
      else if (intent === 'lock') { origin.current = null; setSlide(0); released.current = true; if (st.current === 'held') set('locked'); }
    },
    onPointerUp() {
      origin.current = null;
      setSlide(0);
      const quick = Date.now() - pressAt.current < 350;
      if (st.current === 'starting') { released.current = true; return; }
      if (st.current !== 'held') return;
      if (quick) set('locked');
      else finish();
    },
    onPointerCancel() {
      origin.current = null;
      setSlide(0);
      if (st.current === 'held') set('locked');
    },
    onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      if (st.current === 'idle') begin(true);
    },
    onContextMenu(e: Event) { e.preventDefault(); },
  };

  return { state, elapsed, level, slide, micProps, finish, cancel };
}

export const MicIcon = ({ size = 22 }: { size?: number }) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);

const TrashIcon = () => (
  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </svg>
);

const LockIcon = () => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

interface BarProps {
  state: RecState;
  elapsed: number;
  level: number;
  slide: number;
  onCancel(): void;
  onSend(): void;
  sendIcon: preact.ComponentChildren;
}

/** Shown in place of the text box while recording. */
export function RecordBar({ state, elapsed, level, slide, onCancel, onSend, sendIcon }: BarProps) {
  const locked = state === 'locked';
  const left = Math.max(0, VOICE_MAX_MS - elapsed);
  return (
    <div class={`rec-bar${locked ? ' locked' : ''}`} role="status" aria-live="polite">
      {locked
        ? <button type="button" class="round-btn danger-text" onClick={onCancel} aria-label="Cancel voice note"><TrashIcon /></button>
        : <span class="rec-dot" aria-hidden="true" />}
      <span class="rec-time" aria-label={`Recording, ${formatDuration(elapsed)}`}>{formatDuration(elapsed)}</span>
      <span class="rec-meter" aria-hidden="true">
        {[0.5, 0.8, 1, 0.8, 0.5].map((k, i) => (
          <i key={i} style={{ transform: `scaleY(${Math.max(0.15, Math.min(1, level * k * 1.6))})` }} />
        ))}
      </span>
      {state === 'finishing' ? <span class="rec-hint">Sending…</span>
        : locked ? <span class="rec-hint">{left < 15_000 ? `${Math.ceil(left / 1000)}s left` : 'Hands-free'}</span>
          : state === 'starting' ? <span class="rec-hint">Starting mic…</span>
            : <span class="rec-hint slide" style={{ transform: `translateX(${slide}px)` }}>‹ Slide to cancel</span>}
      {state === 'held' && <span class="rec-lock" aria-hidden="true"><LockIcon /><span>Slide up</span></span>}
      {locked && <button type="button" class="send-btn" onClick={onSend} aria-label="Send voice note">{sendIcon}</button>}
    </div>
  );
}

// ============================================================================ playing

/** Only one voice note plays at a time. */
let playing: HTMLAudioElement | null = null;
const SPEEDS = [1, 1.5, 2];

interface BubbleProps {
  msg: Message;
  mine: boolean;
  me: string;
  /** Has the other person listened to my note? */
  playedByPartner: boolean;
  nameOf(uid: string): string;
  onFirstPlay(): void;
  onReact(r: VoiceReaction): void;
  onUnreact(r: VoiceReaction): void;
}

export function VoiceBubble({ msg, mine, me, playedByPartner, nameOf, onFirstPlay, onReact, onUnreact }: BubbleProps) {
  const v = msg.voice!;
  const audio = useRef<HTMLAudioElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [isPlaying, setPlaying] = useState(false);
  const [pos, setPos] = useState(0); // ms
  const [started, setStarted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [picking, setPicking] = useState(false);
  const raf = useRef(0);
  const told = useRef(false);
  const duration = v.durationMs;
  const peaks = v.peaks?.length ? v.peaks : new Array(32).fill(0.3);
  const unplayed = !mine && !(msg.playedBy || []).includes(me);

  useEffect(() => {
    let live = true;
    photoURL(v.path).then((u) => live && setUrl(u)).catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [v.path]);

  useEffect(() => () => {
    cancelAnimationFrame(raf.current);
    const a = audio.current;
    if (a) { a.pause(); if (playing === a) playing = null; }
  }, []);

  const follow = () => {
    const a = audio.current;
    if (!a) return;
    setPos(Math.min(duration, a.currentTime * 1000));
    if (!a.paused) raf.current = requestAnimationFrame(follow);
  };

  const ensure = (): HTMLAudioElement | null => {
    if (audio.current) return audio.current;
    if (!url) return null;
    const a = new Audio(url);
    a.preload = 'auto';
    a.onplay = () => { setPlaying(true); raf.current = requestAnimationFrame(follow); };
    a.onpause = () => { setPlaying(false); cancelAnimationFrame(raf.current); follow(); };
    a.onended = () => { setPlaying(false); cancelAnimationFrame(raf.current); setPos(0); a.currentTime = 0; };
    a.onerror = () => { setPlaying(false); setFailed(true); };
    audio.current = a;
    return a;
  };

  const play = async () => {
    const a = ensure();
    if (!a) return;
    if (playing && playing !== a) playing.pause();
    playing = a;
    a.playbackRate = speed;
    setStarted(true);
    try { await a.play(); } catch { setFailed(true); return; }
    if (unplayed && !told.current) { told.current = true; onFirstPlay(); }
  };

  const toggle = () => { const a = audio.current; if (a && !a.paused) a.pause(); else play(); };

  const seekTo = (ms: number, andPlay = false) => {
    const a = ensure();
    if (!a) return;
    const t = Math.max(0, Math.min(duration, ms)) / 1000;
    try { a.currentTime = t; } catch { /* not seekable yet */ }
    setPos(t * 1000);
    setStarted(true);
    if (andPlay && a.paused) play();
  };

  const onWave = (e: MouseEvent) => {
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    seekTo(((e.clientX - r.left) / Math.max(1, r.width)) * duration, true);
  };

  const onWaveKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); seekTo(pos + 5000); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); seekTo(pos - 5000); }
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); }
  };

  const nextSpeed = () => {
    const s = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(s);
    if (audio.current) audio.current.playbackRate = s;
  };

  const drop = (code: ReactionCode) => {
    const at = Math.round(audio.current ? audio.current.currentTime * 1000 : pos);
    onReact({ uid: me, atMs: Math.max(0, Math.min(duration, at)), reaction: code });
    setPicking(false);
  };

  const reactions = (msg.voiceReactions || []).slice().sort((a, b) => a.atMs - b.atMs);
  const myLast = [...(msg.voiceReactions || [])].reverse().find((r) => r.uid === me);
  const progress = duration > 0 ? pos / duration : 0;
  const label = isPlaying ? formatDuration(pos) : started && pos > 0 ? formatDuration(pos) : formatDuration(duration);

  return (
    <div class={`bubble ${mine ? 'mine' : 'theirs'} voice${unplayed ? ' unplayed' : ''}`}>
      <div class="voice-row">
        <button type="button" class="voice-play no-lp" onClick={toggle} disabled={!url || failed}
          aria-label={isPlaying ? 'Pause voice note' : `Play voice note, ${formatDuration(duration)}`}>
          {isPlaying
            ? <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
            : <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z" /></svg>}
        </button>
        <div class="voice-track">
          {reactions.length > 0 && (
            <div class="voice-marks">
              {reactions.map((r, i) => (
                <button type="button" key={`${r.uid}-${r.atMs}-${i}`} class={`voice-mark no-lp${r.uid === me ? ' me' : ''}`}
                  style={{ left: `${markerPercent(r.atMs, duration)}%` }}
                  onClick={() => seekTo(r.atMs, true)}
                  aria-label={`${r.uid === me ? 'You' : nameOf(r.uid)} reacted ${emojiOf(r.reaction)} at ${formatDuration(r.atMs)}. Play from there`}>
                  {emojiOf(r.reaction)}
                </button>
              ))}
            </div>
          )}
          <div class="voice-wave" role="slider" tabIndex={0} aria-label="Voice note position"
            aria-valuemin={0} aria-valuemax={Math.round(duration / 1000)} aria-valuenow={Math.round(pos / 1000)}
            aria-valuetext={`${formatDuration(pos)} of ${formatDuration(duration)}`}
            onClick={onWave} onKeyDown={onWaveKey}>
            {peaks.map((p, i) => (
              <i key={i} class={(i + 0.5) / peaks.length <= progress ? 'on' : ''} style={{ height: `${Math.max(3, Math.round(p * 26))}px` }} />
            ))}
          </div>
          <div class="voice-meta">
            <span class="voice-time">{failed ? 'Can’t play this right now' : label}</span>
            {unplayed && <span class="voice-new" aria-label="Not played yet" />}
            {mine && playedByPartner && <span class="voice-played">Played</span>}
            <span class="voice-spacer" />
            {started && !failed && (
              <button type="button" class="voice-chip no-lp" onClick={() => setPicking((p) => !p)} aria-expanded={picking}
                aria-label={`React at ${formatDuration(pos)}`}>☺+</button>
            )}
            <button type="button" class="voice-chip no-lp" onClick={nextSpeed} aria-label={`Playback speed ${speed}x. Change`}>{speed}×</button>
          </div>
        </div>
      </div>
      {picking && (
        <div class="voice-react no-lp" role="group" aria-label={`React at ${formatDuration(pos)}`}>
          {REACTIONS.map((r) => (
            <button type="button" key={r.code} onClick={() => drop(r.code)} aria-label={`${r.label} at ${formatDuration(pos)}`}>{r.emoji}</button>
          ))}
          {myLast && (
            <button type="button" class="undo" onClick={() => { onUnreact(myLast); setPicking(false); }}
              aria-label={`Remove my ${emojiOf(myLast.reaction)} at ${formatDuration(myLast.atMs)}`}>Undo</button>
          )}
        </div>
      )}
    </div>
  );
}
