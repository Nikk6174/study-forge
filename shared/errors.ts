/**
 * One error vocabulary for server and client. The server serialises
 * AppError to `{ error: { code, message, retryable } }`; the client turns
 * that (or a network failure) back into an AppError. The UI only ever
 * branches on `code` and `retryable`, never on message text.
 */

export type ErrorCode =
  | 'INVALID_INPUT' // user input failed validation (fix input, don't retry)
  | 'TIMEOUT' // model took too long
  | 'RATE_LIMITED' // provider quota / 429
  | 'UPSTREAM' // provider 5xx or unexpected response
  | 'BAD_OUTPUT' // model replied, but not with usable JSON of the right shape
  | 'EMPTY_OUTPUT' // valid shape, nothing usable in it
  | 'BLOCKED' // safety filter refused
  | 'CONFIG' // server misconfigured (missing / rejected API key)
  | 'NETWORK' // client could not reach our server
  | 'ABORTED'; // superseded or cancelled – never shown as an error

export interface ErrorBody {
  error: { code: ErrorCode; message: string; retryable: boolean };
}

const DEFAULT_RETRYABLE: Record<ErrorCode, boolean> = {
  INVALID_INPUT: false,
  TIMEOUT: true,
  RATE_LIMITED: true,
  UPSTREAM: true,
  BAD_OUTPUT: true,
  EMPTY_OUTPUT: false,
  BLOCKED: false,
  CONFIG: false,
  NETWORK: true,
  ABORTED: false,
};

const HTTP_STATUS: Record<ErrorCode, number> = {
  INVALID_INPUT: 400,
  TIMEOUT: 504,
  RATE_LIMITED: 429,
  UPSTREAM: 502,
  BAD_OUTPUT: 502,
  EMPTY_OUTPUT: 422,
  BLOCKED: 422,
  CONFIG: 500,
  NETWORK: 503,
  ABORTED: 499,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message: string, retryable = DEFAULT_RETRYABLE[code]) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.retryable = retryable;
  }

  get status(): number {
    return HTTP_STATUS[this.code];
  }

  toBody(): ErrorBody {
    return { error: { code: this.code, message: this.message, retryable: this.retryable } };
  }

  static isErrorBody(value: unknown): value is ErrorBody {
    if (!value || typeof value !== 'object') return false;
    const e = (value as { error?: unknown }).error;
    return (
      !!e &&
      typeof e === 'object' &&
      typeof (e as { code?: unknown }).code === 'string' &&
      (e as { code: string }).code in DEFAULT_RETRYABLE &&
      typeof (e as { message?: unknown }).message === 'string'
    );
  }

  static fromBody(body: ErrorBody): AppError {
    const { code, message, retryable } = body.error;
    return new AppError(code, message, typeof retryable === 'boolean' ? retryable : undefined);
  }
}
