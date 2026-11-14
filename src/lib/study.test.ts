import { describe, expect, it } from 'vitest';
import { buildRound, shuffleOptions } from './study';

const q = { id: 'q1', prompt: 'Capital of France?', options: ['Berlin', 'Paris', 'Rome', 'Madrid'], correctIndex: 1 };

describe('shuffleOptions', () => {
  it('keeps the same correct answer text after shuffling', () => {
    for (let i = 0; i < 50; i++) {
      const s = shuffleOptions(q);
      expect(s.options[s.correctIndex]).toBe('Paris');
      expect([...s.options].sort()).toEqual([...q.options].sort());
    }
  });

  it('leaves True/False in natural order', () => {
    const tf = { ...q, options: ['True', 'False'], correctIndex: 1 };
    expect(shuffleOptions(tf, () => 0)).toEqual(tf);
  });
});

describe('buildRound', () => {
  it('contains every question exactly once', () => {
    const qs = [q, { ...q, id: 'q2' }, { ...q, id: 'q3' }];
    expect(buildRound(qs).map((x) => x.id).sort()).toEqual(['q1', 'q2', 'q3']);
  });
});
