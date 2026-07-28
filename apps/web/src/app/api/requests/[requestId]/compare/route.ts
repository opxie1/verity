import { compareRequestDetails, requireMembership } from '@verity/domain';
import { FIELD_LABELS, HIGH_RISK_FIELDS } from '@verity/schemas';
import { compareRequestSchema, organizationIdSchema, requestIdSchema } from '@verity/schemas';
import {
  assertAllowedOrigin,
  okResponse,
  parseJsonBody,
  parseOrThrow,
  routeHandler,
} from '@/lib/api';
import { requireSessionUser } from '@/lib/session';

type Params = { params: Promise<{ requestId: string }> };

/**
 * "Do these details still match what was approved?" (PRD 14.5, 23.4)
 *
 * The comparison runs on the server against the stored payload. The client is
 * never trusted to decide whether it matches, and never receives the approved
 * payload wholesale in order to check for itself.
 */
export const POST = routeHandler(async (request, ctx, { params }: Params) => {
  assertAllowedOrigin(request);
  const user = await requireSessionUser();
  const { requestId } = await params;

  const body = await parseJsonBody(
    request,
    compareRequestSchema.extend({ organizationId: organizationIdSchema }),
  );

  const membership = await requireMembership(user, body.organizationId, ctx);
  const result = await compareRequestDetails(
    membership,
    parseOrThrow(requestIdSchema, requestId),
    body.fields,
  );

  return okResponse(
    {
      matches: result.matches,
      status: result.status,
      comparisons: result.comparisons.map((entry) => ({
        field: entry.field,
        label: FIELD_LABELS[entry.field] ?? entry.field,
        matches: entry.matches,
        highRisk: HIGH_RISK_FIELDS.has(entry.field),
        approvedValue: entry.approvedValue,
        submittedValue: entry.submittedValue,
      })),
    },
    ctx.correlationId,
  );
});
