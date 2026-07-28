-- Server-side store for WebAuthn registration and re-authentication challenges.
--
-- PRD 14.2 requires that registration challenges expire and are single use.
-- Neither is possible without server state, so the challenge is issued here,
-- looked up on verification, and marked used in the same transaction.

-- CreateEnum
CREATE TYPE "WebAuthnChallengeType" AS ENUM ('REGISTRATION', 'AUTHENTICATION');

-- CreateTable
CREATE TABLE "webauthn_challenges" (
    "id" TEXT NOT NULL DEFAULT ('wac_' || replace(gen_random_uuid()::text, '-', '')),
    "user_id" TEXT NOT NULL,
    "type" "WebAuthnChallengeType" NOT NULL,
    "challenge" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webauthn_challenges_pkey" PRIMARY KEY ("id")
);

-- A challenge may be presented exactly once. The unique index makes that a
-- database guarantee rather than an application convention.
CREATE UNIQUE INDEX "webauthn_challenges_challenge_key" ON "webauthn_challenges"("challenge");
CREATE INDEX "webauthn_challenges_user_id_type_idx" ON "webauthn_challenges"("user_id", "type");
CREATE INDEX "webauthn_challenges_expires_at_idx" ON "webauthn_challenges"("expires_at");

-- AddForeignKey
ALTER TABLE "webauthn_challenges" ADD CONSTRAINT "webauthn_challenges_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
