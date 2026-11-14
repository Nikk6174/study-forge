import { useReducer, useRef } from 'react';
import type { Flashcard } from '../../shared/types';
import { useHotkeys } from '../hooks/useHotkeys';
import { shuffle } from '../lib/study';

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

export function FlashcardDeck({ cards }: { cards: Flashcard[] }) {
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

  useHotkeys((e) => {
    if (done) return;
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'enter') dispatch({ type: 'flip' });
    else if (k === 'arrowright') dispatch({ type: 'go', delta: 1 });
    else if (k === 'arrowleft') dispatch({ type: 'go', delta: -1 });
    else if (s.flipped && (k === '1' || k === 'j')) dispatch({ type: 'mark', mark: 'again' });
    else if (s.flipped && (k === '2' || k === 'k')) dispatch({ type: 'mark', mark: 'known' });
    else return;
    e.preventDefault();
  });

  // Horizontal swipe to navigate on touch screens; a tap still flips.
  const touchX = useRef<number | null>(null);
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

  if (done) {
    return (
      <div className="panel round-summary" role="status">
        <h3>{s.round > 1 ? `Review round ${s.round} complete` : 'Deck complete'}</h3>
        <div className="score-row">
          <span className="pill pill-good">{known} got it</span>
          <span className="pill pill-bad">{missed.length} still learning</span>
          {s.queue.length - known - missed.length > 0 && (
            <span className="pill">{s.queue.length - known - missed.length} skipped</span>
          )}
        </div>
        <div className="actions">
          {missed.length > 0 && (
            <button className="btn btn-primary" onClick={() => dispatch({ type: 'newRound', queue: shuffle(missed) })}>
              Review {missed.length} missed card{missed.length === 1 ? '' : 's'}
            </button>
          )}
          <button className="btn" onClick={() => dispatch({ type: 'newRound', queue: cards.map((c) => c.id) })}>
            Restart deck
          </button>
          <button className="btn" onClick={() => dispatch({ type: 'newRound', queue: shuffle(cards.map((c) => c.id)) })}>
            Shuffle &amp; restart
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="deck">
      <div className="progress" aria-hidden>
        <div className="progress-bar" style={{ width: `${(s.pos / s.queue.length) * 100}%` }} />
      </div>
      <div className="deck-meta">
        <span>
          Card {s.pos + 1} of {s.queue.length}
          {s.round > 1 && ' · review'}
        </span>
        <span className="muted">
          {known} known · {missed.length} learning
        </span>
      </div>

      <button
        type="button"
        className={`card ${s.flipped ? 'is-flipped' : ''}`}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        // Keyboard activation (Space/Enter while focused) arrives as a click with detail 0;
        // pointer taps are handled above so they can be told apart from swipes.
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

      <div className="deck-controls">
        <button className="btn btn-icon" onClick={() => dispatch({ type: 'go', delta: -1 })} disabled={s.pos === 0} aria-label="Previous card">
          ←
        </button>
        {s.flipped ? (
          <>
            <button className="btn btn-bad" onClick={() => dispatch({ type: 'mark', mark: 'again' })}>
              Still learning <kbd>1</kbd>
            </button>
            <button className="btn btn-good" onClick={() => dispatch({ type: 'mark', mark: 'known' })}>
              Got it <kbd>2</kbd>
            </button>
          </>
        ) : (
          <button className="btn btn-primary" onClick={() => dispatch({ type: 'flip' })}>
            Show answer <kbd>Space</kbd>
          </button>
        )}
        <button className="btn btn-icon" onClick={() => dispatch({ type: 'go', delta: 1 })} aria-label="Next card">
          →
        </button>
      </div>
    </div>
  );
}
