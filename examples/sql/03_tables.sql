-- Migration 03: Core tables
CREATE TABLE users (
  id bigserial PRIMARY KEY,
  email varchar(255) NOT NULL UNIQUE,
  name text DEFAULT '',
  status user_status NOT NULL DEFAULT 'active',
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organisations (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  parent_id bigint REFERENCES organisations(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id bigint REFERENCES organisations(id) ON DELETE SET NULL,
  total_cents integer NOT NULL DEFAULT 0,
  status order_status NOT NULL DEFAULT 'pending',
  priority priority_level NOT NULL DEFAULT 'medium',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (total_cents >= 0)
);

CREATE TABLE user_roles (
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id bigint NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE audit.events (
  id bigserial PRIMARY KEY,
  table_name text NOT NULL,
  action text NOT NULL,
  row_id bigint,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
