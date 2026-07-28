-- Row-level triggers do not fire for TRUNCATE, so the append-only guarantee
-- added in `20260727000100_append_only_records` had a hole: a single TRUNCATE
-- would still erase the audit trail. Statement-level triggers close it.

CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON "audit_events"
  FOR EACH STATEMENT EXECUTE FUNCTION verity_reject_mutation();

CREATE TRIGGER receipts_no_truncate
  BEFORE TRUNCATE ON "receipts"
  FOR EACH STATEMENT EXECUTE FUNCTION verity_reject_mutation();

CREATE TRIGGER decisions_no_truncate
  BEFORE TRUNCATE ON "decisions"
  FOR EACH STATEMENT EXECUTE FUNCTION verity_reject_mutation();

CREATE TRIGGER revocations_no_truncate
  BEFORE TRUNCATE ON "revocations"
  FOR EACH STATEMENT EXECUTE FUNCTION verity_reject_mutation();
