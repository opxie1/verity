import { getRequest, requireMembership } from '@verity/domain';
import { organizationIdSchema, requestIdSchema } from '@verity/schemas';
import { corsPreflight, extensionRouteHandler, okResponse, parseOrThrow } from '@/lib/api';
import { requireSessionUser } from '@/lib/session';

type Params = { params: Promise<{ requestId: string }> };

export const OPTIONS = async (request: Request) => corsPreflight(request);

/**
 * Status for one request, for the panel to poll (PRD 21.7).
 *
 * Carries no protected fields. The panel shows whether a decision has been
 * made; the details themselves are only rendered on the Verity page, loaded
 * from the server (PRD 18.9).
 */
export const GET = extensionRouteHandler(async (request, ctx, { params }: Params) => {
  const user = await requireSessionUser();
  const { requestId } = await params;
  const url = new URL(request.url);

  const membership = await requireMembership(
    user,
    parseOrThrow(organizationIdSchema, url.searchParams.get('organizationId')),
    ctx,
  );

  const found = await getRequest(membership, parseOrThrow(requestIdSchema, requestId));
  const denial = found.decisions.filter((decision) => decision.decision === 'DENY').at(-1);

  return okResponse(
    {
      id: found.id,
      status: found.status,
      actionType: found.actionType,
      displayTitle: found.displayTitle,
      displaySummary: found.displaySummary,
      approverName: found.approver.name ?? found.approver.email,
      requesterName: found.requester.name ?? found.requester.email,
      createdAt: found.createdAt,
      expiresAt: found.expiresAt,
      receiptId: found.receipt?.id ?? null,
      deniedReason: denial?.reason ?? null,
    },
    ctx.correlationId,
  );
});
