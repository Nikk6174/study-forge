import { useState } from 'react';
import type { Session } from '../hooks/useSessions';
import { FlashcardDeck } from './FlashcardDeck';
import { Quiz } from './Quiz';

type Tab = 'cards' | 'quiz';

interface Props {
  session: Session;
  /** Rendered between the header and the study area (refine bar, status). */
  children?: React.ReactNode;
  refining: boolean;
  onUndo: () => void;
}

export function StudySetView({ session, children, refining, onUndo }: Props) {
  const version = session.versions[session.versions.length - 1]!;
  const { set } = version;
  const hasCards = set.flashcards.length > 0;
  const hasQuiz = set.questions.length > 0;
  const [tab, setTab] = useState<Tab>(hasCards ? 'cards' : 'quiz');
  // A refinement can remove a whole list; fall back to whichever exists.
  const active: Tab = tab === 'cards' ? (hasCards ? 'cards' : 'quiz') : hasQuiz ? 'quiz' : 'cards';

  return (
    <section className="study" aria-busy={refining}>
      <header className="study-head">
        <div>
          <h2>{set.title}</h2>
          <p className="muted small">
            {set.flashcards.length} cards · {set.questions.length} questions
            {session.versions.length > 1 && <> · version {session.versions.length}</>}
            {version.instruction && <> · “{version.instruction}”</>}
          </p>
        </div>
        {session.versions.length > 1 && (
          <button className="btn btn-ghost btn-small" onClick={onUndo} disabled={refining}>
            Undo refine
          </button>
        )}
      </header>

      {children}

      {hasCards && hasQuiz && (
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={active === 'cards'} onClick={() => setTab('cards')}>
            Flashcards <span className="tab-count">{set.flashcards.length}</span>
          </button>
          <button role="tab" aria-selected={active === 'quiz'} onClick={() => setTab('quiz')}>
            Quiz <span className="tab-count">{set.questions.length}</span>
          </button>
        </div>
      )}

      {/* key = version id: a new version resets study progress for that view. */}
      <div className={`study-body ${refining ? 'is-refining' : ''}`} role="tabpanel">
        {active === 'cards' ? (
          <FlashcardDeck key={version.id} cards={set.flashcards} />
        ) : (
          <Quiz key={version.id} questions={set.questions} />
        )}
      </div>
    </section>
  );
}
