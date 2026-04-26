-- +goose Up
-- Migration 06: Views and sequences
CREATE VIEW active_users AS
  SELECT id, email, name, created_at
  FROM users
  WHERE status = 'active';

CREATE VIEW api.order_summary AS
  SELECT o.id, u.email AS user_email, o.total_cents, o.status, o.created_at
  FROM orders o
  JOIN users u ON u.id = o.user_id;

CREATE SEQUENCE invoice_number_seq START 10000 INCREMENT 1 MINVALUE 10000 NO MAXVALUE;
-- +goose Down
-- (down migration omitted for testing)
