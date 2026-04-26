-- Migration 10: Multi-command ALTER, schema moves, cleanup
ALTER TABLE users
  ADD COLUMN last_login timestamptz,
  ADD COLUMN login_count integer DEFAULT 0,
  DROP COLUMN IF EXISTS verified_at,
  ALTER COLUMN email SET NOT NULL;

CREATE TABLE api.tokens (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tokens_user ON api.tokens (user_id);
CREATE INDEX idx_tokens_expires ON api.tokens (expires_at);

COMMENT ON TABLE api.tokens IS 'API authentication tokens';

-- Replace view with updated columns
DROP VIEW IF EXISTS api.order_summary;
CREATE VIEW api.order_summary AS
  SELECT o.id, u.email AS user_email, u.full_name AS user_name,
         o.total_cents, o.status, o.priority, o.notes, o.created_at
  FROM orders o
  JOIN users u ON u.id = o.user_id
  WHERE o.status != 'cancelled';
