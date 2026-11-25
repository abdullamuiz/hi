import type { AbQuestion, Answers, Dimension, LikertQuestion, Profile, RevealStep, SessionTest } from './types';

const ID_RE = /^[a-z0-9-]{1,40}$/;
const KEY_RE = /^[A-Za-z0-9-]{1,40}$/;
const STEPS: RevealStep[] = ['types', 'scales', 'match', 'prompts', 'finish'];

const isStr = (v: unknown, max = 400): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const isSide = (v: unknown) => v === 'left' || v === 'right';

/** Every problem with a test file, as readable lines. Empty = valid. */
export function validateTest(t: any, file = 'test'): string[] {
  const err: string[] = [];
  const bad = (m: string) => err.push(`${file}: ${m}`);
  if (!t || typeof t !== 'object') return [`${file}: not an object`];
  if (!ID_RE.test(t.id || '')) bad('id must be lowercase letters, digits and dashes');
  if (!Number.isInteger(t.version) || t.version < 1) bad('version must be a whole number ≥ 1');
  for (const k of ['title', 'subtitle', 'footer']) if (!isStr(t[k], 200)) bad(`${k} is required`);
  if (!isStr(t.icon, 8)) bad('icon is required (one emoji)');
  if (t.format !== 'ab' && t.format !== 'likert') bad('format must be "ab" or "likert"');

  const dims: Dimension[] = Array.isArray(t.dimensions) ? t.dimensions : [];
  if (!dims.length) bad('needs at least one dimension');
  const dimIds = new Set<string>();
  dims.forEach((d, i) => {
    if (!KEY_RE.test(d?.id || '')) bad(`dimension ${i}: bad id`);
    if (dimIds.has(d?.id)) bad(`dimension ${d?.id}: duplicate id`);
    dimIds.add(d?.id);
    if (!isStr(d?.name, 40)) bad(`dimension ${d?.id}: name is required`);
    for (const s of ['left', 'right'] as const) {
      if (!isStr(d?.[s]?.code, 4)) bad(`dimension ${d?.id}: ${s}.code is required (≤ 4 characters)`);
      if (!isStr(d?.[s]?.label, 60)) bad(`dimension ${d?.id}: ${s}.label is required`);
    }
    if (d?.tie != null && !isSide(d.tie)) bad(`dimension ${d?.id}: tie must be "left" or "right"`);
    if (!isStr(d?.same) || !isStr(d?.differ)) bad(`dimension ${d?.id}: same and differ texts are required`);
  });

  const qs: any[] = Array.isArray(t.questions) ? t.questions : [];
  if (!qs.length) bad('needs at least one question');
  if (qs.length > 100) bad('at most 100 questions');
  const qIds = new Set<string>();
  const perDim = new Map<string, number>();
  qs.forEach((q, i) => {
    const where = `question ${q?.id || i}`;
    if (!KEY_RE.test(q?.id || '')) bad(`${where}: bad id`);
    if (qIds.has(q?.id)) bad(`${where}: duplicate id`);
    qIds.add(q?.id);
    if (!dimIds.has(q?.dim)) bad(`${where}: unknown dimension "${q?.dim}"`);
    perDim.set(q?.dim, (perDim.get(q?.dim) || 0) + 1);
    if (!isStr(q?.text, 200)) bad(`${where}: text is required`);
    if (t.format === 'ab') {
      for (const o of ['a', 'b'] as const) {
        if (!isStr(q?.[o]?.text, 120)) bad(`${where}: option ${o} needs text`);
        if (!isSide(q?.[o]?.side)) bad(`${where}: option ${o} needs side "left" or "right"`);
      }
      if (q?.a?.side && q.a.side === q?.b?.side) bad(`${where}: both options push the same side`);
    } else if (t.format === 'likert' && !isSide(q?.key)) bad(`${where}: key must be "left" or "right"`);
  });
  dims.forEach((d) => { if (!perDim.get(d?.id)) bad(`dimension ${d?.id}: has no questions`); });

  if (t.profiles != null) {
    if (typeof t.profiles !== 'object') bad('profiles must be an object');
    else for (const [code, p] of Object.entries<any>(t.profiles)) {
      if (!isStr(p?.name, 60) || !isStr(p?.blurb, 300)) bad(`profile ${code}: name and blurb are required`);
    }
  }
  const reveal: unknown[] = Array.isArray(t.reveal) ? t.reveal : [];
  if (!reveal.length) bad('reveal needs at least one step');
  reveal.forEach((s) => { if (!STEPS.includes(s as RevealStep)) bad(`reveal: unknown step "${String(s)}"`); });

  if (!t.prompts || typeof t.prompts !== 'object') bad('prompts are required');
  else {
    for (const [k, list] of Object.entries<any>(t.prompts)) {
      if (k !== 'same' && !dimIds.has(k)) bad(`prompts: unknown dimension "${k}"`);
      if (!Array.isArray(list) || !list.every((p) => isStr(p, 200))) bad(`prompts.${k}: must be a list of texts`);
    }
    if (!Array.isArray(t.prompts.same) || t.prompts.same.length < 3) bad('prompts.same needs at least 3 prompts');
  }
  return err;
}

// ---------------------------------------------------------------------------- scoring

export interface DimScore {
  dim: Dimension;
  /** Share of the left side, 0–100. */
  leftPct: number;
  side: 'left' | 'right';
  code: string;
}

export interface Result {
  dims: DimScore[];
  /** Combined code, e.g. "ENFP". */
  code: string;
  profile: Profile | null;
  answered: number;
}

export function isAnswered(t: SessionTest, _q: AbQuestion | LikertQuestion, v: unknown): boolean {
  return t.format === 'ab' ? v === 'a' || v === 'b' : Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5;
}

export const answeredCount = (t: SessionTest, a: Answers) => t.questions.filter((q) => isAnswered(t, q, a[q.id])).length;

/** First question not yet answered (or the length when all are done). */
export const firstOpen = (t: SessionTest, a: Answers) => {
  const i = t.questions.findIndex((q) => !isAnswered(t, q, a[q.id]));
  return i < 0 ? t.questions.length : i;
};

export function score(t: SessionTest, answers: Answers): Result {
  const tally = new Map(t.dimensions.map((d) => [d.id, { left: 0, right: 0 }]));
  let answered = 0;
  for (const q of t.questions) {
    const v = answers[q.id];
    const s = tally.get(q.dim);
    if (!s || !isAnswered(t, q, v)) continue;
    answered++;
    if (t.format === 'ab') {
      const side = (q as AbQuestion)[v as 'a' | 'b'].side;
      s[side] += 1;
    } else {
      const key = (q as LikertQuestion).key;
      const other = key === 'left' ? 'right' : 'left';
      s[key] += ((v as number) - 1) / 4;
      s[other] += (5 - (v as number)) / 4;
    }
  }
  const dims = t.dimensions.map((d) => {
    const s = tally.get(d.id)!;
    const total = s.left + s.right;
    const leftPct = total ? Math.round((s.left / total) * 100) : 50;
    const side: 'left' | 'right' = s.left > s.right ? 'left' : s.right > s.left ? 'right' : d.tie || 'left';
    return { dim: d, leftPct, side, code: d[side].code };
  });
  const code = dims.map((d) => d.code).join('');
  return { dims, code, profile: t.profiles?.[code] ?? null, answered };
}

export interface Comparison {
  match: Dimension[];
  differ: Dimension[];
  prompts: string[];
}

/** Where two results agree and differ, plus up to `n` prompts, differences first. */
export function compare(t: SessionTest, a: Result, b: Result, n = 3): Comparison {
  const match: Dimension[] = [];
  const differ: Dimension[] = [];
  a.dims.forEach((d, i) => (d.side === b.dims[i]?.side ? match : differ).push(d.dim));
  const prompts: string[] = [];
  // One prompt from each differing dimension in turn, then the "same" list.
  for (let round = 0; prompts.length < n && round < 10; round++) {
    let added = false;
    for (const d of differ) {
      const p = t.prompts[d.id]?.[round];
      if (p && prompts.length < n) { prompts.push(p); added = true; }
    }
    if (!added) break;
  }
  for (const p of t.prompts.same || []) if (prompts.length < n && !prompts.includes(p)) prompts.push(p);
  return { match, differ, prompts };
}

// ---------------------------------------------------------------------------- presence

/** "In it now" if they've been in the session in the last 45 seconds. */
export const PRESENCE_MS = 45_000;
export const isHere = (p: { seenAt?: { toMillis(): number } | null } | undefined, now = Date.now()) =>
  !!p?.seenAt && now - p.seenAt.toMillis() < PRESENCE_MS;
