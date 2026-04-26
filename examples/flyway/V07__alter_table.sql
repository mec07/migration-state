-- Migration 07: ALTER TABLE operations
ALTER TABLE users ADD COLUMN phone varchar(20);
ALTER TABLE users ADD COLUMN verified boolean DEFAULT false;
ALTER TABLE users ADD COLUMN verified_at timestamptz;

-- Must drop view before altering column type it depends on
DROP VIEW IF EXISTS active_users;
DROP VIEW IF EXISTS api.order_summary;

ALTER TABLE users ALTER COLUMN name TYPE varchar(500);
ALTER TABLE users ALTER COLUMN name SET NOT NULL;
ALTER TABLE users ALTER COLUMN name SET DEFAULT 'Unknown';

-- Recreate views
CREATE VIEW active_users AS
  SELECT id, email, name, created_at
  FROM users
  WHERE status = 'active';

CREATE VIEW api.order_summary AS
  SELECT o.id, u.email AS user_email, o.total_cents, o.status, o.created_at
  FROM orders o
  JOIN users u ON u.id = o.user_id;

ALTER TABLE orders ADD COLUMN notes text;
ALTER TABLE orders ADD COLUMN shipped_at timestamptz;

COMMENT ON TABLE users IS 'Core user accounts';
COMMENT ON COLUMN users.email IS 'Primary login identifier, must be unique';
COMMENT ON TABLE audit.events IS 'Audit trail for all data changes';
