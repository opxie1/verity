# Threat model

Implements PRD section 18. Each threat states what an attacker can do, what stops them, and what is
left over. The residual risks are the honest part; a threat model without them is marketing.

## Assets

| Asset | Why it matters |
|---|---|
| The approval decision | The product's entire output. A forged approval is a total failure. |
| The protected payload and its hash | Defines *what* was approved. If it can change after the fact, the approval means nothing. |
| The audit log | The record of what happened. If it can be rewritten, nothing else can be trusted. |
| The receipt signing key | Whoever holds it can mint receipts. |
| Passkey credentials | Public material only; the private half never reaches us. |
| Member and organization data | Cross-tenant leakage would be a breach in itself. |

## Trust boundaries

```
Attacker-controlled ──▶ Email content, Gmail message metadata, request bodies,
                        URL parameters, extension-supplied values

Semi-trusted        ──▶ Signed-in session (proves an account, not a decision)

Trusted             ──▶ Server-side domain services, PostgreSQL, the signing key

Out of scope        ──▶ The approver's device, their authenticator, their judgement
```

Everything crossing into the trusted zone is validated by a shared schema and re-derived
server-side. Nothing the client asserts about identity, membership, or hashes is believed.

---

## T1 — Compromised requester mailbox

**Attack.** An attacker controls the finance employee's email and raises a fraudulent verification
request, hoping the approver rubber-stamps it.

**Controls.** The request still needs an approval from the assigned approver's registered passkey.
The approval page names the requester and shows every protected field. The audit log records who
raised it.

**Residual risk.** An approver who does not read the details can still approve. This is the reason
the approval page shows the amount, recipient and account in full, with no disclosure controls, and
why high-risk fields are emphasised. It is mitigated, not eliminated.

---

## T2 — Compromised approver mailbox

**Attack.** An attacker reads the approver's email, opens the notification link, and tries to
approve.

**Controls.** The notification link leads to a page that requires a passkey assertion. Email access
alone produces nothing. The notification deliberately carries a summary rather than the full
protected payload, and no approval control.

**Residual risk.** The attacker learns that a payment is pending and to whom — useful
reconnaissance. Notifications are kept thin for this reason.

---

## T3 — Deepfake call or video

**Attack.** An attacker joins a video call as the CFO and pressures an employee to release a
payment.

**Controls.** None are needed against the media itself. The employee raises a verification request;
the real CFO's passkey is what decides it. Verity never attempts to detect a deepfake, because the
question is made irrelevant rather than answered.

**Residual risk.** An employee can be pressured into skipping Verity entirely. That is a process and
culture problem, and the product's answer is to make verification fast enough that skipping it saves
nothing.

---

## T4 — Details changed after approval

**Attack.** An approval is obtained for account `4821`, and the payment is then made to `9914`.

**Controls.** Every protected field is in the canonical payload and therefore in the hash. The
receipt is bound to that hash. The comparison endpoint reports, field by field, whether the values
about to be used still match, flagging the fields where a change most likely means fraud. The
receipt page states plainly that the approval covers those details and nothing else.

**Residual risk.** Verity cannot see the payment being made. If nobody checks the receipt against
what they type into the bank, the mismatch goes unnoticed. The Gmail panel and the receipt page both
say so explicitly at the moment of use.

---

## T5 — Replay

**Attack.** An attacker captures a valid assertion and replays it.

**Controls, layered:**

- The challenge is a digest over request ID, payload hash, decision, a server nonce, the challenge
  ID and an expiry — so it is meaningful for exactly one decision on one request.
- Challenges are single-use, enforced by a conditional update, and spent *before* verification, so a
  failed attempt cannot be retried against the same challenge.
- Challenges expire in two minutes.
- The request's own nonce means two otherwise identical requests never share a hash.
- WebAuthn signature counters are checked where the authenticator provides them.
- The state transition is conditional on the request still being `PENDING`, so two decisions racing
  cannot both land.

**Residual risk.** A counter that a platform authenticator always reports as zero cannot detect
cloning. This is a WebAuthn-wide limitation; the check only rejects a counter that previously moved
and has gone backwards.

---

## T6 — Stolen session

**Attack.** An attacker obtains a session cookie through XSS, device theft, or a shared machine.

**Controls.** A session cannot approve, deny, or revoke: all three require a fresh passkey
assertion. Cookies are `HttpOnly`, `Secure` and `SameSite=Lax`, with an Origin check behind that.
Sessions are short-lived and re-validated from the database on every request, so disabling the
member ends the session immediately. Failed decision attempts are recorded.

**Residual risk.** A stolen session can *read* requests and receipts for that organization, and can
raise new requests — which still require someone else's passkey to approve. Cancellation is
reachable from a session, but only reduces authority.

---

## T7 — Malicious insider

**Attack.** An authorized approver knowingly approves fraud.

**Controls.** None prevent it, and the product does not pretend otherwise. What exists is
attribution: the decision names them, records which credential signed it, and cannot be edited or
deleted afterwards.

**Residual risk.** Full. Two-person approval is the real mitigation and is out of MVP scope. This is
stated in the PRD as a non-goal and repeated here so it is not mistaken for an oversight.

---

## T8 — Server compromise

**Attack.** An attacker gains control of the Verity backend or its database.

**Controls.** The signing key lives outside source control and can be rotated, with a version
recorded on every receipt. Append-only triggers mean the database role the application uses cannot
rewrite the audit log even directly. Sensitive material is minimised: no private keys, no biometrics,
no full account numbers, no email bodies.

**Residual risk.** Substantial and unavoidable. An attacker holding the signing key can mint
receipts that verify. An attacker with database superuser rights can drop the triggers. Verity does
not claim to survive its own compromise, and no wording in the product should suggest otherwise.

---

## T9 — Compromised or malicious extension

**Attack.** A tampered extension build shows the approver one action while a different one is
authorized, or exfiltrates mailbox contents.

**Controls.** The extension cannot decide anything: it has no approve or deny control, and the
decision page is served by Verity with details loaded from the server. The protected payload and its
hash are built server-side, so the extension cannot choose what gets authorized. It reads only
metadata — never the message body — and its CSP allows `script-src 'self'` with no remote origins.
It holds no token of its own; extension origins are allow-listed explicitly by ID, with no wildcard.

**Residual risk.** A compromised extension can still read Gmail metadata and could mislead the
*requester* about what they are entering. The approver's independent view of the details is the
backstop.

---

## T10 — Cross-tenant access

**Attack.** A member of one organization guesses or enumerates identifiers belonging to another.

**Controls.** Every organization-scoped operation goes through `requireMembership`, which uses the
supplied ID only as a lookup key against the caller's own memberships. Records are always loaded
with `organizationId` selected and checked. Foreign and non-existent records produce byte-identical
"not found" responses, so existence cannot be probed. Attempts are recorded as
`AUTHORIZATION_FAILURE`.

**Residual risk.** Low. Asserted directly in `tests/integration/organization-isolation.test.ts`,
including that the two error responses are indistinguishable.

---

## T11 — Invitation abuse

**Attack.** An attacker obtains an invitation link — forwarded, intercepted, or from a leaked log —
and joins an organization.

**Controls.** Only the SHA-256 hash of the token is stored, and it is never written to a log or an
audit record. The invitation is bound to the invited email address: the signed-in account's verified
address must match, so possession of the link is not enough. Tokens are single-use via a conditional
update, expire in seven days, and are replaced on resend. Redemption is rate-limited.

**Residual risk.** If an attacker controls the invited mailbox itself, they can join — but that is
T1 and T2, and the role they receive still cannot approve without a passkey.

---

## T12 — Denial of service and resource exhaustion

**Attack.** Flooding sign-in, decision, or request-creation endpoints.

**Controls.** Fixed-window rate limits on sign-in, passkey ceremonies, decisions, invitation
redemption and request creation. The limiter's key table is bounded so a flood of distinct keys
cannot exhaust memory. Body sizes are bounded by schema.

**Residual risk.** The limiter is in-process. Behind more than one instance each keeps its own
count, and it offers no protection against a distributed attacker. This is stated in
`SECURITY.md` as a known limitation with a defined resolution.

---

## Assumptions

If any of these is false, the analysis above weakens:

1. The approver's device and authenticator are not compromised.
2. TLS is terminated correctly and the origin is served over HTTPS in production.
3. `RECEIPT_SIGNING_KEY` and `AUTH_SECRET` are held in a secret manager and not in source control.
4. The database is reachable only by the application, over an encrypted connection.
5. Administrators are trusted to manage membership honestly.
6. Email delivery is not silently dropped — a missing provider key stops the server rather than
   letting notifications vanish.

## Review status

This model has **not** yet been reviewed by an independent technical reviewer. PRD section 32 lists
that as a launch criterion, and it remains outstanding.
