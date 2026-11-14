import { AppError } from '../../shared/errors';
import { normalizeStudySet } from '../../shared/normalize';
import type { GenerateRequest, GenerateResponse } from '../../shared/types';

/** Slightly longer than the server's total budget, so the server's typed TIMEOUT normally wins. */
const CLIENT_TIMEOUT_MS = 55_000;

/**
 * POST /api/generate. Always resolves to a validated GenerateResponse or
 * throws an AppError – never a raw TypeError/SyntaxError – so callers have
 * exactly one error shape to handle.
 */
export async function requestStudySet(req: GenerateRequest, signal: AbortSignal): Promise<GenerateResponse> {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, CLIENT_TIMEOUT_MS);
  const forwardAbort = () => ctrl.abort();
  signal.addEventListener('abort', forwardAbort, { once: true });

  try {
    let res: Response;
    let body: unknown;
    try {
      res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
        signal: ctrl.signal,
      });
      // Non-JSON bodies (e.g. a platform's HTML 504 page) become null, not a crash.
      body = await res.json().catch(() => null);
    } catch {
      if (signal.aborted) throw new AppError('ABORTED', 'Cancelled.');
      if (timedOut) throw new AppError('TIMEOUT', 'The request took too long. The AI may be overloaded.');
      throw new AppError('NETWORK', 'Couldn’t reach the server. Check your connection and try again.');
    }

    if (!res.ok) {
      if (AppError.isErrorBody(body)) throw AppError.fromBody(body);
      if (res.status === 504) throw new AppError('TIMEOUT', 'The server timed out waiting for the AI.');
      throw new AppError('UPSTREAM', `The server returned an unexpected error (HTTP ${res.status}).`);
    }

    // Re-validate at the network boundary: keeps UI invariants local to the
    // client and protects against a proxy/CDN or older server returning junk.
    const data = (body ?? {}) as Partial<GenerateResponse>;
    const { set } = normalizeStudySet(data.set, { mode: 'both' });
    return {
      set,
      warnings: Array.isArray(data.warnings) ? data.warnings.filter((w): w is string => typeof w === 'string') : [],
      meta: data.meta ?? { model: 'unknown', attempts: 1, ms: 0, repaired: false },
    };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', forwardAbort);
  }
}
