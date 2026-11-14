import { ArrowRight, Check, Flame, RotateCcw, Sparkles, X } from 'lucide-react';
import { useEffect, useReducer, useRef } from 'react';
import type { QuizQuestion } from '../../shared/types';
import { comboMultiplier, xpFor } from '../game/engine';
import { useGame } from '../game/GameContext';
import { useHotkeys } from '../hooks/useHotkeys';
import { buildRound } from '../lib/study';
import { Ring } from './game/GameUI';

interface QuizState {
  /** Questions for this attempt, with options already shuffled. */
  round: QuizQuestion[];
  index: number;
  answers: Record<string, number>;
  isRetest: boolean;
  /** Consecutive correct answers. */
  combo: number;
  bestCombo: number;
  /** XP earned this round (shown on the results screen). */
  xp: number;
}

type QuizAction =
  | { type: 'answer'; id: string; choice: number; correct: boolean; xp: number }
  | { type: 'next'; xp: number }
  | { type: 'start'; round: QuizQuestion[]; isRetest: boolean };

// Shuffling happens in the action creator (buildRound), keeping the reducer pure.
function quizReducer(s: QuizState, a: QuizAction): QuizState {
  switch (a.type) {
    case 'answer': {
      if (a.id in s.answers) return s;
      const combo = a.correct ? s.combo + 1 : 0;
      return { ...s, answers: { ...s.answers, [a.id]: a.choice }, combo, bestCombo: Math.max(s.bestCombo, combo), xp: s.xp + a.xp };
    }
    case 'next':
      return { ...s, index: s.index + 1, xp: s.xp + a.xp };
    case 'start':
      return { round: a.round, index: 0, answers: {}, isRetest: a.isRetest, combo: 0, bestCombo: 0, xp: 0 };
  }
}

const LETTERS = 'ABCDEF';

export function Quiz({ questions, active = true }: { questions: QuizQuestion[]; active?: boolean }) {
  const game = useGame();
  const [s, dispatch] = useReducer(quizReducer, questions, (qs): QuizState => ({
    round: buildRound(qs),
    index: 0,
    answers: {},
    isRetest: false,
    combo: 0,
    bestCombo: 0,
    xp: 0,
  }));
  const nextRef = useRef<HTMLButtonElement>(null);

  const done = s.index >= s.round.length;
  const q = s.round[s.index];
  const chosen = q ? s.answers[q.id] : undefined;
  const answered = chosen !== undefined;
  const wrong = s.round.filter((x) => s.answers[x.id] !== x.correctIndex);
  const score = s.round.length - wrong.length;

  const answer = (choice: number) => {
    if (!q || answered) return;
    const correct = choice === q.correctIndex;
    const event = { type: 'answer' as const, correct, combo: correct ? s.combo + 1 : 0 };
    dispatch({ type: 'answer', id: q.id, choice, correct, xp: xpFor(event) });
    game.record(event);
  };

  const next = () => {
    if (!answered) return;
    let bonus = 0;
    if (s.index + 1 === s.round.length) {
      const event = { type: 'quiz_completed' as const, score, total: s.round.length, isRetest: s.isRetest };
      bonus = xpFor(event);
      game.record(event);
      if (score === s.round.length) game.celebrate();
    }
    dispatch({ type: 'next', xp: bonus });
  };

  // Move focus to "Next" after answering so Enter continues and screen readers land on the feedback.
  useEffect(() => {
    if (answered && active) nextRef.current?.focus();
  }, [answered, active]);

  useHotkeys((e) => {
    if (done || !q) return;
    const k = e.key.toLowerCase();
    const n = /^[1-6]$/.test(k) ? Number(k) - 1 : LETTERS.toLowerCase().indexOf(k);
    if (!answered && n >= 0 && n < q.options.length) {
      answer(n);
      e.preventDefault();
    } else if (answered && (k === 'enter' || k === 'arrowright')) {
      next();
      e.preventDefault();
    }
  }, active);

  if (done) {
    const pct = score / s.round.length;
    const perfect = wrong.length === 0;
    return (
      <div className="panel summary" role="status">
        <Ring value={pct} size={140} stroke={11}>
          <span className="ring-big">
            {score}/{s.round.length}
          </span>
          <span className="ring-small">{Math.round(pct * 100)}%</span>
        </Ring>
        <h3>{perfect ? (s.isRetest ? 'Comeback complete!' : 'Flawless run!') : s.isRetest ? 'Retest complete' : 'Quiz complete'}</h3>
        <div className="score-row">
          <span className="pill pill-gold">
            <Sparkles size={14} aria-hidden /> +{s.xp} XP this round
          </span>
          <span className="pill pill-flame">
            <Flame size={14} aria-hidden /> best combo {s.bestCombo}×
          </span>
        </div>
        {wrong.length > 0 && (
          <ul className="review-list">
            {wrong.map((x) => (
              <li key={x.id}>
                <p className="review-q">{x.prompt}</p>
                <p className="review-a">
                  <span className="bad-text">
                    <X size={14} aria-hidden /> {x.options[s.answers[x.id]!]}
                  </span>
                  <span className="good-text">
                    <Check size={14} aria-hidden /> {x.options[x.correctIndex]}
                  </span>
                </p>
                {x.explanation && <p className="muted small">{x.explanation}</p>}
              </li>
            ))}
          </ul>
        )}
        <div className="actions center">
          {wrong.length > 0 && (
            <button className="btn btn-primary btn-lg" onClick={() => dispatch({ type: 'start', round: buildRound(wrong), isRetest: true })}>
              <RotateCcw size={18} aria-hidden /> Retest {wrong.length} mistake{wrong.length === 1 ? '' : 's'}
              {wrong.length > 0 && <span className="xp-hint">ace it for +100</span>}
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
  const mult = comboMultiplier(s.combo);
  const lastXp = answered ? xpFor({ type: 'answer', correct, combo: s.combo }) : 0;

  return (
    <div className="quiz">
      <div className="round-head">
        <span className="round-count">
          <strong>{s.index + 1}</strong>
          <span className="muted">/{s.round.length}</span>
          {s.isRetest && <span className="tag">retest</span>}
        </span>
        <div className="segbar" aria-hidden>
          {s.round.map((x, i) => (
            <span
              key={x.id}
              className={x.id in s.answers ? (s.answers[x.id] === x.correctIndex ? 'is-good' : 'is-bad') : i === s.index ? 'is-current' : ''}
            />
          ))}
        </div>
        <div className={`combo ${s.combo >= 3 ? 'is-hot' : ''} ${s.combo === 0 ? 'is-cold' : ''}`} aria-label={`Combo ${s.combo}, multiplier ${mult}`}>
          <Flame size={16} aria-hidden />
          <span>{s.combo}</span>
          {mult > 1 && <span className="combo-mult">{mult}×</span>}
        </div>
      </div>

      <div className={`panel question ${answered ? (correct ? 'is-correct' : 'is-wrong') : ''}`} key={q!.id}>
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
              <button key={i} className={`option ${state}`} disabled={answered} aria-pressed={chosen === i} onClick={() => answer(i)}>
                <span className="option-letter">{LETTERS[i]}</span>
                <span className="option-text">{opt}</span>
                {state === 'is-correct' && <Check className="option-mark" size={20} aria-hidden />}
                {state === 'is-wrong' && <X className="option-mark" size={20} aria-hidden />}
              </button>
            );
          })}
        </div>

        {answered && (
          <div className={`feedback ${correct ? 'feedback-good' : 'feedback-bad'}`} aria-live="polite">
            <div className="feedback-head">
              <strong>{correct ? (s.combo >= 3 ? `On fire! ${s.combo} in a row` : 'Correct!') : `Not quite — it’s ${LETTERS[q!.correctIndex]}.`}</strong>
              <span className="xp-hint">+{lastXp} XP</span>
            </div>
            {q!.explanation && <p>{q!.explanation}</p>}
          </div>
        )}

        <div className="actions end">
          {answered ? (
            <button ref={nextRef} className="btn btn-primary" onClick={next}>
              {s.index + 1 === s.round.length ? 'See results' : 'Next question'} <ArrowRight size={16} aria-hidden /> <kbd>Enter</kbd>
            </button>
          ) : (
            <span className="muted small">
              Press 1–{q!.options.length} · chain correct answers for up to 3× XP
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
