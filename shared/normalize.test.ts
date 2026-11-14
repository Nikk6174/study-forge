import { describe, expect, it } from 'vitest';
import { OutputError, extractJson, normalizeStudySet, parseModelOutput } from './normalize.js';

const good = {
  title: 'Cells',
  flashcards: [
    { front: 'Powerhouse of the cell?', back: 'Mitochondria' },
    { front: 'Site of protein synthesis?', back: 'Ribosome' },
  ],
  questions: [
    { prompt: 'Which organelle has its own DNA?', options: ['Golgi', 'Mitochondria', 'Lysosome'], correctIndex: 1 },
  ],
};

const expectOutputError = (fn: () => unknown, code: 'BAD_OUTPUT' | 'EMPTY_OUTPUT') => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(OutputError);
    expect((e as OutputError).code).toBe(code);
    return e as OutputError;
  }
  throw new Error('expected to throw');
};

describe('extractJson', () => {
  it('parses plain JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });
  it('strips markdown fences', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it('finds JSON surrounded by prose', () => {
    expect(extractJson('Sure! Here you go:\n{"a":[1,2]}\nHope that helps.')).toEqual({ a: [1, 2] });
  });
  it('rejects truncated JSON as BAD_OUTPUT with a repair hint', () => {
    const err = expectOutputError(() => extractJson('{"title":"x","flashcards":[{"front":"a"'), 'BAD_OUTPUT');
    expect(err.detail).toMatch(/not valid JSON/);
  });
  it('treats whitespace as EMPTY_OUTPUT', () => {
    expectOutputError(() => extractJson('   \n'), 'EMPTY_OUTPUT');
  });
  it('rejects non-strings', () => {
    expectOutputError(() => extractJson(undefined), 'BAD_OUTPUT');
  });
});

describe('normalizeStudySet', () => {
  it('accepts well-formed output and assigns ids', () => {
    const { set, warnings } = normalizeStudySet(good, { mode: 'both' });
    expect(set.flashcards.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(set.questions[0]).toMatchObject({ id: 'q1', correctIndex: 1 });
    expect(warnings).toEqual([]);
  });

  it('is idempotent (safe to re-run on already-normalised data)', () => {
    const once = normalizeStudySet(good, { mode: 'both' }).set;
    expect(normalizeStudySet(once, { mode: 'both' }).set).toEqual(once);
  });

  it('only keeps the lists for the requested mode', () => {
    const { set } = normalizeStudySet(good, { mode: 'flashcards' });
    expect(set.questions).toEqual([]);
    expect(set.flashcards).toHaveLength(2);
  });

  it('maps common key aliases', () => {
    const { set } = normalizeStudySet(
      {
        cards: [{ question: 'Q', answer: 'A' }, { term: 'T', definition: 'D' }],
        quiz: [{ question: 'P?', choices: ['x', 'y'], answer: 'y' }],
      },
      { mode: 'both' },
    );
    expect(set.flashcards).toEqual([
      { id: 'c1', front: 'Q', back: 'A' },
      { id: 'c2', front: 'T', back: 'D' },
    ]);
    expect(set.questions[0]!.correctIndex).toBe(1);
  });

  it('resolves the correct answer given as a letter, label or numeric string', () => {
    const q = (correct: unknown, options = ['A) red', 'B) green', 'C) blue']) => ({
      questions: [{ prompt: 'Colour?', options, correct }],
    });
    expect(normalizeStudySet(q('B'), { mode: 'quiz' }).set.questions[0]!.correctIndex).toBe(1);
    expect(normalizeStudySet(q('c)'), { mode: 'quiz' }).set.questions[0]!.correctIndex).toBe(2);
    expect(normalizeStudySet(q('2'), { mode: 'quiz' }).set.questions[0]!.correctIndex).toBe(2);
    expect(normalizeStudySet(q('green'), { mode: 'quiz' }).set.questions[0]!.options).toEqual(['red', 'green', 'blue']);
  });

  it('drops invalid items but keeps valid ones, with a warning', () => {
    const { set, warnings } = normalizeStudySet(
      {
        flashcards: [{ front: 'ok', back: 'fine' }, { front: '', back: 'x' }, 'nonsense', { front: 'ok', back: 'dup' }],
        questions: [
          { prompt: 'Out of range', options: ['a', 'b'], correctIndex: 5 },
          { prompt: 'Too few', options: ['a'], correctIndex: 0 },
          { prompt: 'Dupes', options: ['a', 'A'], correctIndex: 0 },
          { prompt: 'Good', options: ['a', 'b'], correctIndex: 0 },
        ],
      },
      { mode: 'both' },
    );
    expect(set.flashcards).toHaveLength(1);
    expect(set.questions.map((q) => q.prompt)).toEqual(['Good']);
    expect(warnings[0]).toMatch(/Skipped 6/);
  });

  it('throws BAD_OUTPUT (repairable) when items exist but none are valid', () => {
    const err = expectOutputError(
      () => normalizeStudySet({ flashcards: [{ front: 1 }, {}] }, { mode: 'flashcards' }),
      'BAD_OUTPUT',
    );
    expect(err.retryable).toBe(true);
    expect(err.detail).toMatch(/Card #1/);
  });

  it('throws EMPTY_OUTPUT with the model notice when there is nothing to study', () => {
    const err = expectOutputError(
      () => normalizeStudySet({ title: '', notice: 'Input is gibberish.', flashcards: [], questions: [] }, { mode: 'both' }),
      'EMPTY_OUTPUT',
    );
    expect(err.message).toBe('Input is gibberish.');
    expect(err.retryable).toBe(false);
  });

  it('throws BAD_OUTPUT on the wrong shape', () => {
    expectOutputError(() => normalizeStudySet({ result: [1, 2] }, { mode: 'both' }), 'BAD_OUTPUT');
    expectOutputError(() => normalizeStudySet('a string', { mode: 'both' }), 'BAD_OUTPUT');
    expectOutputError(() => normalizeStudySet(null, { mode: 'both' }), 'BAD_OUTPUT');
  });

  it('unwraps a single wrapper object and classifies bare arrays', () => {
    expect(normalizeStudySet({ studySet: good }, { mode: 'both' }).set.title).toBe('Cells');
    const { set } = normalizeStudySet([{ front: 'a', back: 'b' }, { prompt: 'p', options: ['x', 'y'], correctIndex: 0 }], {
      mode: 'both',
    });
    expect([set.flashcards.length, set.questions.length]).toEqual([1, 1]);
  });

  it('caps to the requested count and warns on shortfall', () => {
    const many = { flashcards: Array.from({ length: 8 }, (_, i) => ({ front: `f${i}`, back: 'b' })) };
    expect(normalizeStudySet(many, { mode: 'flashcards', count: 5 }).set.flashcards).toHaveLength(5);
    expect(normalizeStudySet(many, { mode: 'flashcards', count: 10 }).warnings).toContain('Asked for 10 flashcards, got 8.');
  });

  it('keeps valid model ids (for refinement) and replaces bad or duplicate ones', () => {
    const { set } = normalizeStudySet(
      {
        flashcards: [
          { id: 'c7', front: 'a', back: 'b' },
          { id: 'c7', front: 'c', back: 'd' },
          { id: 'has spaces!', front: 'e', back: 'f' },
        ],
      },
      { mode: 'flashcards' },
    );
    expect(new Set(set.flashcards.map((c) => c.id)).size).toBe(3);
    expect(set.flashcards[0]!.id).toBe('c7');
  });
});

describe('parseModelOutput', () => {
  it('handles the full pipeline from fenced text', () => {
    const raw = 'Here is the set:\n```json\n' + JSON.stringify(good) + '\n```';
    expect(parseModelOutput(raw, { mode: 'both' }).set.flashcards).toHaveLength(2);
  });
});
