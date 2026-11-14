import { z } from 'zod';
import { AppError } from './errors.js';
import { LIMITS, type Flashcard, type Mode, type QuizQuestion, type StudySet } from './types.js';

/**
 * Turning untrusted model output into a StudySet.
 *
 * Strategy: lenient on the way in, strict on the way out.
 *  1. extractJson    – find a JSON value in raw text (fences, prose, BOM…)
 *  2. locateLists    – find the card/question arrays even if keys drifted
 *  3. per-item zod   – validate + coerce each item independently, so one bad
 *                      item is dropped instead of failing the whole response
 *  4. post-process   – dedupe, cap, assign stable unique ids
 *
 * Errors carry a `detail` string that the server feeds back to the model
 * in a single repair attempt.
 */

export class OutputError extends AppError {
  readonly detail: string;
  constructor(code: 'BAD_OUTPUT' | 'EMPTY_OUTPUT', message: string, detail = message) {
    super(code, message);
    this.detail = detail;
  }
}

/* ------------------------------------------------------------------ */
/* 1. JSON extraction                                                  */
/* ------------------------------------------------------------------ */

export function extractJson(raw: unknown): unknown {
  if (typeof raw !== 'string') {
    throw new OutputError('BAD_OUTPUT', 'The model returned no text.', 'Response contained no text.');
  }
  const text = raw.replace(/^﻿/, '').trim();
  if (!text) throw new OutputError('EMPTY_OUTPUT', 'The model returned an empty response.');

  const candidates: string[] = [text];
  const fenced = text.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  // Prose before/after the JSON: take the outermost {...} or [...] span.
  for (const [open, close] of [['{', '}'], ['[', ']']] as const) {
    const start = text.indexOf(open);
    const end = text.lastIndexOf(close);
    if (start !== -1 && end > start) candidates.push(text.slice(start, end + 1));
  }

  let lastError = '';
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (e) {
      lastError = (e as Error).message;
    }
  }
  throw new OutputError(
    'BAD_OUTPUT',
    'The model returned malformed JSON.',
    `Output was not valid JSON (${lastError}). It began with: ${text.slice(0, 120)}`,
  );
}

/* ------------------------------------------------------------------ */
/* 2. Item schemas (with alias + type coercion)                        */
/* ------------------------------------------------------------------ */

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const first = (o: Record<string, unknown>, keys: string[]) => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
};

const clip = (s: string) =>
  s.length > LIMITS.fieldMax ? `${s.slice(0, LIMITS.fieldMax - 1).trimEnd()}…` : s;

const Text = z.preprocess(
  (v) => (typeof v === 'number' || typeof v === 'boolean' ? String(v) : v),
  z
    .string()
    .transform((s) => clip(s.trim()))
    .pipe(z.string().min(1, 'must not be empty')),
);
const OptionalText = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() ? v : undefined),
  Text.optional(),
);

const CardSchema = z.preprocess(
  (v) =>
    isObj(v)
      ? {
          id: v.id,
          front: first(v, ['front', 'question', 'term', 'prompt', 'q']),
          back: first(v, ['back', 'answer', 'definition', 'a']),
          hint: v.hint,
        }
      : v,
  z.object({ id: z.unknown(), front: Text, back: Text, hint: OptionalText }),
);

/** "B", "b)", "Option C" → 1/1/2. Returns -1 if not a letter reference. */
function letterIndex(s: string): number {
  const m = s.trim().match(/^(?:option\s+)?([a-f])(?:[).:]|$)/i);
  return m ? m[1]!.toLowerCase().charCodeAt(0) - 97 : -1;
}

/** Strip "A) ", "b. ", "(c) " prefixes models like to add to options. */
const stripOptionLabel = (s: string) => s.replace(/^\(?[a-fA-F][).:]\s+/, '');

const QuestionSchema = z
  .preprocess(
    (v) =>
      isObj(v)
        ? {
            id: v.id,
            prompt: first(v, ['prompt', 'question', 'q', 'text']),
            options: first(v, ['options', 'choices', 'answers']),
            correct: first(v, ['correctIndex', 'answerIndex', 'correct', 'correctAnswer', 'answer']),
            explanation: first(v, ['explanation', 'rationale', 'why']),
          }
        : v,
    z.object({
      id: z.unknown(),
      prompt: Text,
      options: z
        .array(z.preprocess((o) => (isObj(o) ? first(o, ['text', 'label', 'value']) : o), Text))
        .min(LIMITS.optionsMin, `needs at least ${LIMITS.optionsMin} options`)
        .max(LIMITS.optionsMax, `has more than ${LIMITS.optionsMax} options`),
      correct: z.union([z.number(), z.string()], { message: 'missing correct answer' }),
      explanation: OptionalText,
    }),
  )
  .transform((q, ctx) => {
    const labelled = q.options.map(stripOptionLabel);
    const options = labelled.every((o) => o.length > 0) ? labelled : q.options;

    // Resolve whichever form the model used for the answer into an index.
    let index = -1;
    if (typeof q.correct === 'number') {
      index = Number.isInteger(q.correct) ? q.correct : -1;
    } else {
      const s = q.correct.trim();
      if (/^\d+$/.test(s)) index = Number(s);
      else {
        const byText = options.findIndex(
          (o) => o.toLowerCase() === stripOptionLabel(s).toLowerCase(),
        );
        index = byText !== -1 ? byText : letterIndex(s);
      }
    }
    if (index < 0 || index >= options.length) {
      ctx.addIssue({ code: 'custom', message: `correct answer "${q.correct}" does not match any option` });
      return z.NEVER;
    }

    // Duplicate options make the question ambiguous; reject rather than guess.
    const unique = new Set(options.map((o) => o.toLowerCase()));
    if (unique.size !== options.length) {
      ctx.addIssue({ code: 'custom', message: 'has duplicate options' });
      return z.NEVER;
    }

    return { id: q.id, prompt: q.prompt, options, correctIndex: index, explanation: q.explanation };
  });

/* ------------------------------------------------------------------ */
/* 3. Locating the lists                                              */
/* ------------------------------------------------------------------ */

interface Located {
  title: string;
  notice?: string;
  cards: unknown[];
  questions: unknown[];
}

const asArray = (v: unknown): unknown[] | undefined => {
  if (Array.isArray(v)) return v;
  if (isObj(v)) {
    const inner = first(v, ['items', 'questions', 'cards', 'flashcards']);
    if (Array.isArray(inner)) return inner;
  }
  return undefined;
};

function locateLists(json: unknown): Located {
  // A bare array: classify each item by whether it looks like a question.
  if (Array.isArray(json)) {
    const looksLikeQuestion = (v: unknown) => isObj(v) && Array.isArray(first(v, ['options', 'choices']));
    return {
      title: 'Study set',
      cards: json.filter((v) => !looksLikeQuestion(v)),
      questions: json.filter(looksLikeQuestion),
    };
  }
  if (!isObj(json)) {
    throw new OutputError('BAD_OUTPUT', 'The model returned the wrong kind of data.', 'Top level must be a JSON object.');
  }

  // Some models wrap everything: { "studySet": { ... } } / { "data": { ... } }
  const keys = Object.keys(json);
  const cardKeys = ['flashcards', 'cards', 'deck', 'flashCards'];
  const questionKeys = ['questions', 'quiz', 'mcqs', 'quizQuestions'];
  const isListKey = (k: string) => cardKeys.includes(k) || questionKeys.includes(k);
  if (keys.length === 1 && !isListKey(keys[0]!) && isObj(json[keys[0]!])) return locateLists(json[keys[0]!]);

  const cards = asArray(first(json, cardKeys));
  const questions = asArray(first(json, questionKeys));
  if (!cards && !questions) {
    throw new OutputError(
      'BAD_OUTPUT',
      'The model returned data in an unexpected shape.',
      `Expected "flashcards" and/or "questions" arrays; got keys: ${keys.join(', ') || '(none)'}.`,
    );
  }
  const title = typeof json.title === 'string' && json.title.trim() ? clip(json.title.trim()) : 'Study set';
  const notice = typeof json.notice === 'string' && json.notice.trim() ? json.notice.trim() : undefined;
  return { title, notice, cards: cards ?? [], questions: questions ?? [] };
}

/* ------------------------------------------------------------------ */
/* 4. Validation, dedupe, ids                                         */
/* ------------------------------------------------------------------ */

const ID_RE = /^[\w-]{1,40}$/;

function validateList<S extends z.ZodTypeAny>(
  items: unknown[],
  schema: S,
  label: string,
  keyOf: (item: z.output<S>) => string,
): { valid: z.output<S>[]; issues: string[] } {
  const valid: z.output<S>[] = [];
  const issues: string[] = [];
  const seen = new Set<string>();
  items.forEach((item, i) => {
    const r = schema.safeParse(item);
    if (!r.success) {
      const why = r.error.issues
        .map((iss) => `${iss.path.join('.') || 'item'} ${iss.message}`)
        .join('; ');
      issues.push(`${label} #${i + 1}: ${why}`);
      return;
    }
    const key = keyOf(r.data).toLowerCase();
    if (seen.has(key)) {
      issues.push(`${label} #${i + 1}: duplicate`);
      return;
    }
    seen.add(key);
    valid.push(r.data);
  });
  return { valid, issues };
}

function assignIds<T extends { id?: unknown }>(items: T[], prefix: string): (Omit<T, 'id'> & { id: string })[] {
  const used = new Set<string>();
  let n = 0;
  return items.map((item) => {
    let id = typeof item.id === 'string' && ID_RE.test(item.id) && !used.has(item.id) ? item.id : '';
    while (!id || used.has(id)) id = `${prefix}${++n}`;
    used.add(id);
    return { ...item, id };
  });
}

/** Drop undefined optional keys so output is stable and idempotent. */
const compact = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

export interface NormalizeOptions {
  /** Which lists the user asked for; lists not asked for are ignored. */
  mode: Mode;
  /** Requested items per list. Used to cap and to warn on shortfall. */
  count?: number;
}

export interface NormalizeResult {
  set: StudySet;
  warnings: string[];
}

export function normalizeStudySet(json: unknown, opts: NormalizeOptions): NormalizeResult {
  const located = locateLists(json);
  const wantCards = opts.mode !== 'quiz';
  const wantQuestions = opts.mode !== 'flashcards';
  const cap = opts.count ?? LIMITS.countMax * 2;
  const warnings: string[] = [];

  const cards = wantCards
    ? validateList(located.cards, CardSchema, 'Card', (c) => c.front)
    : { valid: [], issues: [] };
  const questions = wantQuestions
    ? validateList(located.questions, QuestionSchema, 'Question', (q) => q.prompt)
    : { valid: [], issues: [] };

  const rawCount = (wantCards ? located.cards.length : 0) + (wantQuestions ? located.questions.length : 0);
  const validCount = cards.valid.length + questions.valid.length;
  const issues = [...cards.issues, ...questions.issues];

  if (validCount === 0) {
    if (rawCount > 0) {
      throw new OutputError(
        'BAD_OUTPUT',
        `The model returned ${rawCount} item(s), but none were usable.`,
        `Every item was invalid:\n${issues.slice(0, 8).join('\n')}`,
      );
    }
    throw new OutputError(
      'EMPTY_OUTPUT',
      located.notice ?? "The model couldn't find anything to make study material from. Try adding more detail.",
    );
  }

  const dropped = issues.length;
  if (dropped > 0) warnings.push(`Skipped ${dropped} malformed or duplicate item${dropped === 1 ? '' : 's'}.`);

  const finalize = <T extends { id?: unknown }>(valid: T[], want: boolean, prefix: string, noun: string) => {
    if (!want) return [];
    if (opts.count && valid.length < opts.count) {
      warnings.push(`Asked for ${opts.count} ${noun}, got ${valid.length}.`);
    }
    return assignIds(valid.slice(0, cap), prefix).map(compact);
  };

  const set: StudySet = {
    title: located.title,
    flashcards: finalize(cards.valid, wantCards, 'c', 'flashcards') as Flashcard[],
    questions: finalize(questions.valid, wantQuestions, 'q', 'questions') as QuizQuestion[],
  };
  return { set, warnings };
}

/** Convenience: raw model text → StudySet. */
export function parseModelOutput(raw: unknown, opts: NormalizeOptions): NormalizeResult {
  return normalizeStudySet(extractJson(raw), opts);
}
