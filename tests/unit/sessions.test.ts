import { describe, expect, it } from 'vitest';
import { allTests, getTest } from '../../src/sessions/registry';
import { answeredCount, compare, firstOpen, score, validateTest } from '../../src/sessions/logic';
import type { Answers, SessionTest } from '../../src/sessions/types';

const typeTest = getTest('type-test')!;

/** Answer every question so that the chosen side wins on each dimension. */
function answersFor(t: SessionTest, sides: Record<string, 'left' | 'right'>): Answers {
  const a: Answers = {};
  for (const q of t.questions as any[]) a[q.id] = q.a.side === sides[q.dim] ? 'a' : 'b';
  return a;
}

describe('session test files', () => {
  it('every JSON test is valid', () => {
    expect(allTests.length).toBeGreaterThanOrEqual(2);
    for (const t of allTests) expect(validateTest(t, t.id)).toEqual([]);
  });

  it('the Type Test has 32 A/B questions, 8 per dimension, and a profile for all 16 types', () => {
    expect(typeTest.format).toBe('ab');
    expect(typeTest.questions).toHaveLength(32);
    for (const d of typeTest.dimensions) expect(typeTest.questions.filter((q) => q.dim === d.id)).toHaveLength(8);
    const codes = [''];
    for (const d of typeTest.dimensions) codes.splice(0, codes.length, ...codes.flatMap((c) => [c + d.left.code, c + d.right.code]));
    expect(codes).toHaveLength(16);
    for (const c of codes) expect(typeTest.profiles?.[c]?.name, c).toBeTruthy();
    expect(typeTest.footer).toMatch(/not a clinical/);
    expect(JSON.stringify(typeTest)).not.toMatch(/MBTI|Myers|Briggs/i);
  });

  it('"always A" does not give one fixed type (options alternate sides)', () => {
    const allA: Answers = Object.fromEntries(typeTest.questions.map((q) => [q.id, 'a']));
    const r = score(typeTest, allA);
    expect(r.dims.every((d) => d.leftPct === 50)).toBe(true);
  });

  it('reports readable problems', () => {
    const broken = { ...typeTest, id: 'Bad Id', questions: [{ ...typeTest.questions[0], dim: 'XX' }], reveal: ['types', 'dance'] };
    const errs = validateTest(broken, 'broken.json');
    expect(errs.join('\n')).toMatch(/id must be lowercase/);
    expect(errs.join('\n')).toMatch(/unknown dimension "XX"/);
    expect(errs.join('\n')).toMatch(/unknown step "dance"/);
    expect(errs.join('\n')).toMatch(/dimension EI: has no questions/);
    expect(validateTest(null)).toEqual(['test: not an object']);
  });
});

describe('scoring', () => {
  it('gives the four-letter code and profile', () => {
    const r = score(typeTest, answersFor(typeTest, { EI: 'left', SN: 'right', TF: 'right', JP: 'right' }));
    expect(r.code).toBe('ENFP');
    expect(r.profile?.name).toBe('The Firework');
    expect(r.dims[0].leftPct).toBe(100);
    expect(r.dims[1].leftPct).toBe(0);
    expect(r.answered).toBe(32);
  });

  it('counts a 5–3 split and breaks ties to the left side by default', () => {
    const a = answersFor(typeTest, { EI: 'right', SN: 'left', TF: 'left', JP: 'left' });
    const ei = typeTest.questions.filter((q) => q.dim === 'EI') as any[];
    ei.slice(0, 3).forEach((q) => { a[q.id] = q.a.side === 'left' ? 'a' : 'b'; }); // 3 left, 5 right
    expect(score(typeTest, a).dims[0]).toMatchObject({ leftPct: 38, code: 'I' });
    ei.slice(3, 4).forEach((q) => { a[q.id] = q.a.side === 'left' ? 'a' : 'b'; }); // 4–4
    expect(score(typeTest, a).dims[0]).toMatchObject({ leftPct: 50, code: 'E' });
  });

  it('scores Likert answers by strength', () => {
    const t: SessionTest = {
      ...typeTest, id: 'lk', format: 'likert', profiles: undefined,
      prompts: { EI: typeTest.prompts.EI, same: typeTest.prompts.same },
      dimensions: [typeTest.dimensions[0]],
      questions: [{ id: 'q1', dim: 'EI', text: 'I like parties', key: 'left' }, { id: 'q2', dim: 'EI', text: 'I like quiet', key: 'right' }],
    };
    expect(validateTest(t)).toEqual([]);
    expect(score(t, { q1: 5, q2: 1 }).dims[0]).toMatchObject({ leftPct: 100, code: 'E' });
    expect(score(t, { q1: 2, q2: 4 }).dims[0]).toMatchObject({ leftPct: 25, code: 'I' });
    expect(score(t, { q1: 9 } as any).answered).toBe(0);
  });

  it('tracks progress and the first open question', () => {
    const a: Answers = { [typeTest.questions[0].id]: 'a', [typeTest.questions[2].id]: 'b' };
    expect(answeredCount(typeTest, a)).toBe(2);
    expect(firstOpen(typeTest, a)).toBe(1);
    expect(firstOpen(typeTest, answersFor(typeTest, {}))).toBe(32);
  });
});

describe('comparison', () => {
  it('splits match and differ, and takes prompts from the differences first', () => {
    const me = score(typeTest, answersFor(typeTest, { EI: 'left', SN: 'left', TF: 'left', JP: 'left' }));
    const them = score(typeTest, answersFor(typeTest, { EI: 'right', SN: 'left', TF: 'right', JP: 'left' }));
    const c = compare(typeTest, me, them);
    expect(c.match.map((d) => d.id)).toEqual(['SN', 'JP']);
    expect(c.differ.map((d) => d.id)).toEqual(['EI', 'TF']);
    expect(c.prompts).toEqual([typeTest.prompts.EI[0], typeTest.prompts.TF[0], typeTest.prompts.EI[1]]);
  });

  it('falls back to the "same" prompts when you match everywhere', () => {
    const me = score(typeTest, answersFor(typeTest, { EI: 'left', SN: 'left', TF: 'left', JP: 'left' }));
    const c = compare(typeTest, me, me);
    expect(c.differ).toEqual([]);
    expect(c.prompts).toEqual(typeTest.prompts.same.slice(0, 3));
  });
});
