import { listAuditEvents, requireMembershipWithPermission } from '@verity/domain';
import { auditEventTypeSchema, organizationIdSchema, userIdSchema } from '@verity/schemas';
import { z } from 'zod';
import { okResponse, parseOrThrow, routeHandler } from '@/lib/api';
import { requireSessionUser } from '@/lib/session';

const querySchema = z.object({
  organizationId: organizationIdSchema,
  eventType: auditEventTypeSchema.optional(),
  actorUserId: userIdSchema.optional(),
  targetType: z.string().trim().max(60).optional(),
  targetId: z.string().trim().max(80).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

/**
 * The organization's audit log (PRD 21.6, FR-019).
 *
 * Read-only by construction: there is no write, update or delete counterpart
 * anywhere in the API, and the table itself rejects those operations.
 */
export const GET = routeHandler(async (request, ctx) => {
  const user = await requireSessionUser();
  const url = new URL(request.url);

  const query = parseOrThrow(querySchema, Object.fromEntries(url.searchParams.entries()));

  const membership = await requireMembershipWithPermission(
    user,
    query.organizationId,
    'audit:read',
    ctx,
  );

  const result = await listAuditEvents({
    organizationId: membership.organizationId,
    ...(query.eventType ? { eventType: query.eventType } : {}),
    ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
    ...(query.targetType ? { targetType: query.targetType } : {}),
    ...(query.targetId ? { targetId: query.targetId } : {}),
    ...(query.from ? { from: new Date(query.from) } : {}),
    ...(query.to ? { to: new Date(query.to) } : {}),
    limit: query.limit,
    ...(query.cursor ? { cursor: query.cursor } : {}),
  });

  return okResponse(
    {
      events: result.events.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        targetType: event.targetType,
        targetId: event.targetId,
        actor: event.actor
          ? { id: event.actor.id, email: event.actor.email, displayName: event.actor.name }
          : null,
        previousState: event.previousState,
        newState: event.newState,
        metadata: event.metadata,
        correlationId: event.requestCorrelationId,
        createdAt: event.createdAt,
      })),
      nextCursor: result.nextCursor,
    },
    ctx.correlationId,
  );
});
