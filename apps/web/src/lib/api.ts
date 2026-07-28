import 'server-only';
import { DomainError, generateCorrelationId, hashIpAddress, type RequestContext } from '@verity/domain';
import { ERROR_MESSAGES, ERROR_STATUS, type ErrorCode } from '@verity/schemas';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { expectedOrigins, extensionOrigins, isProduction, serverEnv } from './env';

/**
 * Cross-origin headers for the Gmail extension.
 *
 * `Access-Control-Allow-Origin` is echoed only for an origin already on the
 * allow-list, never reflected blindly, and credentials are only permitted for
 * those origins. Without this the browser refuses the request; with a wildcard
 * it would be refused anyway, since credentialed requests forbid `*`.
 */
export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin');
  if (!origin || !extensionOrigins.includes(origin)) {
    return {};
  }
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

/** Preflight handler shared by every `/api/extension/*` route. */
export function corsPreflight(request: Request): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

/** Builds the per-request context that ends up on audit records. */
export function buildRequestContext(request: Request): RequestContext {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip');
  return {
    correlationId: generateCorrelationId(),
    ipHash: hashIpAddress(ip, serverEnv.AUTH_SECRET),
    userAgent: request.headers.get('user-agent'),
  };
}

export function errorResponse(
  code: ErrorCode,
  correlationId: string,
  options: { message?: string; fieldErrors?: Record<string, string[]> } = {},
): NextResponse {
  return NextResponse.json(
    {
      error: {
        code,
        message: options.message ?? ERROR_MESSAGES[code],
        correlationId,
        ...(options.fieldErrors ? { fieldErrors: options.fieldErrors } : {}),
      },
    },
    { status: ERROR_STATUS[code], headers: { 'x-correlation-id': correlationId } },
  );
}

/**
 * `Date` becomes an ISO string and `BigInt` a decimal string, so responses stay
 * valid JSON without callers having to remember which fields are which.
 */
function jsonSafe(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, jsonSafe(item)]),
    );
  }
  return value;
}

export function okResponse(data: unknown, correlationId: string, status = 200): NextResponse {
  return NextResponse.json(jsonSafe(data), {
    status,
    headers: { 'x-correlation-id': correlationId },
  });
}

/**
 * Rejects state-changing requests that did not originate from an allowed
 * origin.
 *
 * `SameSite=Lax` on the session cookie already stops a cross-site form post
 * from carrying credentials; this is the second layer, and it is what will let
 * the Gmail extension's `chrome-extension://` origin be allow-listed
 * explicitly rather than by accident.
 */
export function assertAllowedOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (!origin) {
    // Same-origin navigations and server-to-server calls may omit Origin.
    // Those cannot be initiated cross-site by a browser.
    return;
  }
  const allowed = [serverEnv.NEXT_PUBLIC_APP_URL, ...expectedOrigins, ...extensionOrigins];
  if (!allowed.includes(origin)) {
    throw new DomainError('UNAUTHORIZED', {
      message: 'This request came from an origin that is not allowed.',
      internalDetail: `rejected origin ${origin}`,
    });
  }
}

/** Parses and validates a JSON body, throwing `VALIDATION_FAILED` on mismatch. */
export async function parseJsonBody<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new DomainError('VALIDATION_FAILED', { message: 'Expected a JSON request body.' });
  }
  return parseOrThrow(schema, raw);
}

export function parseOrThrow<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new DomainError('VALIDATION_FAILED', {
      fieldErrors: result.error.flatten().fieldErrors as Record<string, string[]>,
    });
  }
  return result.data;
}

/**
 * Wraps a route handler so that every failure leaves by the same door: a
 * structured error with a correlation ID, and nothing about the internals.
 */
export function routeHandler<Args extends unknown[]>(
  handler: (request: Request, ctx: RequestContext, ...args: Args) => Promise<NextResponse>,
) {
  return async (request: Request, ...args: Args): Promise<NextResponse> => {
    const ctx = buildRequestContext(request);
    try {
      return await handler(request, ctx, ...args);
    } catch (error) {
      if (error instanceof DomainError) {
        if (error.internalDetail) {
          console.warn(
            `[verity] ${ctx.correlationId} ${error.code}: ${error.internalDetail}`,
          );
        }
        return errorResponse(error.code, ctx.correlationId, {
          message: error.message,
          ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
        });
      }

      if (error instanceof z.ZodError) {
        return errorResponse('VALIDATION_FAILED', ctx.correlationId, {
          fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
        });
      }

      // Unexpected. Log with the correlation ID so the user can quote it, but
      // never return the message or stack.
      console.error(`[verity] ${ctx.correlationId} unhandled error`, isProduction ? '' : error);
      return errorResponse('INTERNAL_ERROR', ctx.correlationId);
    }
  };
}

/**
 * `routeHandler` plus the cross-origin headers the extension needs.
 *
 * Applied to successes and failures alike: without the headers on an error
 * response the browser hides the status from the extension, and the panel
 * would report "could not reach Verity" for what was really a sign-in prompt.
 */
export function extensionRouteHandler<Args extends unknown[]>(
  handler: (request: Request, ctx: RequestContext, ...args: Args) => Promise<NextResponse>,
) {
  const wrapped = routeHandler(handler);
  return async (request: Request, ...args: Args): Promise<NextResponse> => {
    const response = await wrapped(request, ...args);
    for (const [key, value] of Object.entries(corsHeaders(request))) {
      response.headers.set(key, value);
    }
    return response;
  };
}
