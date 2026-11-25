import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { getTest } from '../sessions/registry';
import { answeredCount, compare, firstOpen, isAnswered, score, type Result } from '../sessions/logic';
import type { AbQuestion, Answers, LikertQuestion, RevealStep, SessionTest } from '../sessions/types';
import {
  finishSession, isHere, loadMyAnswers, loadTheirAnswers, myHistory, saveAnswers, touchPresence,
  watchProgress, watchSession, type SessionDoc, type SessionProgress,
} from '../data/sessions';
import { closeOverlay, forgetOverlay, openOverlay } from '../lib/overlay';
import { BackIcon } from './icons';
import { playScreen } from './Effects';

interface Who { uid: string; name: string }

interface Props {
  roomId: string;
  sessionId: string;
  me: Who;
  them: Who;
  onClose(): void;
  /** Back to the chat with this text in the message box. */
  onTalk(text: string): void;
  onPin(title: string, detail: string, dropId: string): void;
  /** Start a fresh run of the same test (history is kept). */
  onRetake(test: SessionTest): void;
  onToast(text: string): void;
}

const LIKERT = ['Strongly disagree', 'Disagree', 'Not sure', 'Agree', 'Strongly agree'];
const stepKey = (id: string) => `hi.session.${id}.step`;
const readStep = (id: string) => { try { return Number(localStorage.getItem(stepKey(id)) || 0); } catch { return 0; } };
const saveStep = (id: string, n: number) => { try { localStorage.setItem(stepKey(id), String(n)); } catch { /* ignore */ } };

/** Full-screen engine for a Session test: answer at your own pace, then the reveal. */
export function SessionScreen(p: Props) {
  const [ses, setSes] = useState<SessionDoc | null | undefined>(undefined);
  const [prog, setProg] = useState<Record<string, SessionProgress>>({});
  const [answers, setAnswers] = useState<Answers | null>(null);
  const [started, setStarted] = useState(false);
  const [idx, setIdx] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const [results, setResults] = useState<{ mine: Result; theirs: Result } | null>(null);
  const [err, setErr] = useState('');
  const [, tick] = useState(0);
  const closeRef = useRef(p.onClose);
  closeRef.current = p.onClose;
  const test = ses ? getTest(ses.testId) : undefined;

  // The phone's back gesture closes the session (answers are already saved).
  useLayoutEffect(() => {
    const close = () => closeRef.current();
    openOverlay(close);
    return () => forgetOverlay(close);
  }, []);
  useEffect(() => watchSession(p.roomId, p.sessionId, setSes), [p.sessionId]);
  useEffect(() => watchProgress(p.roomId, p.sessionId, setProg), [p.sessionId]);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 10_000); return () => clearInterval(t); }, []);

  // Resume where I left off.
  useEffect(() => {
    if (!test) return;
    loadMyAnswers(p.roomId, p.sessionId, p.me.uid)
      .then((d) => {
        const a = d?.answers || {};
        setAnswers(a);
        setIdx(firstOpen(test, a));
        setStarted(answeredCount(test, a) > 0);
      })
      .catch((e) => setErr(e?.message || 'Could not load your answers.'));
  }, [test?.id]);

  const mine = prog[p.me.uid];
  const theirs = p.them.uid ? prog[p.them.uid] : undefined;
  const total = test?.questions.length ?? 0;
  const answered = test && answers ? answeredCount(test, answers) : 0;
  const myDone = !!mine?.done;
  const bothDone = myDone && !!theirs?.done;

  // Presence: "I'm in the session" every 20 s while it's open.
  const presence = useRef({ answered, total, done: myDone, code: mine?.code });
  presence.current = { answered, total, done: myDone, code: mine?.code };
  useEffect(() => {
    if (!test || answers === null) return;
    const beat = () => touchPresence(p.roomId, p.sessionId, p.me.uid, presence.current).catch(() => {});
    beat();
    const t = setInterval(beat, 20_000);
    return () => clearInterval(t);
  }, [test?.id, answers === null]);

  // Both finished: fetch their answers (allowed now) and score both.
  useEffect(() => {
    if (!test || !bothDone || results || !answers || mine?.pending) return;
    let alive = true;
    loadTheirAnswers(p.roomId, p.sessionId, p.them.uid)
      .then((t) => {
        if (!alive) return;
        const r = { mine: score(test, answers), theirs: score(test, t.answers) };
        setResults(r);
        if (mine?.code !== r.mine.code) touchPresence(p.roomId, p.sessionId, p.me.uid, { answered: total, total, done: true, code: r.mine.code }).catch(() => {});
      })
      .catch((e) => { if (alive) setErr(e?.message || 'Could not load the results.'); });
    return () => { alive = false; };
  }, [bothDone, !!answers, mine?.pending]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') closeOverlay(); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);

  const choose = (qid: string, v: 'a' | 'b' | number) => {
    if (!test || !answers || myDone) return;
    const next = { ...answers, [qid]: v };
    setAnswers(next);
    saveAnswers(p.roomId, p.sessionId, p.me.uid, next, answeredCount(test, next), total)
      .catch((e) => p.onToast(e?.message || 'Could not save that answer.'));
    // A beat to see the choice, then on to the next unanswered question.
    setTimeout(() => setIdx((i) => {
      const after = test.questions.findIndex((q, j) => j > i && !isAnswered(test, q, next[q.id]));
      return after >= 0 ? after : firstOpen(test, next);
    }), 220);
  };

  const finish = async () => {
    if (!test || !answers) return;
    setFinishing(true);
    try { await finishSession(p.roomId, p.sessionId, p.me.uid, answers, total); }
    catch (e: any) { p.onToast(e?.message || 'Could not finish.'); }
    finally { setFinishing(false); }
  };

  const here = isHere(theirs) && !theirs?.done;
  let body: preact.ComponentChildren;
  if (err) body = <div class="session-center"><p>{err}</p></div>;
  else if (ses === null) body = <div class="session-center"><p>This session isn't available.</p></div>;
  else if (ses && !test) body = <div class="session-center"><p>This Session needs a newer version of the app.</p></div>;
  else if (!test || answers === null) body = <div class="session-center"><p>Loading…</p></div>;
  else if (bothDone) {
    body = results
      ? <Reveal test={test} results={results} {...p} />
      : <div class="session-center"><p>Working out your results…</p></div>;
  } else if (myDone) {
    body = (
      <div class="session-center">
        <div class="session-big" aria-hidden="true">{test.icon}</div>
        <h2>You're done</h2>
        <p>Waiting for {p.them.name} · {theirs?.answered ?? 0}/{total}{here ? ` · ${p.them.name} is in it now` : ''}</p>
        <p class="session-fine">Your answers are locked and stay private until {p.them.name} finishes too. We'll reveal both together.</p>
        <button type="button" class="btn-ghost" onClick={() => closeOverlay()}>Back to the chat</button>
      </div>
    );
  } else if (!started) {
    body = (
      <div class="session-center">
        <div class="session-big" aria-hidden="true">{test.icon}</div>
        <h2>{test.title}</h2>
        <p>{test.subtitle}</p>
        <p>{total} quick questions. Answer at your own pace: you can stop and come back. {p.them.name} won't see your answers until you've both finished.</p>
        <button type="button" class="btn-primary" onClick={() => setStarted(true)}>Start</button>
        <p class="session-fine">{test.footer}</p>
      </div>
    );
  } else if (idx >= total) {
    body = (
      <div class="session-center">
        <h2>All {total} answered</h2>
        <p>Finish to lock your answers. You can't change them after this.</p>
        <button type="button" class="btn-primary" disabled={finishing} onClick={finish}>{finishing ? 'Finishing…' : 'Finish'}</button>
        <button type="button" class="btn-ghost" onClick={() => setIdx(total - 1)}>Go back</button>
      </div>
    );
  } else {
    const q = test.questions[idx];
    body = <Question test={test} q={q} n={idx} total={total} value={answers[q.id]} onChoose={(v) => choose(q.id, v)}
      onBack={idx > 0 ? () => setIdx(idx - 1) : undefined} />;
  }

  return (
    <div class="session" role="dialog" aria-modal="true" aria-label={test?.title || 'Session'}>
      <header class="session-top">
        <button type="button" class="icon-btn" onClick={() => closeOverlay()} aria-label={bothDone ? 'Close' : 'Pause and close'}><BackIcon /></button>
        <div class="session-head">
          <div class="session-title">{test?.title || 'Session'}</div>
          {test && !bothDone && (
            <div class="session-progress" aria-live="polite">
              You {myDone ? 'done' : `${answered}/${total}`} · {p.them.name} {theirs?.done ? 'done' : `${theirs?.answered ?? 0}/${total}`}
              {here && <span class="here-dot"> · in it now</span>}
            </div>
          )}
        </div>
      </header>
      {test && !bothDone && !myDone && started && (
        <div class="session-bar" aria-hidden="true"><i style={{ width: `${(answered / Math.max(1, total)) * 100}%` }} /></div>
      )}
      <div class="session-body">{body}</div>
    </div>
  );
}

function Question({ test, q, n, total, value, onChoose, onBack }: {
  test: SessionTest; q: AbQuestion | LikertQuestion; n: number; total: number; value: unknown;
  onChoose(v: 'a' | 'b' | number): void; onBack?(): void;
}) {
  return (
    <div class="session-q" key={q.id}>
      <div class="session-kicker">Question {n + 1} of {total}</div>
      <h2 class="session-qtext">{q.text}</h2>
      {test.format === 'ab' ? (
        <div class="session-options" role="radiogroup" aria-label={q.text}>
          {(['a', 'b'] as const).map((o) => (
            <button type="button" key={o} role="radio" aria-checked={value === o} class={`session-opt${value === o ? ' on' : ''}`}
              onClick={() => onChoose(o)}>
              {(q as AbQuestion)[o].text}
            </button>
          ))}
        </div>
      ) : (
        <div class="session-options likert" role="radiogroup" aria-label={q.text}>
          {LIKERT.map((label, i) => (
            <button type="button" key={label} role="radio" aria-checked={value === i + 1} class={`session-opt${value === i + 1 ? ' on' : ''}`}
              onClick={() => onChoose(i + 1)}>{label}</button>
          ))}
        </div>
      )}
      {onBack && <button type="button" class="link-btn session-back" onClick={onBack}>← Previous question</button>}
    </div>
  );
}

// ---------------------------------------------------------------------------- reveal

function Reveal(p: Props & { test: SessionTest; results: { mine: Result; theirs: Result } }) {
  const { test, results } = p;
  const steps = test.reveal;
  const [i, setI] = useState(() => Math.min(readStep(p.sessionId), steps.length - 1));
  const [history, setHistory] = useState<Array<{ id: string; code: string; at: number }>>([]);
  const cmp = useMemo(() => compare(test, results.mine, results.theirs), [results]);
  const step: RevealStep = steps[i];
  const go = (d: number) => setI((x) => { const n = Math.max(0, Math.min(steps.length - 1, x + d)); saveStep(p.sessionId, n); return n; });

  useEffect(() => {
    if (step !== 'finish') return;
    playScreen('confetti');
    myHistory(p.roomId, test.id, p.me.uid, p.sessionId).then(setHistory).catch(() => {});
  }, [step]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'ArrowRight') go(1); else if (e.key === 'ArrowLeft') go(-1); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);

  const summary = `You ${results.mine.code} · ${p.them.name} ${results.theirs.code}`;
  const talk = (text: string) => { p.onTalk(text); closeOverlay(); };

  let slide: preact.ComponentChildren;
  if (step === 'types') {
    slide = (
      <>
        <div class="session-kicker">Your types</div>
        <div class="type-cards">
          {[{ who: 'You', r: results.mine }, { who: p.them.name, r: results.theirs }].map(({ who, r }, n) => (
            <div class="type-card" key={who} style={{ animationDelay: `${0.15 + n * 0.35}s` }}>
              <div class="type-who">{who}</div>
              <div class="type-code">{r.code}</div>
              {r.profile && <div class="type-name">{r.profile.name}</div>}
              {r.profile && <div class="type-blurb">{r.profile.blurb}</div>}
            </div>
          ))}
        </div>
      </>
    );
  } else if (step === 'scales') {
    slide = (
      <>
        <div class="session-kicker">Side by side</div>
        <div class="scale-legend"><span><i class="mk me" aria-hidden="true" /> You</span><span><i class="mk them" aria-hidden="true" /> {p.them.name}</span></div>
        <div class="scales">
          {results.mine.dims.map((d, n) => {
            const t = results.theirs.dims[n];
            return (
              <div class="scale" key={d.dim.id}>
                <div class="scale-name">{d.dim.name}</div>
                <div class="scale-ends"><span>{d.dim.left.code} · {d.dim.left.label}</span><span>{d.dim.right.label} · {d.dim.right.code}</span></div>
                <div class="scale-track" role="img"
                  aria-label={`${d.dim.name}: you ${d.leftPct}% ${d.dim.left.label}, ${p.them.name} ${t.leftPct}% ${d.dim.left.label}`}>
                  <i class="mk me" style={{ left: `${100 - d.leftPct}%` }} />
                  <i class="mk them" style={{ left: `${100 - t.leftPct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </>
    );
  } else if (step === 'match') {
    slide = (
      <>
        <div class="session-kicker">Where you match</div>
        {cmp.match.length ? cmp.match.map((d) => <div class="match-card" key={d.id}><b>{d.name}</b><p>{d.same}</p></div>)
          : <div class="match-card"><p>Nowhere! You balance each other out.</p></div>}
        <div class="session-kicker">Where you differ</div>
        {cmp.differ.length ? cmp.differ.map((d) => <div class="match-card differ" key={d.id}><b>{d.name}</b><p>{d.differ}</p></div>)
          : <div class="match-card differ"><p>Nowhere. Same wavelength.</p></div>}
      </>
    );
  } else if (step === 'prompts') {
    slide = (
      <>
        <div class="session-kicker">Talk about it</div>
        <p>Three questions to ask each other:</p>
        {cmp.prompts.map((q) => (
          <div class="prompt-card" key={q}><p>{q}</p><button type="button" class="link-btn" onClick={() => talk(q)}>Ask this</button></div>
        ))}
      </>
    );
  } else {
    slide = (
      <>
        <div class="session-kicker">{test.title}</div>
        <div class="session-hero">{summary}</div>
        <div class="session-actions">
          <button type="button" class="btn-primary" onClick={() => p.onPin(test.title, summary, p.sessionId)}>Pin result</button>
          <button type="button" class="btn-primary" onClick={() => talk(`We got ${results.mine.code} and ${results.theirs.code}! ${cmp.prompts[0] || ''}`.trim())}>Talk about it</button>
          <button type="button" class="btn-ghost" onClick={() => shareResult(test, results, p.them.name).catch((e) => e?.name !== 'AbortError' && p.onToast(e?.message || 'Could not share.'))}>Share as image</button>
          <button type="button" class="btn-ghost" onClick={() => { p.onRetake(test); }}>Retake</button>
        </div>
        {history.length > 0 && (
          <div class="session-history">
            <b>Your earlier results</b>
            {history.map((h) => <span key={h.id}>{h.code} · {new Date(h.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span>)}
          </div>
        )}
        <p class="session-fine">{test.footer}</p>
      </>
    );
  }

  return (
    <div class="session-reveal">
      <div class="rewind-dots" aria-hidden="true">{steps.map((s, n) => <span key={s} class={n <= i ? 'on' : ''} />)}</div>
      <div class="session-slide" key={step}>{slide}</div>
      <div class="session-nav">
        <button type="button" class="btn-ghost" disabled={i === 0} onClick={() => go(-1)}>Back</button>
        <span>{i + 1} / {steps.length}</span>
        <button type="button" class="btn-primary" disabled={i === steps.length - 1} onClick={() => go(1)}>Next</button>
      </div>
    </div>
  );
}

/** A square summary image: both codes and profile names. */
async function shareResult(test: SessionTest, r: { mine: Result; theirs: Result }, them: string) {
  const c = document.createElement('canvas');
  c.width = 1080; c.height = 1080;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 1080, 1080);
  grad.addColorStop(0, '#1E7F93'); grad.addColorStop(1, '#232B47');
  g.fillStyle = grad; g.fillRect(0, 0, 1080, 1080);
  g.fillStyle = '#F2EFE6'; g.textAlign = 'center';
  g.font = '600 46px Inter, sans-serif';
  g.fillText(`${test.icon} ${test.title}`, 540, 170);
  [['You', r.mine], [them, r.theirs]].forEach(([who, x], n) => {
    const cx = 290 + n * 500;
    const res = x as Result;
    g.font = '500 40px Inter, sans-serif'; g.fillText(String(who).slice(0, 18), cx, 420);
    g.font = '700 150px "Space Grotesk", Inter, sans-serif'; g.fillText(res.code, cx, 590);
    if (res.profile) { g.font = '500 40px Inter, sans-serif'; g.fillText(res.profile.name, cx, 670); }
  });
  g.font = '400 30px Inter, sans-serif'; g.globalAlpha = 0.8;
  g.fillText(test.footer, 540, 960);
  g.fillText('Hi · hi-dropchat.web.app', 540, 1010);
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not make the image.'))), 'image/png'));
  const file = new File([blob], `hi-${test.id}.png`, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?(d: unknown): boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) return nav.share({ files: [file], title: test.title });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
