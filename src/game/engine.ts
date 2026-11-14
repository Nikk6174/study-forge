/**
 * Game rules, as pure functions. No React, no storage, no clock: the date
 * is passed in, so every rule is deterministic and unit-tested.
 *
 * Design intent: reward *effort* (you get XP even for "still learning"),
 * reward *accuracy* more (combos multiply), and never punish – wrong
 * answers reset the combo but don't cost XP.
 */

export type GameEvent =
  | { type: 'set_generated'; fromFile: boolean }
  | { type: 'set_refined' }
  | { type: 'card_marked'; known: boolean }
  | { type: 'deck_completed'; known: number; total: number }
  /** `combo` is the streak of correct answers *including* this one (0 if wrong). */
  | { type: 'answer'; correct: boolean; combo: number }
  | { type: 'quiz_completed'; score: number; total: number; isRetest: boolean };

export interface Stats {
  sets: number;
  refines: number;
  fileSets: number;
  cards: number;
  cardsKnown: number;
  answers: number;
  correct: number;
  perfectRounds: number;
  retestsCleared: number;
  bestCombo: number;
}

export interface Profile {
  xp: number;
  streak: { count: number; best: number; last: string | null };
  stats: Stats;
  /** achievement id → unlock timestamp */
  achievements: Record<string, number>;
}

export const emptyProfile = (): Profile => ({
  xp: 0,
  streak: { count: 0, best: 0, last: null },
  stats: {
    sets: 0,
    refines: 0,
    fileSets: 0,
    cards: 0,
    cardsKnown: 0,
    answers: 0,
    correct: 0,
    perfectRounds: 0,
    retestsCleared: 0,
    bestCombo: 0,
  },
  achievements: {},
});

/* ---------------- XP ---------------- */

/** 0–2 correct in a row: 1×, 3–5: 1.5×, 6–8: 2×, … capped at 3×. */
export function comboMultiplier(combo: number): number {
  return Math.min(3, 1 + Math.floor(Math.max(0, combo) / 3) * 0.5);
}

export function xpFor(e: GameEvent): number {
  switch (e.type) {
    case 'set_generated':
      return 10;
    case 'set_refined':
      return 5;
    case 'card_marked':
      return e.known ? 5 : 2;
    case 'deck_completed':
      return 15 + (e.total > 0 && e.known === e.total ? 25 : 0);
    case 'answer':
      return e.correct ? Math.round(10 * comboMultiplier(e.combo)) : 2;
    case 'quiz_completed': {
      const perfect = e.total > 0 && e.score === e.total;
      return 20 + (perfect ? 50 : 0) + (perfect && e.isRetest ? 30 : 0);
    }
  }
}

/* ---------------- Levels ---------------- */

const TITLES = ['Novice', 'Apprentice', 'Scholar', 'Adept', 'Sage', 'Mastermind', 'Luminary', 'Legend'];

/** Total XP needed to *reach* a level: L1=0, L2=100, L3=300, L4=600, … (50·L·(L−1)). */
export const xpForLevel = (level: number) => 50 * level * (level - 1);

export interface LevelInfo {
  level: number;
  title: string;
  /** XP into the current level and the size of the level. */
  into: number;
  span: number;
  progress: number; // 0..1
}

export function levelInfo(xp: number): LevelInfo {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  const floor = xpForLevel(level);
  const span = xpForLevel(level + 1) - floor;
  return {
    level,
    title: TITLES[Math.min(level - 1, TITLES.length - 1)]!,
    into: xp - floor,
    span,
    progress: (xp - floor) / span,
  };
}

/* ---------------- Streak ---------------- */

/** Local calendar day, e.g. "2026-11-14". */
export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const dayNumber = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!) / 86_400_000;
};

export function bumpStreak(streak: Profile['streak'], today: string): Profile['streak'] {
  if (streak.last === today) return streak;
  const gap = streak.last ? dayNumber(today) - dayNumber(streak.last) : Infinity;
  const count = gap === 1 ? streak.count + 1 : 1;
  return { count, best: Math.max(streak.best, count), last: today };
}

/** A streak is only "alive" if you studied today or yesterday. */
export function liveStreak(streak: Profile['streak'], today: string): number {
  if (!streak.last) return 0;
  return dayNumber(today) - dayNumber(streak.last) <= 1 ? streak.count : 0;
}

/* ---------------- Achievements ---------------- */

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string; // lucide icon name, mapped in the UI
  unlocked: (p: Profile, e: GameEvent) => boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_forge', name: 'First Forge', description: 'Generate your first study set', icon: 'Hammer', unlocked: (p) => p.stats.sets >= 1 },
  { id: 'bookworm', name: 'Bookworm', description: 'Build a set from an uploaded file', icon: 'FileText', unlocked: (p) => p.stats.fileSets >= 1 },
  { id: 'tinkerer', name: 'Tinkerer', description: 'Refine a set with a follow-up', icon: 'Wand2', unlocked: (p) => p.stats.refines >= 1 },
  { id: 'combo_5', name: 'Hot Hand', description: 'Hit a 5× answer combo', icon: 'Flame', unlocked: (p) => p.stats.bestCombo >= 5 },
  { id: 'combo_10', name: 'Unstoppable', description: 'Hit a 10× answer combo', icon: 'Zap', unlocked: (p) => p.stats.bestCombo >= 10 },
  { id: 'perfect', name: 'Flawless', description: 'Finish a quiz with 100%', icon: 'Crown', unlocked: (p) => p.stats.perfectRounds >= 1 },
  { id: 'comeback', name: 'Comeback', description: 'Ace a retest of your mistakes', icon: 'RotateCcw', unlocked: (p) => p.stats.retestsCleared >= 1 },
  { id: 'card_shark', name: 'Card Shark', description: 'Review 100 flashcards', icon: 'Layers', unlocked: (p) => p.stats.cards >= 100 },
  { id: 'streak_3', name: 'On Fire', description: 'Study 3 days in a row', icon: 'CalendarCheck', unlocked: (p) => p.streak.best >= 3 },
];

/* ---------------- Reducer core ---------------- */

export interface EventResult {
  profile: Profile;
  gained: number;
  unlocked: Achievement[];
  /** New level number if this event crossed a level boundary. */
  leveledUp: number | null;
}

function nextStats(s: Stats, e: GameEvent): Stats {
  switch (e.type) {
    case 'set_generated':
      return { ...s, sets: s.sets + 1, fileSets: s.fileSets + (e.fromFile ? 1 : 0) };
    case 'set_refined':
      return { ...s, refines: s.refines + 1 };
    case 'card_marked':
      return { ...s, cards: s.cards + 1, cardsKnown: s.cardsKnown + (e.known ? 1 : 0) };
    case 'answer':
      return {
        ...s,
        answers: s.answers + 1,
        correct: s.correct + (e.correct ? 1 : 0),
        bestCombo: Math.max(s.bestCombo, e.combo),
      };
    case 'quiz_completed': {
      const perfect = e.total > 0 && e.score === e.total;
      return {
        ...s,
        perfectRounds: s.perfectRounds + (perfect ? 1 : 0),
        retestsCleared: s.retestsCleared + (perfect && e.isRetest ? 1 : 0),
      };
    }
    case 'deck_completed':
      return s;
  }
}

export function applyEvent(profile: Profile, event: GameEvent, today: string, now: number): EventResult {
  const gained = xpFor(event);
  const before = levelInfo(profile.xp).level;
  const next: Profile = {
    xp: profile.xp + gained,
    streak: bumpStreak(profile.streak, today),
    stats: nextStats(profile.stats, event),
    achievements: profile.achievements,
  };
  const unlocked = ACHIEVEMENTS.filter((a) => !(a.id in next.achievements) && a.unlocked(next, event));
  if (unlocked.length) {
    next.achievements = { ...next.achievements, ...Object.fromEntries(unlocked.map((a) => [a.id, now])) };
  }
  const after = levelInfo(next.xp).level;
  return { profile: next, gained, unlocked, leveledUp: after > before ? after : null };
}

/** Loosely validate a stored profile, falling back to defaults per field. */
export function reviveProfile(raw: unknown): Profile {
  const base = emptyProfile();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<Profile>;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d);
  const stats = { ...base.stats };
  for (const k of Object.keys(stats) as (keyof Stats)[]) stats[k] = num(r.stats?.[k], 0);
  return {
    xp: num(r.xp, 0),
    streak: {
      count: num(r.streak?.count, 0),
      best: num(r.streak?.best, 0),
      last: typeof r.streak?.last === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.streak.last) ? r.streak.last : null,
    },
    stats,
    achievements:
      r.achievements && typeof r.achievements === 'object'
        ? Object.fromEntries(Object.entries(r.achievements).filter(([, v]) => typeof v === 'number'))
        : {},
  };
}
