import { useEffect, useReducer, useRef } from 'react';
import type { QuizQuestion } from '../../shared/types';
import { useHotkeys } from '../hooks/useHotkeys';
import { buildRound } from '../lib/study';

interface QuizState {
  /** Questions for this attempt, with options already shuffled. */
  round: QuizQuestion[];
  index: number;
  answers: Record<string, number>;
  roundNo: number;
  isRetest: boolean;
}

type QuizAction =
  | { type: 'answer'; id: string; choice: number }
  | { type: 'next' }
  | { type: 'start'; round: QuizQuestion[]; isRetest: boolean };

// Shuffling happens in the action creator (buildRound), keeping the reducer pure.
function quizReducer(s: QuizState, a: QuizAction): QuizState {
  switch (a.type) {
    case 'answer':
      return a.id in s.answers ? s : { ...s, answers: { ...s.answers, [a.id]: a.choice } };
    case 'next':
      return { ...s, index: s.index + 1 };
    case 'start':
      return { round: a.round, index: 0, answers: {}, roundNo: s.roundNo + 1, isRetest: a.isRetest };
  }
}

const LETTERS = 'ABCDEF';

export function Quiz({ questions, active = true }: { questions: QuizQuestion[]; active?: boolean }) {
  const [s, dispatch] = useReducer(quizReducer, questions, (qs): QuizState => ({
    round: buildRound(qs),
    index: 0,
    answers: {},
    roundNo: 1,
    isRetest: false,
  }));
  const nextRef = useRef<HTMLButtonElement>(null);

  const done = s.index >= s.round.length;
  const q = s.round[s.index];
  const chosen = q ? s.answers[q.id] : undefined;
  const answered = chosen !== undefined;
  const wrong = s.round.filter((x) => s.answers[x.id] !== x.correctIndex);
  const score = s.round.length - wrong.length;
  const correctSoFar = s.round.filter((x) => s.answers[x.id] === x.correctIndex).length;

  // Move focus to "Next" after answering so Enter continues and screen
  // readers land on the feedback.
  useEffect(() => {
    if (answered && active) nextRef.current?.focus();
  }, [answered, active]);

  useHotkeys((e) => {
    if (done || !q) return;
    const k = e.key.toLowerCase();
    const n = /^[1-6]$/.test(k) ? Number(k) - 1 : LETTERS.toLowerCase().indexOf(k);
    if (!answered && n >= 0 && n < q.options.length) {
      dispatch({ type: 'answer', id: q.id, choice: n });
      e.preventDefault();
    } else if (answered && (k === 'enter' || k === 'arrowright')) {
      dispatch({ type: 'next' });
      e.preventDefault();
    }
  }, active);

  if (done) {
    const pct = Math.round((score / s.round.length) * 100);
    return (
      <div className="panel round-summary" role="status">
        <h3>{s.isRetest ? 'Retest complete' : 'Quiz complete'}</h3>
        <p className="big-score">
          {score}/{s.round.length} <span className="muted">({pct}%)</span>
        </p>
        {wrong.length > 0 ? (
          <ul className="review-list">
            {wrong.map((x) => (
              <li key={x.id}>
                <p className="review-q">{x.prompt}</p>
                <p className="review-a">
                  <span className="bad-text">You: {x.options[s.answers[x.id]!]}</span>
                  <span className="good-text">Answer: {x.options[x.correctIndex]}</span>
                </p>
                {x.explanation && <p className="muted small">{x.explanation}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <p>Perfect round — nothing to retest.</p>
        )}
        <div className="actions">
          {wrong.length > 0 && (
            <button className="btn btn-primary" onClick={() => dispatch({ type: 'start', round: buildRound(wrong), isRetest: true })}>
              Retest {wrong.length} wrong answer{wrong.length === 1 ? '' : 's'}
            </button>
          )}
          <button className="btn" onClick={() => dispatch({ type: 'start', round: buildRound(questions), isRetest: false })}>
            Retake full quiz
          </button>
        </div>
      </div>
    );
  }

  const correct = answered && chosen === q!.correctIndex;

  return (
    <div className="quiz">
      <div className="progress" aria-hidden>
        <div className="progress-bar" style={{ width: `${(s.index / s.round.length) * 100}%` }} />
      </div>
      <div className="deck-meta">
        <span>
          Question {s.index + 1} of {s.round.length}
          {s.isRetest && ' · retest'}
        </span>
        <span className="muted">{correctSoFar} correct so far</span>
      </div>

      <div className="panel question">
        <h3 className="question-prompt">{q!.prompt}</h3>
        <div className="options" role="group" aria-label="Answer options">
          {q!.options.map((opt, i) => {
            let state = '';
            if (answered) {
              if (i === q!.correctIndex) state = 'is-correct';
              else if (i === chosen) state = 'is-wrong';
              else state = 'is-dim';
            }
            return (
              <button
                key={i}
                className={`option ${state}`}
                disabled={answered}
                aria-pressed={chosen === i}
                onClick={() => dispatch({ type: 'answer', id: q!.id, choice: i })}
              >
                <span className="option-letter">{LETTERS[i]}</span>
                <span>{opt}</span>
              </button>
            );
          })}
        </div>

        {answered && (
          <div className={`feedback ${correct ? 'feedback-good' : 'feedback-bad'}`} aria-live="polite">
            <strong>{correct ? 'Correct!' : `Not quite — it’s ${LETTERS[q!.correctIndex]}.`}</strong>
            {q!.explanation && <p>{q!.explanation}</p>}
          </div>
        )}

        <div className="actions end">
          {answered ? (
            <button ref={nextRef} className="btn btn-primary" onClick={() => dispatch({ type: 'next' })}>
              {s.index + 1 === s.round.length ? 'See results' : 'Next question'} <kbd>Enter</kbd>
            </button>
          ) : (
            <span className="muted small">Pick an answer · keys 1–{q!.options.length}</span>
          )}
        </div>
      </div>
    </div>
  );
}
