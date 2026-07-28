# Security

This document states what Verity protects, how, and — just as importantly — what it does not
protect. It describes the MVP as built, not an aspiration.

Report a vulnerability by email to the address in the repository owner's profile. Please do not
open a public issue for anything exploitable.

## What Verity claims

**A named, authorized person confirmed an exact action with a credential only they hold.**

That is the whole claim. Everything below either supports it or bounds it.

## What Verity does not claim

- That the approved action is **correct, lawful, or wise**. Verity records authorization; it does
  not exercise judgement.
- That the approver was **not deceived**. A real person who approves a fraudulent request has still
  really approved it. The receipt will say so accurately.
- That an **insider** is honest. A malicious employee with a passkey can approve fraud, and Verity
  will record exactly who did it and when. That is a deterrent and an audit trail, not prevention.
- That media is **genuine**. Verity does not analyse audio or video and cannot tell a deepfake from
  a person. It makes the question irrelevant by requiring a separate credential.
- That anything happened **outside Verity**. It does not move money, hold banking credentials, or
  execute business actions. A person reads a receipt and acts elsewhere.

## How authorization works

Three separate things must line up before a decision is recorded.

1. **A session** identifies who is signed in. Sessions are stored server-side and re-checked on
   every request, so disabling a member takes effect immediately rather than when their token
   happens to expire.
2. **A membership** proves the signed-in person belongs to the organization the record lives in.
   Every organization-scoped operation goes through one function, `requireMembership`, and receives
   proof of membership rather than an organization ID.
3. **A passkey assertion** proves the decision came from the approver's own device. This is what a
   compromised mailbox, a stolen session cookie, and a convincing impersonation all fail to produce.

### Why a session is not enough

A decision challenge is not a generic "prove you are here" prompt. Before it reaches the
authenticator, the server folds in:

- the request ID,
- the SHA-256 hash of the exact protected payload,
- whether this is an approval, a denial, or a revocation,
- a fresh server nonce,
- the challenge ID,
- an expiry two minutes out.

The authenticator signs the digest of all of that. The resulting signature therefore cannot be
replayed against a different request, cannot be applied to different details, and cannot be turned
from a denial into an approval. The tests in `tests/integration/decisions.test.ts` assert each of
those, using a software authenticator that produces real ES256 signatures.

## Integrity of the record

### Payload hashing

Approving means approving specific values. Those values are normalized into a canonical form and
hashed on the server:

- object keys sorted by code point, so ordering carries no meaning;
- strings Unicode-normalized to NFC and trimmed, so two spellings of the same name agree;
- money in integer minor units, never floats — non-integers are refused outright;
- `undefined` refused rather than dropped, so a protected field cannot vanish silently;
- absent and blank optional fields collapsed to the same thing, so "no memo" has one hash.

A client-supplied hash is never read. The rules and their consequences are asserted in
`packages/domain/src/requests/normalization.test.ts`.

### Append-only records

`audit_events`, `receipts`, `decisions` and `revocations` carry database triggers rejecting
`UPDATE`, `DELETE` and `TRUNCATE`. This is enforced by PostgreSQL, not by application discipline,
so a bug or an attacker holding the application's own database credentials still cannot rewrite
history. Their foreign keys use `ON DELETE RESTRICT`, because a cascade would fight the trigger.

Verified in `tests/integration/authorization.test.ts`, which attempts all three and expects failure.

### Receipts

Every decision produces an Ed25519-signed receipt over the canonical receipt body, using Node's
standard crypto. No primitive is implemented here. The signing key is read from the environment,
never committed, and each receipt records the key version so keys can be rotated without
invalidating older receipts.

A receipt is reported valid only when the signature verifies, the body still describes the request's
current payload hash, the request is in `APPROVED`, and the decision recorded is an approval.
Revoking flips the last condition without touching the signature — the receipt still verifies, and
still says what it always said.

## Secrets and data

- **Passkey private keys** never reach the server. Only public credential material is stored.
- **Biometric data** is never transmitted or stored. The authenticator matches the fingerprint or
  face locally and reports only that verification succeeded.
- **Invitation tokens** are stored as SHA-256 hashes. The raw token exists in the invited person's
  mailbox and nowhere else, and is never written to a log or an audit record.
- **Bank account numbers** are not collected. Only the last four digits.
- **Email bodies** are never ingested. The Gmail extension reads message ID, thread ID, sender
  address, subject and URL, and nothing else.
- **IP addresses** are stored as a truncated HMAC, keyed with the application secret, so the small
  IPv4 space cannot be brute-forced from a database dump.
- **Audit metadata** carries payload hashes rather than payload contents, so the log can prove what
  was approved without restating account details.

## Boundaries and validation

Every route handler:

- resolves the session from the database rather than trusting the cookie's contents;
- validates its body against a shared Zod schema;
- resolves membership before touching an organization-scoped record;
- returns a structured error with a correlation ID and no internal detail;
- wraps state changes in a transaction, with the state change conditional on the prior state so
  concurrent attempts cannot both win.

Cross-organization reads return "not found", never "forbidden", so record IDs cannot be probed for
existence across tenants.

## Browser-facing protections

- Session cookies are `HttpOnly`, `Secure` in production, and `SameSite=Lax`.
- State-changing requests additionally check the `Origin` header against an allow-list.
- `frame-ancestors 'none'` and `X-Frame-Options: DENY` keep the approval page out of frames.
- API responses are `no-store`.
- The Gmail extension declares `script-src 'self'` and holds no credential of its own.
- The extension never renders the approve or deny controls. Decisions happen on the Verity page,
  against details loaded from the server, so a tampered extension cannot show one action while the
  approver authorizes another.

## Known limitations

These are real and deliberate for the MVP. They are listed here rather than buried.

| Limitation | Consequence | Intended resolution |
|---|---|---|
| Rate limiting is in-process | Protects one instance only; multiple instances each count separately | Move to Redis or the platform limiter before scaling out |
| No two-person approval | One approver's compromise or dishonesty is sufficient | Multi-approver thresholds are on the roadmap |
| No account recovery flow | Losing every passkey requires administrator intervention | Removing the last passkey is refused as a stopgap |
| Server compromise is not defended against | An attacker with the signing key can mint receipts | Separate signing key custody; the threat model states this plainly |
| CSP allows `'unsafe-inline'` for scripts | Weakens XSS containment | Nonce-based CSP once Next.js App Router supports it cleanly |
| No end-to-end browser test suite yet | Ceremonies are covered by integration tests with a software authenticator, not a real browser | Playwright with a virtual authenticator |

## Rules this codebase follows

Taken from the PRD and enforced in review:

- No custom cryptography. WebAuthn verification is `@simplewebauthn/server`; signing is Node crypto.
- No client-generated payload hashes are trusted.
- No approved request payload can be modified.
- No audit event is deletable through an ordinary API.
- No state change happens through a `GET`.
- No secret is committed. `.env` is ignored; `.env.example` documents every variable.
