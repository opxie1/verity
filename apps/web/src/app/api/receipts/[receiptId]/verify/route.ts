import { requireMembership, verifyReceipt } from '@verity/domain';
import { organizationIdSchema, receiptIdSchema } from '@verity/schemas';
import { okResponse, parseOrThrow, routeHandler } from '@/lib/api';
import { receiptSigningConfig } from '@/lib/receipts';
import { requireSessionUser } from '@/lib/session';

type Params = { params: Promise<{ receiptId: string }> };

/**
 * The verification verdict on its own (PRD 21.5, FR-013).
 *
 * Every check runs on the server against stored records. The response says
 * whether the receipt holds; it never returns material a caller could use to
 * decide that for themselves incorrectly.
 */
export const GET = routeHandler(async (request, ctx, { params }: Params) => {
  const user = await requireSessionUser();
  const { receiptId } = await params;
  const url = new URL(request.url);

  const membership = await requireMembership(
    user,
    parseOrThrow(organizationIdSchema, url.searchParams.get('organizationId')),
    ctx,
  );

  const result = await verifyReceipt(
    membership,
    parseOrThrow(receiptIdSchema, receiptId),
    receiptSigningConfig,
  );

  return okResponse(
    {
      valid: result.currentlyValid,
      decision: (result.receipt.receiptPayloadJson as { decision?: string }).decision ?? null,
      actionHash: result.receipt.request.payloadHash,
      approvedAt: result.receipt.createdAt,
      revoked: result.revoked,
      expiresAt: result.receipt.request.expiresAt,
      signatureValid: result.signatureValid,
      payloadMatchesRequest: result.payloadMatchesRequest,
      status: result.status,
    },
    ctx.correlationId,
  );
});
