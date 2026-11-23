import { defineDrop, type DropApi } from './types';

type Pt = { x: number; y: number };
type Content = { subject: string; scenes: string[] };

const key = (i: number) => `s${i}`;
const label = (d: number) => (d < 20 ? 'In sync' : d < 45 ? 'A bit apart' : 'Worlds apart');
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const dotPos = (p: Pt) => ({ left: `calc(${p.x}% - 9px)`, top: `calc(${p.y}% - 9px)` });

function summary(content: Content, api: DropApi) {
  const rows = content.scenes.map((name, i) => {
    const a = api.mine<Pt>(key(i));
    const b = api.theirs<Pt>(key(i));
    return { name, d: a && b ? dist(a, b) : null };
  });
  let best = -1;
  let bi = -1;
  rows.forEach((r, i) => { if (r.d != null && r.d > best) { best = r.d; bi = i; } });
  return { rows, bi };
}

export default defineDrop<Content>({
  type: 'feeling-map',
  title: 'Feeling Map',
  trayDescription: 'Plot how each scene felt',
  order: 1,
  content: {
    subject: 'Movie night',
    scenes: ['The opening', 'The turning point', 'The big moment', 'The ending'],
  },
  setup: [
    { key: 'subject', label: 'What did you watch?', kind: 'text', placeholder: 'e.g. Interstellar', maxLength: 60 },
    { key: 'scenes', label: 'Scenes (one per line)', kind: 'lines', min: 1, max: 8 },
  ],
  subtitle: (c) => c.subject,
  pinTitle: (c) => `Feeling Map · ${c.subject}`,
  pinDetail(c, api) {
    const { bi } = summary(c, api);
    if (api.myProgress.done && bi >= 0) return `Felt most differently at ${c.scenes[bi]}`;
    return `In progress · scene ${Math.min(Number(api.myProgress.step || 0) + 1, c.scenes.length)}`;
  },

  Renderer({ content, api }) {
    const scenes = content.scenes.length ? content.scenes : ['The whole thing'];
    const step = Math.min(Number(api.myProgress.step || 0), scenes.length - 1);
    const done = !!api.myProgress.done;
    const p = api.partner.name;

    if (done) {
      const { rows, bi } = summary({ ...content, scenes }, api);
      return (
        <div class="stack">
          <div class="talk">
            <div class="talk-k">Talk about this one</div>
            <div class="talk-v">
              {bi >= 0
                ? <>You felt most differently at <strong>{scenes[bi]}</strong></>
                : <>Waiting for {p} to lock in their dots</>}
            </div>
          </div>
          {rows.map((r, j) => (
            <div class="sum-row" key={j}>
              <div class="sum-top"><span>{r.name}</span><span>{r.d == null ? `Waiting for ${p}` : label(r.d)}</span></div>
              <div class="bar"><div class={j === bi ? 'max' : ''} style={{ width: `${r.d == null ? 0 : Math.max(4, Math.min(100, Math.round(r.d / 1.1)))}%` }} /></div>
            </div>
          ))}
        </div>
      );
    }

    const k = key(step);
    const mine = api.mine<Pt>(k);
    const theirs = api.theirs<Pt>(k);
    const locked = api.iLocked(k);
    const revealed = api.revealed(k);

    const onGrid = (e: MouseEvent & { currentTarget: HTMLButtonElement }) => {
      if (locked) return;
      const r = e.currentTarget.getBoundingClientRect();
      // Keyboard "click" has no coordinates: drop the dot in the middle.
      const hasXY = e.clientX !== 0 || e.clientY !== 0;
      const x = hasXY ? Math.max(4, Math.min(96, Math.round(((e.clientX - r.left) / r.width) * 100))) : 50;
      const y = hasXY ? Math.max(5, Math.min(95, Math.round(((e.clientY - r.top) / r.height) * 100))) : 50;
      api.saveDraft(k, { x, y });
    };
    const next = () =>
      step < scenes.length - 1 ? api.setMyProgress({ step: step + 1 }) : api.setMyProgress({ done: true });

    return (
      <div class="stack">
        <div class="fm-head">
          <div class="fm-scene">{scenes[step]}</div>
          <div class="fm-num">Scene {step + 1} of {scenes.length}</div>
        </div>
        <button
          type="button"
          class={`grid-btn${locked ? ' locked' : ''}`}
          onClick={onGrid}
          aria-label="Mood grid: tap where this scene left you"
        >
          <span class="ax-v" />
          <span class="ax-h" />
          <span class="lbl top">Intense</span>
          <span class="lbl bottom">Calm</span>
          <span class="lbl left">Heavy</span>
          <span class="lbl right">Uplifting</span>
          {revealed && theirs && <span class="dot them" style={dotPos(theirs)} />}
          {mine && <span class="dot me" style={dotPos(mine)} />}
        </button>

        {!locked && (
          <div class="stack-10">
            <div class="note">
              {api.theyLocked(k)
                ? `${p} placed their dot · hidden until you lock in`
                : `${p} hasn't placed their dot yet · yours stays hidden too`}
            </div>
            {mine
              ? <button type="button" class="btn-primary" onClick={() => api.lock(k, mine)}>Lock in &amp; reveal</button>
              : <button type="button" class="btn-primary" disabled>Tap the grid to place your dot</button>}
          </div>
        )}

        {locked && (
          <div class="fm-result">
            <div>
              <div class="fm-gap">{revealed && mine && theirs ? label(dist(mine, theirs)) : `Locked · waiting for ${p}`}</div>
              <div class="fm-legend">Circle = you · square = {p}</div>
            </div>
            <button type="button" class="btn-primary sm" onClick={next}>
              {step < scenes.length - 1 ? 'Next scene' : 'See summary'}
            </button>
          </div>
        )}
      </div>
    );
  },
});
