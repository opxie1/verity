# Verity

Verity proves that a known, authorized person approved an **exact** high-risk action, rather than
proving only that a message arrived from their account.

When an employee receives a consequential request such as a wire transfer or a vendor
bank-account change, they create a verification request bound to the precise details. The named
approver must confirm those exact details with a registered passkey. The result is a tamper-evident
receipt showing who approved what, when, and whether anything has changed since.

Verity does not move money, hold bank credentials, or execute business actions. It records human
authorization, and a person acts on that record elsewhere.

## Requirements

- Node.js 20.11 or newer (developed on 24)
- pnpm 9
- PostgreSQL 16

## Setup

```bash
pnpm install
cp .env.example .env
```

Fill in `.env`. At minimum you need `DATABASE_URL` and `AUTH_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### Database

Either start the bundled container:

```bash
docker compose up -d db
```

Or point `DATABASE_URL` at any PostgreSQL 16 instance. The port is 5433 by default so it does not
collide with an existing local install. Then apply the schema:

```bash
pnpm db:deploy
```

### Run

```bash
pnpm --filter @verity/web dev
```

The app is at http://localhost:3000.

With no `RESEND_API_KEY` set, outbound email is printed to the server log instead of being
delivered, so sign-in links and invitations are visible in your terminal. That fallback is refused
in production, where a missing key stops the server from starting rather than silently swallowing
an approval notice.

## Deploying

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Two things catch people out:

- **Root Directory must be `apps/web`.** This repo holds two applications, and `apps/extension` is a
  Chrome extension with no `index.html`. Pointing a host at it builds cleanly and then serves 404 on
  every URL.
- **`RP_ID` must equal your final hostname before anyone registers a passkey.** Passkeys are
  cryptographically bound to it and do not survive a domain change.

## Tests

```bash
pnpm test                # unit tests per package, then integration
pnpm test:integration    # integration tests only
```

Integration tests run against a real PostgreSQL database named `<your database>_test`, which is
dropped and rebuilt from the migrations on each run. They use a real database on purpose: much of
what Verity promises — organization isolation, single-use invitations, append-only audit records —
is enforced by database constraints and triggers, and a mocked client would report those as passing
while proving nothing.

## Layout

```
apps/
  web/            Next.js application: UI, REST API, authentication
packages/
  database/       Prisma schema, migrations, client
  domain/         Business logic: authorization, organizations, invitations, audit
  schemas/        Zod schemas shared by client and server
  ui/             Shared React primitives
  config/         Shared TypeScript configuration
tests/
  integration/    Tests against a real database
docs/             Product and security documentation
```

Business rules live in `packages/domain`, never in React components. Authorization is enforced on
the server for every request; hiding a control in the interface is a convenience, not a control.

## The Gmail extension

```bash
pnpm --filter @verity/extension build
```

Then load `apps/extension/dist` as an unpacked extension at `chrome://extensions`, copy the
extension ID it is given, and add it to `.env`:

```
EXTENSION_ORIGINS="chrome-extension://<the id>"
```

There is no wildcard on purpose. The ID is the only thing distinguishing your extension from anyone
else's, so an unlisted extension is refused.

The extension reads five things from an open message — message ID, thread ID, sender address,
subject and URL — and never the body or attachments. It holds no credential of its own, and it does
not render approve or deny controls: decisions are taken on the Verity page, against details loaded
from the server, so a tampered extension cannot show one action while a different one is authorized.

## Status

All seven milestones are implemented.

| Milestone | Scope | State |
|---|---|---|
| 1 | Monorepo, authentication, organizations, invitations, roles, dashboard | Complete |
| 2 | Passkey registration and WebAuthn authentication | Complete |
| 3 | Verification requests, payload normalization and hashing | Complete |
| 4 | Approval, denial, signed receipts | Complete |
| 5 | Gmail Chrome extension | Complete, untested against live Gmail |
| 6 | Audit log, cancellation, expiration, revocation | Complete |
| 7 | Hardening: tests, rate limits, security headers, documentation | Complete, except end-to-end tests |

167 automated tests pass. The significant remaining gaps are a Playwright end-to-end suite, live
Gmail verification, and an independent security review.
[docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) tracks every requirement individually and is
explicit about what is not done.

## Security

- [docs/SECURITY.md](docs/SECURITY.md) — what Verity protects, how, and what it does not claim
- [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) — twelve threats with controls and residual risk

Two properties are worth knowing before reading any code:

**A session cannot approve anything.** Approving, denying and revoking each require a fresh passkey
assertion over a challenge that binds the request, the hash of its exact details, and the decision
itself. A stolen cookie, a compromised mailbox and a convincing impersonation all fail to produce
one.

**History cannot be rewritten.** `audit_events`, `receipts`, `decisions` and `revocations` reject
`UPDATE`, `DELETE` and `TRUNCATE` at the database level. The tests prove it by attempting all three.
