/**
 * The contract between the model, the server and the UI.
 *
 * Everything the UI renders has passed through `normalizeStudySet`, so
 * components can rely on these invariants without defensive checks:
 *  - every id is unique within its list
 *  - every string is trimmed and non-empty
 *  - every question has 2–6 distinct options and a valid correctIndex
 */

export type Mode = 'flashcards' | 'quiz' | 'both';

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  hint?: string;
}

export interface QuizQuestion {
  id: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation?: string;
}

export interface StudySet {
  title: string;
  flashcards: Flashcard[];
  questions: QuizQuestion[];
}

export interface GenerateRequest {
  text: string;
  mode: Mode;
  count: number;
  /** Present for follow-up edits: the model edits `set` instead of starting over. */
  refine?: { set: StudySet; instruction: string };
  /** Dev-only failure injection, see server/simulate.ts. */
  simulate?: SimulateMode;
}

export interface GenerateResponse {
  set: StudySet;
  /** Non-fatal problems we repaired or dropped (shown to the user, not hidden). */
  warnings: string[];
  meta: { model: string; attempts: number; ms: number; repaired: boolean };
}

export const SIMULATE_MODES = [
  'malformed',
  'wrong_shape',
  'partial',
  'empty',
  'slow',
  'upstream_error',
  'rate_limit',
] as const;
export type SimulateMode = (typeof SIMULATE_MODES)[number];

export const LIMITS = {
  textMin: 3,
  textMax: 15_000,
  countMin: 3,
  countMax: 25,
  instructionMax: 400,
  optionsMin: 2,
  optionsMax: 6,
  fieldMax: 600,
} as const;
