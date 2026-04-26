-- Migration 04: Additional constraints and indices
ALTER TABLE orders ADD CONSTRAINT fk_orders_org
  FOREIGN KEY (org_id) REFERENCES organisations(id) ON DELETE SET NULL ON UPDATE RESTRICT;

ALTER TABLE orders ADD CONSTRAINT uq_orders_user_status
  UNIQUE (user_id, status);

CREATE INDEX idx_orders_user ON orders (user_id);
CREATE UNIQUE INDEX idx_users_email_lower ON users (lower(email));
CREATE INDEX idx_active_orders ON orders (user_id) WHERE status != 'cancelled';
CREATE INDEX idx_users_metadata ON users USING gin (metadata);
CREATE INDEX idx_orders_recent ON orders (user_id, created_at DESC);
CREATE INDEX idx_audit_events_table ON audit.events (table_name, created_at DESC);
