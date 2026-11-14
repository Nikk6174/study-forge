import { ArrowLeft, BrainCircuit, FileText, GitBranch, Layers, Undo2 } from 'lucide-react';
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
  /** Leave the set and return to the dashboard. */
  onHome: () => void;
}

export function StudySetView({ session, children, footer, refining, onUndo, onHome }: Props) {
  const version = session.versions[session.versions.length - 1]!;
  const { set } = version;
  const hasCards = set.flashcards.length > 0;
  const hasQuiz = set.questions.length > 0;
  const [tab, setTab] = useState<Tab>(hasCards ? 'cards' : 'quiz');
  // A refinement can remove a whole list; fall back to whichever exists.
  const active: Tab = tab === 'cards' ? (hasCards ? 'cards' : 'quiz') : hasQuiz ? 'quiz' : 'cards';

  return (
    <section className="study" aria-busy={refining}>
      <nav className="crumbs" aria-label="Breadcrumb">
        <button className="crumb-back" onClick={onHome}>
          <ArrowLeft size={16} aria-hidden /> Home
        </button>
        <span className="crumb-sep" aria-hidden>
          /
        </span>
        <span className="crumb-current" aria-current="page">
          {set.title}
        </span>
      </nav>
      <header className="study-head">
        <div className="study-title">
          <div className="eyebrow">Study set</div>
          <h2>{set.title}</h2>
          <div className="meta-chips">
            <span className="meta-chip">
              <Layers size={13} aria-hidden /> {set.flashcards.length} cards
            </span>
            <span className="meta-chip">
              <BrainCircuit size={13} aria-hidden /> {set.questions.length} questions
            </span>
            {session.input.attachmentName && (
              <span className="meta-chip" title={session.input.attachmentName}>
                <FileText size={13} aria-hidden /> {session.input.attachmentName}
              </span>
            )}
            {session.versions.length > 1 && (
              <span className="meta-chip meta-chip-accent" title={version.instruction}>
                <GitBranch size={13} aria-hidden /> v{session.versions.length}
                {version.instruction && <> · {version.instruction}</>}
              </span>
            )}
          </div>
        </div>
        {session.versions.length > 1 && (
          <button className="btn btn-ghost btn-small" onClick={onUndo} disabled={refining}>
            <Undo2 size={14} aria-hidden /> Undo
          </button>
        )}
      </header>

      {children}

      {hasCards && hasQuiz && (
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={active === 'cards'} onClick={() => setTab('cards')}>
            <Layers size={16} aria-hidden /> Flashcards <span className="tab-count">{set.flashcards.length}</span>
          </button>
          <button role="tab" aria-selected={active === 'quiz'} onClick={() => setTab('quiz')}>
            <BrainCircuit size={16} aria-hidden /> Quiz <span className="tab-count">{set.questions.length}</span>
          </button>
        </div>
      )}

      {/* Both views stay mounted so switching tabs keeps progress; only the
          visible one listens to the keyboard. key = version id: a new
          version (refinement) starts fresh. */}
      <div className={`study-body ${refining ? 'is-refining' : ''}`}>
        {hasCards && (
          <div role="tabpanel" hidden={active !== 'cards'}>
            <FlashcardDeck key={version.id} cards={set.flashcards} active={active === 'cards'} onHome={onHome} />
          </div>
        )}
        {hasQuiz && (
          <div role="tabpanel" hidden={active !== 'quiz'}>
            <Quiz key={version.id} questions={set.questions} active={active === 'quiz'} onHome={onHome} />
          </div>
        )}
      </div>

      {footer}
    </section>
  );
}
