-- Append-only enforcement for evidentiary tables (PRD FR-015, 20.11, section 25).
--
-- The application has no update or delete path for these records, but "the
-- application does not do it" is a weaker guarantee than "the database refuses
-- it". These triggers mean that a bug, a stray migration, or an attacker with
-- application-level database credentials still cannot rewrite the history of
-- who approved what.
--
-- Note: this is why `audit_events`, `receipts`, `decisions` and `revocations`
-- reference their parents with ON DELETE RESTRICT rather than CASCADE. A
-- cascade would attempt a DELETE here and abort the whole transaction.

CREATE OR REPLACE FUNCTION verity_reject_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'Table % is append-only; % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION verity_reject_mutation();

CREATE TRIGGER receipts_append_only
  BEFORE UPDATE OR DELETE ON "receipts"
  FOR EACH ROW EXECUTE FUNCTION verity_reject_mutation();

CREATE TRIGGER decisions_append_only
  BEFORE UPDATE OR DELETE ON "decisions"
  FOR EACH ROW EXECUTE FUNCTION verity_reject_mutation();

CREATE TRIGGER revocations_append_only
  BEFORE UPDATE OR DELETE ON "revocations"
  FOR EACH ROW EXECUTE FUNCTION verity_reject_mutation();
