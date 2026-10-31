-- Accounts reach the location hubs (E1): the password hash moved from users to accounts, and the
-- snapshot carries the accounts of a location's users. A change to an account (a password reset,
-- an e-mail change) is therefore a configuration change of every tenant where the account has a
-- user, which record_config_change() cannot express (it finds one tenant per row).
--
-- `last_tenant_id` moves on every sign-in and never leaves the cloud, so it is not a change, like
-- `updated_at`. Accounts are created before their users (whose own trigger records that) and are
-- never deleted while a user names them, so only updates matter. Tenants are locked in id order,
-- so two accounts shared by the same brands cannot deadlock.
CREATE FUNCTION record_account_config_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ignored text[] := ARRAY['updated_at', 'last_tenant_id'];
  tid uuid;
BEGIN
  IF (to_jsonb(NEW) - ignored) = (to_jsonb(OLD) - ignored) THEN
    RETURN NULL;
  END IF;
  FOR tid IN
    SELECT DISTINCT tenant_id FROM users WHERE account_id = NEW.id ORDER BY tenant_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('change_log:' || tid::text, 0));
    INSERT INTO change_log (tenant_id, topic) VALUES (tid, 'CONFIG')
      ON CONFLICT (tenant_id, tx_id) WHERE topic = 'CONFIG' DO NOTHING;
  END LOOP;
  RETURN NULL;
END
$$;

CREATE TRIGGER config_change AFTER UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION record_account_config_change();
