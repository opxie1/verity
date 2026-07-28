import { getRequest, requireMembership } from '@verity/domain';
import { organizationIdSchema, requestIdSchema } from '@verity/schemas';
import { okResponse, parseOrThrow, routeHandler } from '@/lib/api';
import { requireSessionUser } from '@/lib/session';

type Params = { params: Promise<{ requestId: string }> };

/**
 * A small response the Gmail panel can poll without pulling the whole request
 * (PRD 21.7). It carries status only — no protected fields — so a polling loop
 * does not repeatedly ship account details across the network.
 */
export const GET = routeHandler(async (request, ctx, { params }: Params) => {
  const user = await requireSessionUser();
  const { requestId } = await params;
  const url = new URL(request.url);

  const membership = await requireMembership(
    user,
    parseOrThrow(organizationIdSchema, url.searchParams.get('organizationId')),
    ctx,
  );

  const found = await getRequest(membership, parseOrThrow(requestIdSchema, requestId));

  return okResponse(
    {
      id: found.id,
      status: found.status,
      expiresAt: found.expiresAt,
      approvedAt: found.approvedAt,
      deniedAt: found.deniedAt,
      receiptId: found.receipt?.id ?? null,
      approver: { displayName: found.approver.name, email: found.approver.email },
    },
    ctx.correlationId,
  );
});
