import 'server-only';
import { z } from 'zod';

/**
 * Server environment, validated once at module load so a misconfigured deploy
 * fails immediately instead of at the first request that happens to need a
 * missing value (PRD NFR-006).
 *
 * This module is server-only; importing it from a client component is a build
 * error, which keeps secrets out of the browser bundle.
 */
const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    DATABASE_URL: z.string().url(),

    NEXT_PUBLIC_APP_URL: z.string().url(),
    AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),

    RP_ID: z.string().min(1),
    RP_NAME: z.string().min(1).default('Verity'),
    /** Comma-separated list of origins permitted to produce WebAuthn assertions. */
    EXPECTED_ORIGIN: z.string().min(1),

    RESEND_API_KEY: z.string().optional().default(''),
    EMAIL_FROM: z.string().min(1),

    AUTH_GOOGLE_ID: z.string().optional().default(''),
    AUTH_GOOGLE_SECRET: z.string().optional().default(''),

    RECEIPT_SIGNING_KEY: z.string().optional().default(''),
    RECEIPT_SIGNING_KEY_VERSION: z.coerce.number().int().positive().default(1),

    /**
     * Action types offered to requesters (PRD 13, 36.19). Payment requests and
     * bank-account changes are the two the MVP commits to; the rest stay
     * behind this flag until their flows are finished, so a half-built action
     * type cannot be used to authorize anything.
     */
    ENABLED_ACTION_TYPES: z.string().optional().default('PAYMENT_REQUEST,BANK_ACCOUNT_CHANGE'),

    /**
     * Chrome extension origins allowed to call `/api/extension/*`, as a
     * comma-separated list of `chrome-extension://<id>` values.
     *
     * Allow-listed explicitly rather than matched by pattern: an extension ID
     * is the only thing distinguishing your extension from anyone else's, so a
     * wildcard here would let any installed extension use a signed-in
     * session.
     */
    EXTENSION_ORIGINS: z.string().optional().default(''),

    /**
     * Demo mode. Gives every visitor a private sandbox organization with both
     * a requester and an approver, so the product can be evaluated without an
     * email account or a second person. Off unless explicitly "true".
     */
    DEMO_MODE: z.enum(['true', 'false']).optional().default('false'),
  })
  .superRefine((env, ctx) => {
    // `next build` runs with NODE_ENV=production while evaluating modules to
    // collect page data, but a build machine has no production secrets and no
    // https origin. These checks belong to a running server, so they are
    // skipped for the build phase only — the same server still evaluates them
    // when it actually starts.
    const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';
    if (env.NODE_ENV !== 'production' || isBuildPhase) {
      return;
    }
    // Guardrails that only matter once real people are using the system.
    //
    // Demo mode is exempt from the email requirement: nobody in a sandbox is
    // waiting on a notification, sign-in does not use email, and requiring a
    // verified sending domain would put the demo behind exactly the barrier it
    // exists to remove. Real deployments still cannot start without it.
    if (!env.RESEND_API_KEY && env.DEMO_MODE !== 'true') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RESEND_API_KEY'],
        message:
          'RESEND_API_KEY is required in production; email cannot fall back to the log. ' +
          'Set DEMO_MODE=true if this is an evaluation deployment with no real users.',
      });
    }
    if (!env.NEXT_PUBLIC_APP_URL.startsWith('https://')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['NEXT_PUBLIC_APP_URL'],
        message: 'NEXT_PUBLIC_APP_URL must use https in production.',
      });
    }
  });

function loadServerEnv() {
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    // The names of the offending variables are safe to print; their values are
    // not. The pointer matters because this fires during `next build` as well
    // as at runtime, and a build log is where someone deploying will meet it.
    throw new Error(
      `Invalid server environment:\n${detail}\n\n` +
        'Set these where the app runs. For Vercel see docs/DEPLOYMENT.md — ' +
        'note that Root Directory must be apps/web, and that a failed production ' +
        'build leaves the previous deployment serving traffic.',
    );
  }
  return parsed.data;
}

export const serverEnv = loadServerEnv();

/** Origins accepted for WebAuthn assertions and for state-changing API calls. */
export const expectedOrigins: readonly string[] = serverEnv.EXPECTED_ORIGIN.split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

export const isProduction = serverEnv.NODE_ENV === 'production';

export const extensionOrigins: readonly string[] = serverEnv.EXTENSION_ORIGINS.split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.startsWith('chrome-extension://'));

const ALL_ACTION_TYPES = [
  'PAYMENT_REQUEST',
  'BANK_ACCOUNT_CHANGE',
  'PAYROLL_CHANGE',
  'ACCESS_CHANGE',
  'CONFIDENTIAL_DATA_DISCLOSURE',
  'CUSTOM',
] as const;

export type EnabledActionType = (typeof ALL_ACTION_TYPES)[number];

export const enabledActionTypes: readonly EnabledActionType[] = serverEnv.ENABLED_ACTION_TYPES.split(
  ',',
)
  .map((value) => value.trim().toUpperCase())
  .filter((value): value is EnabledActionType =>
    (ALL_ACTION_TYPES as readonly string[]).includes(value),
  );

if (enabledActionTypes.length === 0) {
  throw new Error('ENABLED_ACTION_TYPES did not name any known action type.');
}
