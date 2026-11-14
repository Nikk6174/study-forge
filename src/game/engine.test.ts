import { describe, expect, it } from 'vitest';
import { applyEvent, bumpStreak, comboMultiplier, emptyProfile, levelInfo, liveStreak, reviveProfile, xpFor } from './engine';

describe('xp', () => {
  it('scales correct answers with the combo multiplier', () => {
    expect([0, 2, 3, 5, 6, 9, 30].map(comboMultiplier)).toEqual([1, 1, 1.5, 1.5, 2, 2.5, 3]);
    expect(xpFor({ type: 'answer', correct: true, combo: 1 })).toBe(10);
    expect(xpFor({ type: 'answer', correct: true, combo: 6 })).toBe(20);
    expect(xpFor({ type: 'answer', correct: false, combo: 0 })).toBe(2); // effort still counts
  });
  it('rewards perfect rounds and aced retests', () => {
    expect(xpFor({ type: 'quiz_completed', score: 3, total: 5, isRetest: false })).toBe(20);
    expect(xpFor({ type: 'quiz_completed', score: 5, total: 5, isRetest: false })).toBe(70);
    expect(xpFor({ type: 'quiz_completed', score: 2, total: 2, isRetest: true })).toBe(100);
  });
});

describe('levels', () => {
  it('follows the 50·L·(L−1) curve', () => {
    expect(levelInfo(0)).toMatchObject({ level: 1, title: 'Novice', into: 0, span: 100 });
    expect(levelInfo(99).level).toBe(1);
    expect(levelInfo(100)).toMatchObject({ level: 2, title: 'Apprentice', into: 0, span: 200 });
    expect(levelInfo(450)).toMatchObject({ level: 3, into: 150, progress: 0.5 });
  });
});

describe('streak', () => {
  it('increments on consecutive days, resets after a gap, ignores repeats', () => {
    let s = bumpStreak({ count: 0, best: 0, last: null }, '2026-02-27');
    s = bumpStreak(s, '2026-02-28');
    s = bumpStreak(s, '2026-03-01'); // across month end
    expect(s).toEqual({ count: 3, best: 3, last: '2026-03-01' });
    expect(bumpStreak(s, '2026-03-01')).toBe(s);
    expect(bumpStreak(s, '2026-03-05')).toEqual({ count: 1, best: 3, last: '2026-03-05' });
  });
  it('shows 0 once a day has been missed', () => {
    const s = { count: 4, best: 4, last: '2026-03-01' };
    expect(liveStreak(s, '2026-03-02')).toBe(4);
    expect(liveStreak(s, '2026-03-03')).toBe(0);
  });
});

describe('applyEvent', () => {
  it('awards xp, updates stats, unlocks achievements once, and reports level-ups', () => {
    let p = emptyProfile();
    const r1 = applyEvent(p, { type: 'set_generated', fromFile: true }, '2026-01-01', 1);
    expect(r1.gained).toBe(10);
    expect(r1.unlocked.map((a) => a.id).sort()).toEqual(['bookworm', 'first_forge']);
    p = r1.profile;
    const r2 = applyEvent(p, { type: 'set_generated', fromFile: true }, '2026-01-01', 2);
    expect(r2.unlocked).toEqual([]);
    const r3 = applyEvent({ ...r2.profile, xp: 95 }, { type: 'card_marked', known: true }, '2026-01-01', 3);
    expect(r3.leveledUp).toBe(2);
  });
  it('tracks best combo for combo achievements', () => {
    const r = applyEvent(emptyProfile(), { type: 'answer', correct: true, combo: 5 }, '2026-01-01', 1);
    expect(r.profile.stats.bestCombo).toBe(5);
    expect(r.unlocked.map((a) => a.id)).toContain('combo_5');
  });
});

describe('reviveProfile', () => {
  it('survives garbage and partial data', () => {
    expect(reviveProfile('nope')).toEqual(emptyProfile());
    const p = reviveProfile({ xp: -5, stats: { cards: 7, sets: 'x' }, streak: { last: 'yesterday' }, achievements: { a: 1, b: 'x' } });
    expect(p.xp).toBe(0);
    expect(p.stats.cards).toBe(7);
    expect(p.stats.sets).toBe(0);
    expect(p.streak.last).toBeNull();
    expect(p.achievements).toEqual({ a: 1 });
  });
});
