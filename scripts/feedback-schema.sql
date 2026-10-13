BEGIN;

ALTER TABLE account_sessions DROP CONSTRAINT IF EXISTS account_sessions_account_role_check;
ALTER TABLE account_sessions ADD CONSTRAINT account_sessions_account_role_check
  CHECK (account_role IN ('customer', 'provider', 'admin'));

ALTER TABLE admin_feedback
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'general' CHECK (source IN ('general', 'system')),
  ADD COLUMN IF NOT EXISTS rating SMALLINT CHECK (rating BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS submitted_role TEXT CHECK (submitted_role IN ('customer', 'provider')),
  ADD COLUMN IF NOT EXISTS submission_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS admin_feedback_submission_id ON admin_feedback (submission_id);
CREATE INDEX IF NOT EXISTS admin_feedback_system_customer ON admin_feedback (customer_id, created_at DESC) WHERE source = 'system';
CREATE INDEX IF NOT EXISTS admin_feedback_system_provider ON admin_feedback (provider_id, created_at DESC) WHERE source = 'system';

COMMIT;
