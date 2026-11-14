import { ArrowLeft, ArrowRight, Check, RotateCcw, Shuffle, Sparkles, X } from 'lucide-react';
import { useReducer, useRef } from 'react';
import type { Flashcard } from '../../shared/types';
import { xpFor } from '../game/engine';
import { useGame } from '../game/GameContext';
import { useHotkeys } from '../hooks/useHotkeys';
import { shuffle } from '../lib/study';
import { Ring } from './game/GameUI';

type Mark = 'known' | 'again';

interface DeckState {
  /** Card ids in the current round. A "review missed" round is a subset. */
  queue: string[];
  pos: number;
  flipped: boolean;
  marks: Record<string, Mark>;
  round: number;
}

type DeckAction =
  | { type: 'flip' }
  | { type: 'go'; delta: 1 | -1 }
  | { type: 'mark'; mark: Mark }
  | { type: 'newRound'; queue: string[] };

function deckReducer(s: DeckState, a: DeckAction): DeckState {
  switch (a.type) {
    case 'flip':
      return s.pos < s.queue.length ? { ...s, flipped: !s.flipped } : s;
    case 'go': {
      const pos = Math.min(Math.max(s.pos + a.delta, 0), s.queue.length);
      return pos === s.pos ? s : { ...s, pos, flipped: false };
    }
    case 'mark': {
      const id = s.queue[s.pos];
      if (!id) return s;
      return { ...s, marks: { ...s.marks, [id]: a.mark }, pos: s.pos + 1, flipped: false };
    }
    case 'newRound':
      return { queue: a.queue, pos: 0, flipped: false, marks: {}, round: s.round + 1 };
  }
}

export function FlashcardDeck({ cards, active = true }: { cards: Flashcard[]; active?: boolean }) {
  const game = useGame();
  const [s, dispatch] = useReducer(deckReducer, cards, (c): DeckState => ({
    queue: c.map((x) => x.id),
    pos: 0,
    flipped: false,
    marks: {},
    round: 1,
  }));
  const byId = new Map(cards.map((c) => [c.id, c]));
  const done = s.pos >= s.queue.length;
  const card = done ? null : byId.get(s.queue[s.pos]!);
  const missed = s.queue.filter((id) => s.marks[id] === 'again');
  const known = s.queue.filter((id) => s.marks[id] === 'known').length;

  /** Marking = reducer update + game event. XP only for a card's first mark per round (no farming via ←). */
  const mark = (m: Mark) => {
    const id = s.queue[s.pos];
    if (!id) return;
    dispatch({ type: 'mark', mark: m });
    if (!(id in s.marks)) game.record({ type: 'card_marked', known: m === 'known' });
    if (s.pos + 1 === s.queue.length) {
      const marks = { ...s.marks, [id]: m };
      const k = s.queue.filter((x) => marks[x] === 'known').length;
      game.record({ type: 'deck_completed', known: k, total: s.queue.length });
      if (k === s.queue.length) game.celebrate();
    }
  };

  useHotkeys((e) => {
    if (done) return;
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'enter') dispatch({ type: 'flip' });
    else if (k === 'arrowright') dispatch({ type: 'go', delta: 1 });
    else if (k === 'arrowleft') dispatch({ type: 'go', delta: -1 });
    else if (s.flipped && (k === '1' || k === 'j')) mark('again');
    else if (s.flipped && (k === '2' || k === 'k')) mark('known');
    else return;
    e.preventDefault();
  }, active);

  // Swipe to navigate on touch; tap flips. Mouse hover tilts the card.
  const touchX = useRef<number | null>(null);
  const tiltEl = useRef<HTMLButtonElement>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    touchX.current = e.clientX;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const start = touchX.current;
    touchX.current = null;
    if (start === null) return;
    const dx = e.clientX - start;
    if (Math.abs(dx) > 60) dispatch({ type: 'go', delta: dx < 0 ? 1 : -1 });
    else dispatch({ type: 'flip' });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse' || !tiltEl.current) return;
    const r = tiltEl.current.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    tiltEl.current.style.setProperty('--tx', `${(-y * 8).toFixed(2)}deg`);
    tiltEl.current.style.setProperty('--ty', `${(x * 10).toFixed(2)}deg`);
    tiltEl.current.style.setProperty('--gx', `${((x + 0.5) * 100).toFixed(1)}%`);
    tiltEl.current.style.setProperty('--gy', `${((y + 0.5) * 100).toFixed(1)}%`);
  };
  const onPointerLeave = () => {
    tiltEl.current?.style.setProperty('--tx', '0deg');
    tiltEl.current?.style.setProperty('--ty', '0deg');
  };

  if (done) {
    const total = s.queue.length;
    const pct = total ? known / total : 0;
    const perfect = known === total;
    return (
      <div className="panel summary" role="status">
        <Ring value={pct} size={128} stroke={10}>
          <span className="ring-big">{Math.round(pct * 100)}%</span>
          <span className="ring-small">mastered</span>
        </Ring>
        <h3>{perfect ? 'Deck mastered!' : s.round > 1 ? `Review round ${s.round} done` : 'Deck complete'}</h3>
        <div className="score-row">
          <span className="pill pill-good">
            <Check size={14} aria-hidden /> {known} got it
          </span>
          <span className="pill pill-bad">
            <X size={14} aria-hidden /> {missed.length} still learning
          </span>
          <span className="pill pill-gold">
            <Sparkles size={14} aria-hidden /> +{xpFor({ type: 'deck_completed', known, total })} XP bonus
          </span>
        </div>
        <div className="actions center">
          {missed.length > 0 && (
            <button className="btn btn-primary btn-lg" onClick={() => dispatch({ type: 'newRound', queue: shuffle(missed) })}>
              <RotateCcw size={18} aria-hidden /> Review {missed.length} missed
            </button>
          )}
          <button className="btn" onClick={() => dispatch({ type: 'newRound', queue: cards.map((c) => c.id) })}>
            Restart deck
          </button>
          <button className="btn" onClick={() => dispatch({ type: 'newRound', queue: shuffle(cards.map((c) => c.id)) })}>
            <Shuffle size={16} aria-hidden /> Shuffle
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="deck">
      <div className="round-head">
        <span className="round-count">
          <strong>{s.pos + 1}</strong>
          <span className="muted">/{s.queue.length}</span>
          {s.round > 1 && <span className="tag">review</span>}
        </span>
        <div className="segbar" aria-hidden>
          {s.queue.map((id, i) => (
            <span key={id} className={s.marks[id] === 'known' ? 'is-good' : s.marks[id] === 'again' ? 'is-bad' : i === s.pos ? 'is-current' : ''} />
          ))}
        </div>
      </div>

      <div className="card-stage">
        <span className="card-shadow" aria-hidden />
        <span className="card-shadow card-shadow-2" aria-hidden />
        <button
          ref={tiltEl}
          type="button"
          className={`card ${s.flipped ? 'is-flipped' : ''}`}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerMove={onPointerMove}
          onPointerLeave={onPointerLeave}
          // Keyboard activation arrives as a click with detail 0; pointer taps are handled above.
          onClick={(e) => e.detail === 0 && dispatch({ type: 'flip' })}
          aria-label={s.flipped ? `Answer: ${card!.back}. Activate to show question.` : `Question: ${card!.front}. Activate to reveal answer.`}
        >
          <span className="card-inner">
            <span className="card-face card-front">
              <span className="card-label">Question</span>
              <span className="card-text">{card!.front}</span>
              {card!.hint && <span className="card-hint">Hint: {card!.hint}</span>}
              <span className="card-cta">Tap or press Space to flip</span>
            </span>
            <span className="card-face card-back">
              <span className="card-label">Answer</span>
              <span className="card-text">{card!.back}</span>
            </span>
          </span>
        </button>
      </div>

      <div className="deck-controls">
        <button className="btn btn-icon" onClick={() => dispatch({ type: 'go', delta: -1 })} disabled={s.pos === 0} aria-label="Previous card">
          <ArrowLeft size={18} />
        </button>
        {s.flipped ? (
          <>
            <button className="btn btn-bad" onClick={() => mark('again')}>
              <X size={18} aria-hidden /> Still learning <kbd>1</kbd>
            </button>
            <button className="btn btn-good" onClick={() => mark('known')}>
              <Check size={18} aria-hidden /> Got it <span className="xp-hint">+5</span> <kbd>2</kbd>
            </button>
          </>
        ) : (
          <button className="btn btn-primary" onClick={() => dispatch({ type: 'flip' })}>
            Reveal answer <kbd>Space</kbd>
          </button>
        )}
        <button className="btn btn-icon" onClick={() => dispatch({ type: 'go', delta: 1 })} aria-label="Next card">
          <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
}
