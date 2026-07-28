import { prisma } from '@verity/database';
import { listRequests, requireMembership } from '@verity/domain';
import { organizationIdSchema } from '@verity/schemas';
import { z } from 'zod';
import { corsPreflight, extensionRouteHandler, okResponse, parseOrThrow } from '@/lib/api';
import { requireSessionUser } from '@/lib/session';

type Params = { params: Promise<{ threadId: string }> };

export const OPTIONS = async (request: Request) => corsPreflight(request);

const threadIdSchema = z.string().trim().min(1).max(200);

/**
 * Requests raised from a given Gmail thread (PRD 21.7, 23.4).
 *
 * The thread ID comes from the browser, so it is only ever used as a filter
 * inside the caller's own organization — it grants nothing on its own.
 */
export const GET = extensionRouteHandler(async (request, ctx, { params }: Params) => {
  const user = await requireSessionUser();
  const { threadId } = await params;
  const url = new URL(request.url);

  const membership = await requireMembership(
    user,
    parseOrThrow(organizationIdSchema, url.searchParams.get('organizationId')),
    ctx,
  );

  const result = await listRequests(membership, {
    threadId: parseOrThrow(threadIdSchema, decodeURIComponent(threadId)),
    limit: 20,
  });

  const detailed = await Promise.all(
    result.requests.map(async (summary) => {
      const record = await prismaRequestDetail(summary.id);
      return {
        id: summary.id,
        status: summary.status,
        actionType: summary.actionType,
        displayTitle: summary.displayTitle,
        displaySummary: summary.displaySummary,
        approverName: summary.approver.name ?? summary.approver.email,
        requesterName: summary.requester.name ?? summary.requester.email,
        createdAt: summary.createdAt,
        expiresAt: summary.expiresAt,
        receiptId: record.receiptId,
        deniedReason: record.deniedReason,
      };
    }),
  );

  return okResponse({ requests: detailed }, ctx.correlationId);
});

/** Receipt ID and denial reason, which the list projection does not carry. */
async function prismaRequestDetail(requestId: string) {
  const record = await prisma.verificationRequest.findUnique({
    where: { id: requestId },
    select: {
      receipt: { select: { id: true } },
      decisions: {
        where: { decision: 'DENY' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { reason: true },
      },
    },
  });
  return {
    receiptId: record?.receipt?.id ?? null,
    deniedReason: record?.decisions[0]?.reason ?? null,
  };
}
