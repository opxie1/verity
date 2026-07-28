import { ERROR_MESSAGES, type ErrorCode } from '@verity/schemas';

/**
 * The only error type domain services throw. Route handlers translate it into
 * the wire format from PRD section 24; nothing else about the failure — no
 * stack, no payload contents — reaches the client.
 */
export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly fieldErrors: Record<string, string[]> | undefined;
  /** Detail for server logs only. Never serialized to a response. */
  readonly internalDetail: string | undefined;

  constructor(
    code: ErrorCode,
    options: {
      message?: string;
      fieldErrors?: Record<string, string[]>;
      internalDetail?: string;
      cause?: unknown;
    } = {},
  ) {
    super(options.message ?? ERROR_MESSAGES[code], { cause: options.cause });
    this.name = 'DomainError';
    this.code = code;
    this.fieldErrors = options.fieldErrors;
    this.internalDetail = options.internalDetail;
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
