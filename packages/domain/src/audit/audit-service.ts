import { prisma, type AuditEventType, type DbClient, type Prisma } from '@verity/database';
import type { RequestContext } from '../context';

export interface AuditEventInput {
  organizationId: string | null;
  actorUserId: string | null;
  eventType: AuditEventType;
  targetType: string;
  targetId?: string | null;
  metadata?: Prisma.InputJsonValue;
  previousState?: string | null;
  newState?: string | null;
  ctx: RequestContext;
}

/**
 * Appends one immutable audit record (PRD FR-015).
 *
 * There is no update or delete counterpart, and the `audit_events` table
 * additionally carries a database trigger that rejects UPDATE and DELETE, so
 * history cannot be rewritten even by code that bypasses this service.
 *
 * Pass `db` when the event belongs to a wider transaction — a state change and
 * its audit record must commit or roll back together.
 */
export async function recordAuditEvent(
  input: AuditEventInput,
  db: DbClient = prisma,
): Promise<void> {
  await db.auditEvent.create({
    data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      eventType: input.eventType,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      metadata: input.metadata ?? {},
      previousState: input.previousState ?? null,
      newState: input.newState ?? null,
      requestCorrelationId: input.ctx.correlationId,
      ipHash: input.ctx.ipHash,
      userAgent: input.ctx.userAgent?.slice(0, 500) ?? null,
    },
  });
}

export interface AuditEventFilter {
  organizationId: string;
  eventType?: AuditEventType;
  actorUserId?: string;
  targetType?: string;
  targetId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  cursor?: string;
}

export async function listAuditEvents(filter: AuditEventFilter) {
  const limit = Math.min(filter.limit ?? 50, 100);

  const events = await prisma.auditEvent.findMany({
    where: {
      // Always scoped to one organization; there is no unscoped read path.
      organizationId: filter.organizationId,
      ...(filter.eventType ? { eventType: filter.eventType } : {}),
      ...(filter.actorUserId ? { actorUserId: filter.actorUserId } : {}),
      ...(filter.targetType ? { targetType: filter.targetType } : {}),
      ...(filter.targetId ? { targetId: filter.targetId } : {}),
      ...(filter.from || filter.to
        ? {
            createdAt: {
              ...(filter.from ? { gte: filter.from } : {}),
              ...(filter.to ? { lte: filter.to } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    include: {
      actor: { select: { id: true, email: true, name: true } },
    },
  });

  const hasMore = events.length > limit;
  const page = hasMore ? events.slice(0, limit) : events;

  return {
    events: page,
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

/** Timeline for a single object, used by request detail and receipt pages. */
export async function listAuditEventsForTarget(
  organizationId: string,
  targetType: string,
  targetId: string,
) {
  return prisma.auditEvent.findMany({
    where: { organizationId, targetType, targetId },
    orderBy: { createdAt: 'asc' },
    include: { actor: { select: { id: true, email: true, name: true } } },
  });
}
