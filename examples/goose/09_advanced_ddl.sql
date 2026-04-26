-- +goose Up
-- Migration 09: Advanced DDL - partitions, RLS, domains, generated columns, inheritance
CREATE TABLE measurements (
  id bigserial,
  sensor_id integer NOT NULL,
  measured_at timestamptz NOT NULL,
  value double precision,
  PRIMARY KEY (id, measured_at)
) PARTITION BY RANGE (measured_at);

CREATE TABLE measurements_2025 PARTITION OF measurements
  FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');

CREATE TABLE measurements_2026 PARTITION OF measurements
  FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');

ALTER TABLE orders ADD COLUMN total_display text
  GENERATED ALWAYS AS (total_cents::text) STORED;

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_sees_own_orders ON orders
  FOR SELECT
  USING (user_id = current_setting('app.current_user_id', true)::bigint);

CREATE DOMAIN email_address AS varchar(255)
  CHECK (VALUE ~ '^[^@]+@[^@]+\.[^@]+$');

CREATE TYPE address AS (
  street text,
  city text,
  postcode varchar(10),
  country varchar(2)
);

CREATE TABLE audit.order_events (
  event_type text NOT NULL,
  order_id bigint NOT NULL
) INHERITS (audit.events);
-- +goose Down
-- (down migration omitted for testing)
