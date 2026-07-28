'use client';

import type { ApiError } from '@verity/schemas';

export class ApiRequestError extends Error {
  readonly code: string;
  readonly correlationId: string;
  readonly fieldErrors: Record<string, string[]>;

  constructor(error: ApiError['error']) {
    super(error.message);
    this.name = 'ApiRequestError';
    this.code = error.code;
    this.correlationId = error.correlationId;
    this.fieldErrors = error.fieldErrors ?? {};
  }
}

/**
 * Calls the Verity API from the browser.
 *
 * Responses are the source of truth for what happened; nothing here caches or
 * infers state. On failure it throws `ApiRequestError` carrying the code and
 * the correlation ID so the interface can show a message the user can quote to
 * support.
 */
export async function apiFetch<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(path, {
    method: init.method ?? 'GET',
    headers: init.body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    credentials: 'same-origin',
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const parsed = payload as ApiError | null;
    if (parsed?.error) {
      throw new ApiRequestError(parsed.error);
    }
    throw new ApiRequestError({
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Try again.',
      correlationId: response.headers.get('x-correlation-id') ?? 'unknown',
    });
  }

  return payload as T;
}
