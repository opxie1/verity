# Implementation checklist

Requirement-by-requirement status against the PRD (section 36.18). Honest about gaps.

**Legend:** ✅ done and tested · 🟡 done, not fully tested · ⬜ not implemented

## Functional requirements

| ID | Requirement | Status | Where |
|---|---|---|---|
| FR-001 | Authentication | ✅ | `apps/web/src/lib/auth.ts`, `session.ts` — email link + optional Google; database sessions; passkeys mandatory for decisions |
| FR-002 | Organization isolation | ✅ | `packages/domain/src/authz/guards.ts`; `tests/integration/organization-isolation.test.ts` |
| FR-003 | Invitation management | ✅ | `invitation-service.ts`; create/resend/revoke/status; `tests/integration/invitations.test.ts` |
| FR-004 | Member management | ✅ | `organization-service.ts`; disabling blocks the next request |
| FR-005 | Passkey management | ✅ | `passkey-service.ts`; add, label, list, remove, backups |
| FR-006 | Request creation | ✅ | `request-service.ts`, `/api/requests` |
| FR-007 | Payload normalization | ✅ | `normalization.ts`; 35 unit tests |
| FR-008 | Request hashing | ✅ | `computePayloadHash`; server-side only; client hashes never read |
| FR-009 | Approver notification | ✅ | `email/templates.ts`; summary and deadline, no protected fields |
| FR-010 | Approval challenge | ✅ | `decisions/challenge.ts`; binds request, payload hash, decision, nonce, challenge ID, expiry |
| FR-011 | Decision verification | ✅ | `decision-service.ts`; every listed check; `tests/integration/decisions.test.ts` |
| FR-012 | Receipt creation | ✅ | `receipts/`; Ed25519, key versioned, key never committed |
| FR-013 | Receipt verification | ✅ | `verifyReceipt`; four server-side checks |
| FR-014 | Gmail extension | 🟡 | `apps/extension/`; MV3, side panel, metadata only, restrictive CSP. **Not yet tested against live Gmail.** |
| FR-015 | Audit logging | ✅ | `audit-service.ts`; all listed events; append-only in the database |
| FR-016 | Expiration processing | ✅ | `effectiveStatus` at read time + `expireLapsedRequests` reconciliation |
| FR-017 | Cancellation | ✅ | Requester only, conditional update, audited |
| FR-018 | Revocation | ✅ | `revocation-service.ts`; passkey-bound; original decision preserved |
| FR-019 | Search and filters | 🟡 | Implemented in `listRequests` and `/api/requests`; the dashboard does not yet expose all filter controls |
| FR-020 | Basic policy controls | ✅ | `OrganizationPolicy`; self-approval, expirations, passkey requirement, threshold |

## Non-functional requirements

| ID | Requirement | Status | Notes |
|---|---|---|---|
| NFR-001 | Security | 🟡 | HTTPS enforced in production config; cookie flags; secrets in env; rate limits; short single-use challenges; server-side authorization. **Rate limiting is in-process only.** |
| NFR-002 | Privacy | ✅ | No biometrics, no full account numbers, no email bodies, hashed IPs, documented Gmail metadata |
| NFR-003 | Reliability | 🟡 | Duplicate approvals impossible; transactional state changes; correlation IDs. **Idempotency keys are specified but not implemented.** |
| NFR-004 | Performance | ⬜ | Not measured. No load testing has been done. |
| NFR-005 | Accessibility | 🟡 | Keyboard navigation, visible focus, status conveyed by glyph and word as well as colour, labelled fields, recoverable passkey errors. **No screen-reader audit performed.** |
| NFR-006 | Maintainability | ✅ | Strict TypeScript throughout, shared Zod schemas, domain logic outside components, migrations, documented environment |

## State machine (PRD 15)

All seven states and exactly the seven permitted transitions, asserted exhaustively over every
state pair in `packages/domain/src/requests/state-machine.test.ts`. Every invalid transition the
PRD names is tested explicitly.

## Testing (PRD 26)

| Area | Status |
|---|---|
| 26.1 Unit — normalization, hashing, minor units, transitions, expiry, roles, receipts, signatures | ✅ 55 tests |
| 26.2 Integration — the 15 listed scenarios | ✅ 106 tests, real PostgreSQL, real ES256 signatures |
| 26.3 End-to-end (Playwright) | ⬜ **Not implemented.** The largest remaining gap. |
| 26.4 Security — IDOR, escalation, tenancy, replay, expired challenges, reused tokens, malformed assertions, altered payloads, unauthorized receipts | ✅ covered across the integration suites |

Of the 15 integration scenarios in PRD 26.2, 14 are covered directly. Scenario 4 (passkey
registration) is covered at the challenge and storage level rather than through a full attestation
ceremony, which needs a browser.

## Launch criteria (PRD 32)

| Criterion | Status |
|---|---|
| Organization separation tested | ✅ |
| Passkey registration works on major browsers | ⬜ Not verified — needs real browser testing |
| Replay attacks prevented | ✅ |
| Approval challenges expire | ✅ two minutes |
| Payload normalization deterministic | ✅ |
| Receipts signed and verified | ✅ |
| Approved requests cannot be edited | ✅ |
| Audit events recorded | ✅ |
| Cancel, deny, expire, revoke all work | ✅ |
| Gmail extension permissions minimised | ✅ `sidePanel`, `storage`, two host permissions |
| Privacy notice exists | ✅ `/privacy` |
| Critical errors monitored | ⬜ Correlation IDs and structured logging only; no monitoring service wired |
| No production secrets committed | ✅ |
| Backup and recovery documented | ⬜ Not written |
| Independent security review | ⬜ Not done |

## Definition of done (PRD 37)

| Step | Status |
|---|---|
| 1. Register | ✅ |
| 2. Invite two users | ✅ |
| 3. Register passkeys | ✅ |
| 4. Install the Gmail extension | 🟡 Builds and loads unpacked; not exercised against live Gmail |
| 5. Open an email | 🟡 Same |
| 6. Create a structured payment request | ✅ |
| 7. Send to an authorized approver | ✅ |
| 8. Approve or deny with a passkey | ✅ |
| 9. See the result in Gmail | 🟡 Implemented; untested against live Gmail |
| 10. Inspect a signed receipt | ✅ |
| 11. Detect changed request details | ✅ |
| 12. Cancel, expire, revoke | ✅ |
| 13. Review the audit history | ✅ |
| 14. No money moved, no biometrics received | ✅ by construction |

## Deviations from the PRD

Each is deliberate, and each is a narrowing or an addition rather than a contradiction.

1. **`WebAuthnChallenge` table added.** Not in PRD section 20, but its acceptance criteria require
   registration challenges to expire and be single-use, which needs server-side state. Decision
   challenges remain in `ApprovalChallenge` as specified.
2. **Optional fields that are blank are omitted from the payload, not stored as null.** PRD FR-007
   says "explicit null handling"; storing an explicit null would give an omitted memo and a blank
   memo different hashes, which is worse. Reserved identity keys keep their explicit nulls.
3. **Revocation is allowed to administrators as well as the original approver.** PRD 14.6 says
   "the original approver or an administrator with explicit permission"; there is no
   explicit-permission concept in the policy model, so the administrator role itself is the gate.
   It still requires their own passkey and is recorded under their own name.
4. **Denials produce receipts too.** The PRD focuses on approval receipts. "Jane refused this" is
   evidence worth being able to prove, and PRD section 31's demo depends on showing it.
5. **The extension does not render approve or deny.** PRD 23.4 describes panel states, all of which
   exist; the decision itself happens on the Verity page, as PRD 18.9 requires.
6. **Product name.** The PRD header gives the working name as *verity*; the body text still says
   *ProofApprove*. Built as **Verity**.

## Known gaps, in priority order

1. **No Playwright end-to-end suite** (PRD 26.3). Ceremonies are covered by integration tests with
   a software authenticator, which is strong evidence but not the same as a real browser.
2. **The Gmail extension has never run against live Gmail.** The DOM selectors are the fragile part
   and need verification.
3. **Rate limiting does not survive horizontal scaling.**
4. **No error monitoring service** is wired up.
5. **Idempotency keys** are specified in PRD section 21 but not implemented.
6. **No backup and recovery documentation.**
7. **No independent security review** (PRD 32).
