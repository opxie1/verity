-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED', 'PENDING');

-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('ORG_ADMIN', 'REQUESTER', 'APPROVER', 'AUDITOR');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "ActionType" AS ENUM ('PAYMENT_REQUEST', 'BANK_ACCOUNT_CHANGE', 'PAYROLL_CHANGE', 'ACCESS_CHANGE', 'CONFIDENTIAL_DATA_DISCLOSURE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'DENIED', 'EXPIRED', 'CANCELED', 'REVOKED');

-- CreateEnum
CREATE TYPE "DecisionType" AS ENUM ('APPROVE', 'DENY', 'REVOKE');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('GMAIL', 'MANUAL', 'API');

-- CreateEnum
CREATE TYPE "AuditEventType" AS ENUM ('ORGANIZATION_CREATED', 'ORGANIZATION_SETTINGS_UPDATED', 'POLICY_UPDATED', 'INVITATION_CREATED', 'INVITATION_RESENT', 'INVITATION_REVOKED', 'INVITATION_ACCEPTED', 'ROLE_CHANGED', 'USER_DISABLED', 'USER_REACTIVATED', 'PASSKEY_ADDED', 'PASSKEY_REMOVED', 'REQUEST_CREATED', 'REQUEST_SUBMITTED', 'REQUEST_VIEWED', 'REQUEST_APPROVED', 'REQUEST_DENIED', 'REQUEST_EXPIRED', 'REQUEST_CANCELED', 'APPROVAL_REVOKED', 'RECEIPT_VIEWED', 'FAILED_APPROVAL_ATTEMPT', 'AUTHORIZATION_FAILURE');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL DEFAULT ('usr_' || replace(gen_random_uuid()::text, '-', '')),
    "email" TEXT NOT NULL,
    "display_name" TEXT,
    "email_verified_at" TIMESTAMP(3),
    "image" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL DEFAULT ('acct_' || replace(gen_random_uuid()::text, '-', '')),
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL DEFAULT ('sess_' || replace(gen_random_uuid()::text, '-', '')),
    "session_token" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL DEFAULT ('org_' || replace(gen_random_uuid()::text, '-', '')),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "domain" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "id" TEXT NOT NULL DEFAULT ('mem_' || replace(gen_random_uuid()::text, '-', '')),
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL,
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" TEXT NOT NULL DEFAULT ('inv_' || replace(gen_random_uuid()::text, '-', '')),
    "organization_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "invited_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_policies" (
    "id" TEXT NOT NULL DEFAULT ('pol_' || replace(gen_random_uuid()::text, '-', '')),
    "organization_id" TEXT NOT NULL,
    "allow_self_approval" BOOLEAN NOT NULL DEFAULT false,
    "default_expiration_minutes" INTEGER NOT NULL DEFAULT 60,
    "maximum_expiration_minutes" INTEGER NOT NULL DEFAULT 1440,
    "require_passkey_enrollment" BOOLEAN NOT NULL DEFAULT true,
    "verification_recommended_threshold_minor" BIGINT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passkey_credentials" (
    "id" TEXT NOT NULL DEFAULT ('cred_' || replace(gen_random_uuid()::text, '-', '')),
    "user_id" TEXT NOT NULL,
    "credential_id" TEXT NOT NULL,
    "public_key" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "device_type" TEXT,
    "backed_up" BOOLEAN NOT NULL DEFAULT false,
    "label" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "passkey_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_requests" (
    "id" TEXT NOT NULL DEFAULT ('req_' || replace(gen_random_uuid()::text, '-', '')),
    "organization_id" TEXT NOT NULL,
    "requester_user_id" TEXT NOT NULL,
    "assigned_approver_user_id" TEXT NOT NULL,
    "action_type" "ActionType" NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'DRAFT',
    "display_title" TEXT NOT NULL,
    "display_summary" TEXT NOT NULL,
    "protected_payload_json" JSONB NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "nonce" TEXT NOT NULL,
    "source_type" "SourceType" NOT NULL DEFAULT 'MANUAL',
    "source_message_id" TEXT,
    "source_thread_id" TEXT,
    "source_sender_email" TEXT,
    "source_subject" TEXT,
    "source_url" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "denied_at" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_challenges" (
    "id" TEXT NOT NULL DEFAULT ('chl_' || replace(gen_random_uuid()::text, '-', '')),
    "request_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "decision" "DecisionType" NOT NULL,
    "challenge_hash" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decisions" (
    "id" TEXT NOT NULL DEFAULT ('dec_' || replace(gen_random_uuid()::text, '-', '')),
    "request_id" TEXT NOT NULL,
    "approver_user_id" TEXT NOT NULL,
    "credential_id" TEXT NOT NULL,
    "decision" "DecisionType" NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "webauthn_assertion_metadata_json" JSONB NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" TEXT NOT NULL DEFAULT ('rcpt_' || replace(gen_random_uuid()::text, '-', '')),
    "request_id" TEXT NOT NULL,
    "receipt_payload_json" JSONB NOT NULL,
    "receipt_payload_hash" TEXT NOT NULL,
    "server_signature" TEXT NOT NULL,
    "signing_key_version" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revocations" (
    "id" TEXT NOT NULL DEFAULT ('rev_' || replace(gen_random_uuid()::text, '-', '')),
    "request_id" TEXT NOT NULL,
    "revoked_by_user_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "credential_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL DEFAULT ('evt_' || replace(gen_random_uuid()::text, '-', '')),
    "organization_id" TEXT,
    "actor_user_id" TEXT,
    "event_type" "AuditEventType" NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "previous_state" TEXT,
    "new_state" TEXT,
    "request_correlation_id" TEXT,
    "ip_hash" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_provider_account_id_key" ON "accounts"("provider", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_session_token_key" ON "sessions"("session_token");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "verification_tokens"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "organization_members_organization_id_role_idx" ON "organization_members"("organization_id", "role");

-- CreateIndex
CREATE INDEX "organization_members_user_id_idx" ON "organization_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_organization_id_user_id_key" ON "organization_members"("organization_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_organization_id_email_idx" ON "invitations"("organization_id", "email");

-- CreateIndex
CREATE INDEX "invitations_email_idx" ON "invitations"("email");

-- CreateIndex
CREATE UNIQUE INDEX "organization_policies_organization_id_key" ON "organization_policies"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "passkey_credentials_credential_id_key" ON "passkey_credentials"("credential_id");

-- CreateIndex
CREATE INDEX "passkey_credentials_user_id_idx" ON "passkey_credentials"("user_id");

-- CreateIndex
CREATE INDEX "verification_requests_organization_id_status_idx" ON "verification_requests"("organization_id", "status");

-- CreateIndex
CREATE INDEX "verification_requests_organization_id_created_at_idx" ON "verification_requests"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "verification_requests_assigned_approver_user_id_status_idx" ON "verification_requests"("assigned_approver_user_id", "status");

-- CreateIndex
CREATE INDEX "verification_requests_requester_user_id_idx" ON "verification_requests"("requester_user_id");

-- CreateIndex
CREATE INDEX "verification_requests_source_thread_id_idx" ON "verification_requests"("source_thread_id");

-- CreateIndex
CREATE INDEX "verification_requests_status_expires_at_idx" ON "verification_requests"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "approval_challenges_challenge_hash_key" ON "approval_challenges"("challenge_hash");

-- CreateIndex
CREATE INDEX "approval_challenges_request_id_idx" ON "approval_challenges"("request_id");

-- CreateIndex
CREATE INDEX "approval_challenges_expires_at_idx" ON "approval_challenges"("expires_at");

-- CreateIndex
CREATE INDEX "decisions_request_id_idx" ON "decisions"("request_id");

-- CreateIndex
CREATE INDEX "decisions_approver_user_id_idx" ON "decisions"("approver_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_request_id_key" ON "receipts"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "revocations_request_id_key" ON "revocations"("request_id");

-- CreateIndex
CREATE INDEX "audit_events_organization_id_created_at_idx" ON "audit_events"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_target_type_target_id_idx" ON "audit_events"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "audit_events_event_type_idx" ON "audit_events"("event_type");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_policies" ADD CONSTRAINT "organization_policies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passkey_credentials" ADD CONSTRAINT "passkey_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_requester_user_id_fkey" FOREIGN KEY ("requester_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_assigned_approver_user_id_fkey" FOREIGN KEY ("assigned_approver_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_challenges" ADD CONSTRAINT "approval_challenges_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "verification_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_challenges" ADD CONSTRAINT "approval_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "verification_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_approver_user_id_fkey" FOREIGN KEY ("approver_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_credential_id_fkey" FOREIGN KEY ("credential_id") REFERENCES "passkey_credentials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "verification_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revocations" ADD CONSTRAINT "revocations_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "verification_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revocations" ADD CONSTRAINT "revocations_revoked_by_user_id_fkey" FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
