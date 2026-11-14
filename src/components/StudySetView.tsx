import { useState } from 'react';
import type { Session } from '../hooks/useSessions';
import { FlashcardDeck } from './FlashcardDeck';
import { Quiz } from './Quiz';

type Tab = 'cards' | 'quiz';

interface Props {
  session: Session;
  /** Rendered between the header and the study area (warnings, refine status). */
  children?: React.ReactNode;
  /** Rendered below the study area – refining is secondary to studying. */
  footer?: React.ReactNode;
  refining: boolean;
  onUndo: () => void;
}

export function StudySetView({ session, children, footer, refining, onUndo }: Props) {
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

      {/* Both views stay mounted so switching tabs keeps progress; only the
          visible one listens to the keyboard. key = version id: a new
          version (refinement) starts fresh. */}
      <div className={`study-body ${refining ? 'is-refining' : ''}`}>
        {hasCards && (
          <div role="tabpanel" hidden={active !== 'cards'}>
            <FlashcardDeck key={version.id} cards={set.flashcards} active={active === 'cards'} />
          </div>
        )}
        {hasQuiz && (
          <div role="tabpanel" hidden={active !== 'quiz'}>
            <Quiz key={version.id} questions={set.questions} active={active === 'quiz'} />
          </div>
        )}
      </div>

      {footer}
    </section>
  );
}
