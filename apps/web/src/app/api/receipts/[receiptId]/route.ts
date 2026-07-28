import { recordReceiptViewed, requireMembership, verifyReceipt } from '@verity/domain';
import { organizationIdSchema, receiptIdSchema } from '@verity/schemas';
import { okResponse, parseOrThrow, routeHandler } from '@/lib/api';
import { receiptSigningConfig } from '@/lib/receipts';
import { requireSessionUser } from '@/lib/session';

type Params = { params: Promise<{ receiptId: string }> };

export const GET = routeHandler(async (request, ctx, { params }: Params) => {
  const user = await requireSessionUser();
  const { receiptId } = await params;
  const url = new URL(request.url);

  const membership = await requireMembership(
    user,
    parseOrThrow(organizationIdSchema, url.searchParams.get('organizationId')),
    ctx,
  );

  const parsedId = parseOrThrow(receiptIdSchema, receiptId);
  const result = await verifyReceipt(membership, parsedId, receiptSigningConfig);
  await recordReceiptViewed(membership, parsedId, ctx);

  return okResponse(
    {
      receipt: {
        receiptId: result.receipt.id,
        body: result.receipt.receiptPayloadJson,
        signature: result.receipt.serverSignature,
        signingKeyVersion: result.receipt.signingKeyVersion,
        createdAt: result.receipt.createdAt,
      },
      verification: {
        signatureValid: result.signatureValid,
        payloadMatchesRequest: result.payloadMatchesRequest,
        currentlyValid: result.currentlyValid,
        revoked: result.revoked,
        expired: result.expired,
        status: result.status,
      },
    },
    ctx.correlationId,
  );
});
