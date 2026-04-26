-- +goose Up
-- Migration 08: Renames, drops, enum changes
-- Must drop views depending on the column before renaming
DROP VIEW IF EXISTS active_users;
DROP VIEW IF EXISTS api.order_summary;

ALTER TABLE users RENAME COLUMN name TO full_name;

-- Rename then alter on renamed column (silent-failure sequence F1)
ALTER TABLE users ALTER COLUMN full_name SET DEFAULT 'Unnamed';

ALTER TYPE order_status ADD VALUE 'refunded' AFTER 'cancelled';
ALTER TYPE priority_level RENAME VALUE 'critical' TO 'urgent';

DROP INDEX IF EXISTS idx_orders_user;

ALTER TABLE users DROP COLUMN phone;

-- Recreate views with new column name
CREATE VIEW active_users AS
  SELECT id, email, full_name, verified, created_at
  FROM users
  WHERE status = 'active';

CREATE VIEW api.order_summary AS
  SELECT o.id, u.email AS user_email, o.total_cents, o.status, o.created_at
  FROM orders o
  JOIN users u ON u.id = o.user_id;
-- +goose Down
-- (down migration omitted for testing)
