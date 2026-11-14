import { FileText, Trash2 } from 'lucide-react';
import type { Session } from '../hooks/useSessions';

const fmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

interface Props {
  sessions: Session[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}

export function SessionList({ sessions, activeId, onSelect, onRemove }: Props) {
  if (!sessions.length) return null;
  return (
    <nav className="panel sessions" aria-label="Saved study sets">
      <h3 className="label">Your library</h3>
      <ul>
        {sessions.map((s) => {
          const set = s.versions[s.versions.length - 1]!.set;
          return (
            <li key={s.id} className={s.id === activeId ? 'is-active' : ''}>
              <button className="session-open" onClick={() => onSelect(s.id)} aria-current={s.id === activeId}>
                <span className="session-title">
                  {s.input.attachmentName && <FileText size={13} aria-hidden />} {set.title}
                </span>
                <span className="muted small">
                  {fmt.format(s.updatedAt)} · {set.flashcards.length + set.questions.length} items
                </span>
              </button>
              <button className="btn btn-ghost btn-small" onClick={() => onRemove(s.id)} aria-label={`Delete ${set.title}`}>
                <Trash2 size={14} />
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
