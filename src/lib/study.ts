import type { QuizQuestion } from '../../shared/types';

export function shuffle<T>(items: readonly T[], random = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * Models tend to put the right answer in the same slot (often A or B).
 * Shuffle options per attempt and remap correctIndex. True/False keeps its
 * natural order so it reads normally.
 */
export function shuffleOptions(q: QuizQuestion, random = Math.random): QuizQuestion {
  const isTrueFalse = q.options.length === 2 && q.options.every((o) => /^(true|false)$/i.test(o));
  if (isTrueFalse) return q;
  const order = shuffle(
    q.options.map((_, i) => i),
    random,
  );
  return { ...q, options: order.map((i) => q.options[i]!), correctIndex: order.indexOf(q.correctIndex) };
}

export function buildRound(questions: readonly QuizQuestion[], random = Math.random): QuizQuestion[] {
  return shuffle(questions, random).map((q) => shuffleOptions(q, random));
}
