# Deploying to Vercel

## The one setting that matters

**Root Directory must be `apps/web`.**

This is a monorepo with two applications. `apps/extension` is a Chrome extension: its build emits
`sidepanel.html`, `background.js` and `content.js`, and deliberately has no `index.html`. If Vercel
points at it, the build succeeds and every URL returns `404: NOT_FOUND`, because there is genuinely
nothing at `/`. A Chrome extension is loaded from `chrome://extensions`, not served over HTTP.

Set it under **Project → Settings → Build and Deployment → Root Directory**, then redeploy.

If your project is currently named `verity-extension`, it is pointed at the wrong app. Either
change its root directory or delete it and import again, choosing `apps/web`.

Leave **Include source files outside of the Root Directory** enabled. The web app imports
`@verity/domain`, `@verity/database`, `@verity/schemas` and `@verity/ui` from `packages/`, and
those files live above the root directory.

## Required environment variables

The server validates its environment at startup and refuses to run with a bad one, rather than
failing later on a request that happened to need a missing value. Set all of these under
**Settings → Environment Variables** for the Production environment.

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://…?sslmode=require` | Must be reachable from Vercel. Your local `127.0.0.1:5433` is not. |
| `AUTH_SECRET` | 32+ random bytes, base64 | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `NEXT_PUBLIC_APP_URL` | `https://your-app.vercel.app` | Must be `https` in production, or the server refuses to start. |
| `AUTH_URL` | same as above | |
| `RP_ID` | `your-app.vercel.app` | **Hostname only.** No scheme, no port, no trailing slash. |
| `EXPECTED_ORIGIN` | `https://your-app.vercel.app` | With the scheme. |
| `RP_NAME` | `Verity` | Shown in the passkey prompt. |
| `RESEND_API_KEY` | `re_…` | **Required in production.** See below. |
| `EMAIL_FROM` | `Verity <no-reply@yourdomain.com>` | Must be a domain verified with Resend. |
| `RECEIPT_SIGNING_KEY` | base64 PKCS#8 Ed25519 | Generation command is in `.env.example`. |
| `RECEIPT_SIGNING_KEY_VERSION` | `1` | Increment when rotating. |
| `ENABLED_ACTION_TYPES` | `PAYMENT_REQUEST,BANK_ACCOUNT_CHANGE` | Optional; this is the default. |
| `EXTENSION_ORIGINS` | `chrome-extension://<id>` | Optional. Only needed for the Gmail panel. |

### Why `RESEND_API_KEY` is mandatory

In development, outbound email is written to the server log so you need no email account. In
production that fallback is refused, and the server will not start without a key.

This is deliberate. The fallback silently swallowing an approver notification would mean a request
sits unapproved while everyone believes it was sent — a failure mode that looks exactly like the
attack the product exists to prevent. Failing at startup is louder and safer than failing quietly at
3pm on a Friday.

Use a free Resend account and a verified domain. Do not work around this by setting a fake key; you
will get silent delivery failures instead of a loud startup failure, which is strictly worse.

### `RP_ID` is the trap worth reading twice

WebAuthn binds every passkey to a **relying party ID**, which is a bare hostname. A passkey
registered under `RP_ID=verity-abc.vercel.app` **will not work on any other domain**. There is no
migration path: the credentials are cryptographically scoped to that name and users must register
new ones.

Consequences:

- **Add your custom domain before anyone registers a passkey**, then set `RP_ID` to it once and
  leave it alone.
- **Preview deployments cannot be used to test passkeys.** Every preview gets a new URL, which will
  not match `RP_ID`, and registration will fail. Test passkeys against production or locally.
- `RP_ID` must be the origin's own hostname or a registrable parent of it. `vercel.app` is a public
  suffix, so `verity-abc.vercel.app` is the only valid value for that origin — you cannot use
  `vercel.app`.

## Database

Vercel builds do not run migrations, and they should not: a failed migration during a build leaves
you with a half-migrated database and no obvious way back.

Provision Postgres 16 (Neon, Supabase, or Vercel Postgres), then apply the schema **once, from your
machine**, pointing at the production database:

```bash
DATABASE_URL="postgresql://…?sslmode=require" pnpm db:deploy
```

Repeat that command after any future migration, before deploying the code that depends on it.

The Prisma client itself *is* generated during the build — `apps/web`'s build script runs
`prisma generate` before `next build`, because a fresh checkout has no generated client and
`next build` would fail without it.

## Checking it worked

1. `https://your-app.vercel.app/privacy` should render. It touches neither the database nor the
   session, so it isolates "is the app serving at all" from "is the database reachable".
2. `https://your-app.vercel.app/` should redirect to `/signin`. This proves the database connection
   and session lookup work.
3. Enter your email on `/signin`. If the link arrives, Resend is configured correctly.
4. Register a passkey at `/security`. If this fails, `RP_ID` does not match your hostname.

If step 1 fails with a 500, read the function logs. The environment validator names the offending
variables explicitly and never prints their values.

## What is not deployed here

`apps/extension` is not a website and has no Vercel project. Build it locally:

```bash
pnpm --filter @verity/extension build
```

Then load `apps/extension/dist` unpacked at `chrome://extensions`, and add the ID Chrome assigns to
`EXTENSION_ORIGINS` in Vercel. Note that `apps/extension/src/shared/config.ts` defaults its API base
URL to `http://localhost:3000`; point it at your deployed origin with `VITE_VERITY_API_URL` at build
time before distributing it.
