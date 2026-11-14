import { useCallback, useEffect, useReducer, useRef } from 'react';
import { AppError } from '../../shared/errors';
import type { GenerateRequest, GenerateResponse } from '../../shared/types';
import { requestStudySet } from '../lib/api';

export type RequestKind = 'generate' | 'refine';

export type GenerationState =
  | { status: 'idle' }
  | { status: 'loading'; kind: RequestKind; startedAt: number }
  | { status: 'error'; kind: RequestKind; error: AppError };

type Action =
  | { type: 'start'; kind: RequestKind }
  | { type: 'fail'; kind: RequestKind; error: AppError }
  | { type: 'reset' };

function reducer(_state: GenerationState, action: Action): GenerationState {
  switch (action.type) {
    case 'start':
      return { status: 'loading', kind: action.kind, startedAt: Date.now() };
    case 'fail':
      return { status: 'error', kind: action.kind, error: action.error };
    case 'reset':
      return { status: 'idle' };
  }
}

interface PendingRequest {
  req: GenerateRequest;
  kind: RequestKind;
  onSuccess: (res: GenerateResponse) => void;
}

/**
 * Owns the lifecycle of AI requests. Guarantees:
 *  - Only the latest request can update state. A newer request aborts the
 *    previous one (which also cancels the upstream model call server-side),
 *    and a sequence number guards against any response that still arrives.
 *  - Cancel and unmount abort in-flight work.
 *  - The last request is remembered so errors can offer "Retry".
 */
export function useGeneration() {
  const [state, dispatch] = useReducer(reducer, { status: 'idle' } as GenerationState);
  const seq = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const last = useRef<PendingRequest | null>(null);

  const execute = useCallback(async (pending: PendingRequest) => {
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    const id = ++seq.current;
    last.current = pending;
    dispatch({ type: 'start', kind: pending.kind });

    try {
      const res = await requestStudySet(pending.req, ctrl.signal);
      if (id !== seq.current) return; // a newer request owns the UI now
      dispatch({ type: 'reset' });
      pending.onSuccess(res);
    } catch (e) {
      if (id !== seq.current) return;
      const error = e instanceof AppError ? e : new AppError('UPSTREAM', 'Something went wrong. Please try again.');
      if (error.code === 'ABORTED') return;
      dispatch({ type: 'fail', kind: pending.kind, error });
    } finally {
      if (controller.current === ctrl) controller.current = null;
    }
  }, []);

  const run = useCallback(
    (req: GenerateRequest, kind: RequestKind, onSuccess: (res: GenerateResponse) => void) =>
      execute({ req, kind, onSuccess }),
    [execute],
  );

  const retry = useCallback(() => {
    if (last.current) void execute(last.current);
  }, [execute]);

  const cancel = useCallback(() => {
    seq.current++;
    controller.current?.abort();
    controller.current = null;
    dispatch({ type: 'reset' });
  }, []);

  const dismiss = useCallback(() => dispatch({ type: 'reset' }), []);

  useEffect(() => () => controller.current?.abort(), []);

  return { state, run, retry, cancel, dismiss };
}
