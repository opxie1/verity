import { listPasskeys } from '@verity/domain';
import { okResponse, routeHandler } from '@/lib/api';
import { requireSessionUser } from '@/lib/session';

export const GET = routeHandler(async (_request, ctx) => {
  const user = await requireSessionUser();
  const passkeys = await listPasskeys(user.id);
  return okResponse({ passkeys }, ctx.correlationId);
});
