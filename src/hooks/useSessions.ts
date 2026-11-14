import { useCallback, useEffect, useMemo, useReducer } from 'react';
import { normalizeStudySet } from '../../shared/normalize';
import type { Mode, StudySet } from '../../shared/types';

/**
 * Saved study sessions. A session is the original input plus a stack of
 * versions (each refinement pushes one), which makes "undo" trivial and
 * keeps refinements non-destructive.
 */

export interface SessionInput {
  text: string;
  mode: Mode;
  count: number;
}

export interface Version {
  id: string;
  set: StudySet;
  createdAt: number;
  /** The follow-up instruction that produced this version, if any. */
  instruction?: string;
}

export interface Session {
  id: string;
  createdAt: number;
  updatedAt: number;
  input: SessionInput;
  versions: Version[];
}

interface State {
  sessions: Session[];
  activeId: string | null;
}

type Action =
  | { type: 'create'; input: SessionInput; set: StudySet; id: string; versionId: string; at: number }
  | { type: 'addVersion'; sessionId: string; set: StudySet; instruction: string; versionId: string; at: number }
  | { type: 'undo'; sessionId: string }
  | { type: 'select'; sessionId: string | null }
  | { type: 'remove'; sessionId: string };

const STORAGE_KEY = 'study-forge:v1';
const MAX_SESSIONS = 25;
const MAX_VERSIONS = 10;

const uid = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).slice(0, 12);

// Ids and timestamps arrive in the action so the reducer stays pure.
function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'create': {
      const session: Session = {
        id: action.id,
        createdAt: action.at,
        updatedAt: action.at,
        input: action.input,
        versions: [{ id: action.versionId, set: action.set, createdAt: action.at }],
      };
      return { sessions: [session, ...state.sessions].slice(0, MAX_SESSIONS), activeId: session.id };
    }
    case 'addVersion':
      // Applies to the session that *made* the request, even if the user has
      // since switched to another one.
      return {
        ...state,
        sessions: state.sessions.map((s) =>
          s.id === action.sessionId
            ? {
                ...s,
                updatedAt: action.at,
                versions: [
                  ...s.versions,
                  { id: action.versionId, set: action.set, createdAt: action.at, instruction: action.instruction },
                ].slice(-MAX_VERSIONS),
              }
            : s,
        ),
      };
    case 'undo':
      return {
        ...state,
        sessions: state.sessions.map((s) =>
          s.id === action.sessionId && s.versions.length > 1 ? { ...s, versions: s.versions.slice(0, -1) } : s,
        ),
      };
    case 'select':
      return { ...state, activeId: action.sessionId };
    case 'remove':
      return {
        sessions: state.sessions.filter((s) => s.id !== action.sessionId),
        activeId: state.activeId === action.sessionId ? null : state.activeId,
      };
  }
}

/**
 * localStorage is untrusted too (old versions, manual edits, other tabs):
 * every stored set goes back through the same normaliser, and anything
 * broken is dropped instead of crashing the app on load.
 */
function load(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { sessions: [], activeId: null };
    const parsed = JSON.parse(raw) as { sessions?: unknown };
    const sessions: Session[] = [];
    for (const s of Array.isArray(parsed.sessions) ? parsed.sessions : []) {
      try {
        const session = s as Session;
        const versions = session.versions.map((v) => ({
          ...v,
          set: normalizeStudySet(v.set, { mode: 'both' }).set,
        }));
        if (versions.length && typeof session.input?.text === 'string') sessions.push({ ...session, versions });
      } catch {
        /* skip corrupt session */
      }
    }
    return { sessions, activeId: null };
  } catch {
    return { sessions: [], activeId: null };
  }
}

export function useSessions() {
  const [state, dispatch] = useReducer(reducer, undefined, load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessions: state.sessions }));
    } catch {
      /* quota exceeded / private mode: sessions just won't persist */
    }
  }, [state.sessions]);

  const active = useMemo(
    () => state.sessions.find((s) => s.id === state.activeId) ?? null,
    [state.sessions, state.activeId],
  );

  return {
    sessions: state.sessions,
    active,
    create: useCallback(
      (input: SessionInput, set: StudySet) =>
        dispatch({ type: 'create', input, set, id: uid(), versionId: uid(), at: Date.now() }),
      [],
    ),
    addVersion: useCallback(
      (sessionId: string, set: StudySet, instruction: string) =>
        dispatch({ type: 'addVersion', sessionId, set, instruction, versionId: uid(), at: Date.now() }),
      [],
    ),
    undo: useCallback((sessionId: string) => dispatch({ type: 'undo', sessionId }), []),
    select: useCallback((sessionId: string | null) => dispatch({ type: 'select', sessionId }), []),
    remove: useCallback((sessionId: string) => dispatch({ type: 'remove', sessionId }), []),
  };
}
