import { useEffect, useState } from 'react';
import type { AppError, ErrorCode } from '../../shared/errors';

const SLOW_AFTER_S = 10;

function useElapsedSeconds(since: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  return Math.max(0, Math.floor((now - since) / 1000));
}

export function LoadingState({ startedAt, onCancel }: { startedAt: number; onCancel: () => void }) {
  const elapsed = useElapsedSeconds(startedAt);
  const slow = elapsed >= SLOW_AFTER_S;
  return (
    <div className="panel loading" role="status" aria-live="polite">
      <div className="loading-head">
        <span className="spinner" aria-hidden />
        <div>
          <strong>{slow ? 'Still working — the AI is slower than usual' : 'Generating your study set…'}</strong>
          <p className="muted small">
            {elapsed}s{slow ? ' · we’ll retry or switch models automatically if it stalls' : ''}
          </p>
        </div>
        <button className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <div className="skeleton-card" aria-hidden />
      <div className="skeleton-row" aria-hidden>
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

const TITLES: Record<ErrorCode, string> = {
  INVALID_INPUT: 'Check your input',
  TIMEOUT: 'The AI took too long',
  RATE_LIMITED: 'Too many requests right now',
  UPSTREAM: 'The AI service had a problem',
  BAD_OUTPUT: 'The AI’s answer didn’t make sense',
  EMPTY_OUTPUT: 'Nothing to study here',
  BLOCKED: 'This input was declined',
  CONFIG: 'The server isn’t set up correctly',
  NETWORK: 'Can’t reach the server',
  ABORTED: 'Cancelled',
};

const HINTS: Partial<Record<ErrorCode, string>> = {
  BAD_OUTPUT: 'We tried to repair it automatically but couldn’t. Retrying usually works.',
  EMPTY_OUTPUT: 'Try a more specific topic or paste more detailed notes.',
  RATE_LIMITED: 'Wait a few seconds, then retry.',
};

export function ErrorState({
  error,
  onRetry,
  onDismiss,
  compact = false,
}: {
  error: AppError;
  onRetry: () => void;
  onDismiss: () => void;
  compact?: boolean;
}) {
  return (
    <div className={`panel error ${compact ? 'error-compact' : ''}`} role="alert">
      <div>
        <strong>{TITLES[error.code]}</strong>
        <p>{error.message}</p>
        {HINTS[error.code] && <p className="muted small">{HINTS[error.code]}</p>}
      </div>
      <div className="actions">
        {error.retryable && (
          <button className="btn btn-primary" onClick={onRetry}>
            Retry
          </button>
        )}
        <button className="btn btn-ghost" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

export function Warnings({ warnings, onDismiss }: { warnings: string[]; onDismiss: () => void }) {
  if (!warnings.length) return null;
  return (
    <div className="warnings" role="status">
      <ul>
        {warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
      <button className="btn btn-ghost btn-small" onClick={onDismiss} aria-label="Dismiss notes">
        ✕
      </button>
    </div>
  );
}

export function EmptyState() {
  return (
    <div className="panel empty">
      <h2>Turn notes into practice</h2>
      <ol className="steps">
        <li>
          <strong>Paste</strong> lecture notes, an article, or just name a topic.
        </li>
        <li>
          <strong>Study</strong> with flip cards and a multiple-choice quiz.
        </li>
        <li>
          <strong>Retest</strong> only what you got wrong, and refine the set with follow-ups like “make it harder”.
        </li>
      </ol>
      <p className="muted small">Sets are saved in this browser so you can come back to them.</p>
    </div>
  );
}
