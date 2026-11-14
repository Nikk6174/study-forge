import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { applyEvent, dayKey, reviveProfile, type Achievement, type GameEvent, type Profile } from './engine';

/**
 * Game state for the whole app. Components call `record(event)` from
 * event handlers; the provider applies the pure rules in engine.ts,
 * persists the profile, and queues feedback (XP pops, achievement toasts,
 * level-up, confetti) for the overlay components to render.
 */

export type Toast =
  | { id: number; kind: 'xp'; amount: number }
  | { id: number; kind: 'achievement'; achievement: Achievement };

interface State {
  profile: Profile;
  toasts: Toast[];
  levelUp: number | null;
  /** Incremented to fire confetti; components react to changes. */
  burst: number;
}

type Action =
  | { type: 'event'; event: GameEvent; today: string; now: number; firstId: number }
  | { type: 'dismissToast'; id: number }
  | { type: 'dismissLevelUp' }
  | { type: 'celebrate' }
  | { type: 'reset' };

const STORAGE_KEY = 'study-forge:profile:v1';

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'event': {
      const r = applyEvent(s.profile, a.event, a.today, a.now);
      let id = a.firstId;
      const toasts: Toast[] = [...s.toasts];
      if (r.gained > 0) toasts.push({ id: id++, kind: 'xp', amount: r.gained });
      for (const achievement of r.unlocked) toasts.push({ id: id++, kind: 'achievement', achievement });
      const big = r.leveledUp !== null || r.unlocked.length > 0;
      return {
        profile: r.profile,
        toasts: toasts.slice(-6),
        levelUp: r.leveledUp ?? s.levelUp,
        burst: big ? s.burst + 1 : s.burst,
      };
    }
    case 'dismissToast':
      return { ...s, toasts: s.toasts.filter((t) => t.id !== a.id) };
    case 'dismissLevelUp':
      return { ...s, levelUp: null };
    case 'celebrate':
      return { ...s, burst: s.burst + 1 };
    case 'reset':
      return { ...s, profile: reviveProfile(null) };
  }
}

function load(): State {
  let profile = reviveProfile(null);
  try {
    profile = reviveProfile(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    /* corrupt → fresh profile */
  }
  return { profile, toasts: [], levelUp: null, burst: 0 };
}

interface GameApi {
  profile: Profile;
  toasts: Toast[];
  levelUp: number | null;
  burst: number;
  today: string;
  record: (event: GameEvent) => void;
  celebrate: () => void;
  dismissToast: (id: number) => void;
  dismissLevelUp: () => void;
  resetProgress: () => void;
}

const GameContext = createContext<GameApi | null>(null);

export function GameProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, load);
  const nextId = useRef(1);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.profile));
    } catch {
      /* storage full / disabled */
    }
  }, [state.profile]);

  const record = useCallback((event: GameEvent) => {
    const firstId = nextId.current;
    nextId.current += 10; // room for xp + several achievements
    dispatch({ type: 'event', event, today: dayKey(new Date()), now: Date.now(), firstId });
  }, []);

  const api = useMemo<GameApi>(
    () => ({
      ...state,
      today: dayKey(new Date()),
      record,
      celebrate: () => dispatch({ type: 'celebrate' }),
      dismissToast: (id) => dispatch({ type: 'dismissToast', id }),
      dismissLevelUp: () => dispatch({ type: 'dismissLevelUp' }),
      resetProgress: () => dispatch({ type: 'reset' }),
    }),
    [state, record],
  );

  return <GameContext.Provider value={api}>{children}</GameContext.Provider>;
}

export function useGame(): GameApi {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame must be used inside <GameProvider>');
  return ctx;
}
