import { AlertTriangle, Info, RefreshCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AppError, ErrorCode } from '../../shared/errors';

const SLOW_AFTER_S = 10;

const STEPS = ['Reading your material…', 'Pulling out key ideas…', 'Writing flashcards…', 'Crafting tricky distractors…', 'Polishing explanations…'];

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
  const step = STEPS[Math.min(Math.floor(elapsed / 2), STEPS.length - 1)]!;
  return (
    <div className="panel forge" role="status" aria-live="polite">
      <div className="forge-cards" aria-hidden>
        <span />
        <span />
        <span />
      </div>
      <div className="forge-copy">
        <div className="eyebrow">Forging your set · {elapsed}s</div>
        <h3>{slow ? 'The AI is slower than usual…' : step}</h3>
        <p className="muted small">
          {slow ? 'Hang tight — we’ll retry or switch models automatically if it stalls.' : 'Usually takes 3–8 seconds.'}
        </p>
        <div className="forge-bar" aria-hidden>
          <span />
        </div>
      </div>
      <button className="btn btn-ghost" onClick={onCancel}>
        Cancel
      </button>
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
      <div className="error-icon" aria-hidden>
        <AlertTriangle size={compact ? 18 : 22} />
      </div>
      <div className="error-body">
        <strong>{TITLES[error.code]}</strong>
        <p>{error.message}</p>
        {HINTS[error.code] && <p className="muted small">{HINTS[error.code]}</p>}
        <div className="actions">
          {error.retryable && (
            <button className="btn btn-primary" onClick={onRetry}>
              <RefreshCw size={16} aria-hidden /> Retry
            </button>
          )}
          <button className="btn btn-ghost" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

export function Warnings({ warnings, onDismiss }: { warnings: string[]; onDismiss: () => void }) {
  if (!warnings.length) return null;
  return (
    <div className="warnings" role="status">
      <Info size={16} aria-hidden />
      <ul>
        {warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
      <button className="btn btn-ghost btn-small" onClick={onDismiss} aria-label="Dismiss notes">
        <X size={14} />
      </button>
    </div>
  );
}
