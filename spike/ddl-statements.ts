// spike/ddl-statements.ts
// All 39 DDL statements from Plans/migration-state-implementation-plan.md
// Some numbered items contain multiple SQL statements, giving 47 total test cases.

// === Core table operations ===

/** DDL #1: Basic CREATE TABLE with inline constraints */
export const DDL_01_CREATE_TABLE = `CREATE TABLE users (
  id bigserial PRIMARY KEY,
  email varchar(255) NOT NULL UNIQUE,
  name text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);`;

/** DDL #2: ADD COLUMN */
export const DDL_02_ADD_COLUMN = `ALTER TABLE users ADD COLUMN phone varchar(20);`;

/** DDL #3: DROP COLUMN */
export const DDL_03_DROP_COLUMN = `ALTER TABLE users DROP COLUMN phone;`;

/** DDL #4: ALTER COLUMN TYPE */
export const DDL_04_ALTER_TYPE = `ALTER TABLE users ALTER COLUMN name TYPE varchar(500);`;

/** DDL #5: RENAME COLUMN */
export const DDL_05_RENAME_COLUMN = `ALTER TABLE users RENAME COLUMN name TO full_name;`;

/** DDL #6a: SET NOT NULL */
export const DDL_06A_SET_NOT_NULL = `ALTER TABLE users ALTER COLUMN full_name SET NOT NULL;`;

/** DDL #6b: SET DEFAULT */
export const DDL_06B_SET_DEFAULT = `ALTER TABLE users ALTER COLUMN full_name SET DEFAULT 'Unknown';`;

/** DDL #6c: DROP DEFAULT */
export const DDL_06C_DROP_DEFAULT = `ALTER TABLE users ALTER COLUMN full_name DROP DEFAULT;`;

// === Foreign keys and relationships ===

/** DDL #7: One-to-many with inline FK */
export const DDL_07_FK_INLINE = `CREATE TABLE orders (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  total_cents integer NOT NULL DEFAULT 0,
  status varchar(20) NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);`;

/** DDL #8: Named foreign key via ALTER TABLE */
export const DDL_08_FK_NAMED = `ALTER TABLE orders ADD CONSTRAINT fk_orders_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE RESTRICT;`;

/** DDL #9: Many-to-many join table with composite PK */
export const DDL_09_COMPOSITE_PK = `CREATE TABLE user_roles (
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id bigint NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);`;

/** DDL #10: Self-referential FK */
export const DDL_10_SELF_REF_FK = `CREATE TABLE organisations (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  parent_id bigint REFERENCES organisations(id) ON DELETE SET NULL
);`;

// === Constraints ===

/** DDL #11: UNIQUE constraint (multi-column) */
export const DDL_11_UNIQUE_MULTI = `ALTER TABLE orders ADD CONSTRAINT uq_orders_user_status
  UNIQUE (user_id, status);`;

/** DDL #12: CHECK constraint */
export const DDL_12_CHECK = `ALTER TABLE orders ADD CONSTRAINT chk_total_positive
  CHECK (total_cents >= 0);`;

/** DDL #13: EXCLUDE constraint */
export const DDL_13_EXCLUDE = `CREATE TABLE reservations (
  id bigserial PRIMARY KEY,
  room_id integer NOT NULL,
  during tstzrange NOT NULL,
  EXCLUDE USING gist (room_id WITH =, during WITH &&)
);`;

// === Indices ===

/** DDL #14a: Basic index */
export const DDL_14A_INDEX_BASIC = `CREATE INDEX idx_orders_user ON orders (user_id);`;

/** DDL #14b: Unique expression index */
export const DDL_14B_INDEX_EXPR = `CREATE UNIQUE INDEX idx_users_email_lower ON users (lower(email));`;

/** DDL #15: Partial index */
export const DDL_15_PARTIAL_INDEX = `CREATE INDEX idx_active_orders ON orders (user_id) WHERE status != 'cancelled';`;

/** DDL #16a: ADD jsonb COLUMN */
export const DDL_16A_ADD_JSONB = `ALTER TABLE users ADD COLUMN metadata jsonb DEFAULT '{}';`;

/** DDL #16b: GIN index on jsonb */
export const DDL_16B_GIN_INDEX = `CREATE INDEX idx_users_metadata ON users USING gin (metadata);`;

/** DDL #17: Multi-column index with sort direction */
export const DDL_17_MULTI_COL_INDEX = `CREATE INDEX idx_orders_recent ON orders (user_id, created_at DESC);`;

/** DDL #18: DROP INDEX */
export const DDL_18_DROP_INDEX = `DROP INDEX IF EXISTS idx_orders_user;`;

// === Enums and custom types ===

/** DDL #19: CREATE TYPE AS ENUM */
export const DDL_19_CREATE_ENUM = `CREATE TYPE order_status AS ENUM ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled');`;

/** DDL #20: ALTER TYPE ADD VALUE */
export const DDL_20_ALTER_ENUM = `ALTER TYPE order_status ADD VALUE 'refunded' AFTER 'cancelled';`;

/** DDL #21: Composite type */
export const DDL_21_COMPOSITE_TYPE = `CREATE TYPE address AS (
  street text,
  city text,
  postcode varchar(10),
  country varchar(2)
);`;

// === Triggers and functions ===

/** DDL #22: Trigger function with dollar-quoted body */
export const DDL_22_FUNCTION = `CREATE OR REPLACE FUNCTION update_modified_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;`;

/** DDL #23: BEFORE UPDATE trigger */
export const DDL_23_TRIGGER = `CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION update_modified_at();`;

/** DDL #24: Conditional trigger with WHEN clause */
export const DDL_24_TRIGGER_WHEN = `CREATE TRIGGER audit_status_change
  AFTER UPDATE OF status ON orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION log_status_change();`;

// === Schema and namespace operations ===

/** DDL #25: CREATE SCHEMA */
export const DDL_25_CREATE_SCHEMA = `CREATE SCHEMA IF NOT EXISTS audit;`;

/** DDL #26: Table in non-public schema */
export const DDL_26_SCHEMA_TABLE = `CREATE TABLE audit.events (
  id bigserial PRIMARY KEY,
  table_name text NOT NULL,
  action text NOT NULL,
  payload jsonb,
  created_at timestamptz DEFAULT now()
);`;

/** DDL #27: Move table between schemas */
export const DDL_27_SET_SCHEMA = `ALTER TABLE events SET SCHEMA audit;`;

// === Views and sequences ===

/** DDL #28: CREATE VIEW */
export const DDL_28_CREATE_VIEW = `CREATE VIEW active_users AS
  SELECT id, email, full_name FROM users WHERE full_name IS NOT NULL;`;

/** DDL #29: CREATE OR REPLACE VIEW */
export const DDL_29_REPLACE_VIEW = `CREATE OR REPLACE VIEW active_users AS
  SELECT id, email, full_name, created_at FROM users WHERE full_name IS NOT NULL;`;

/** DDL #30: Sequence with options */
export const DDL_30_SEQUENCE = `CREATE SEQUENCE invoice_number_seq START 10000 INCREMENT 1 MINVALUE 10000 NO MAXVALUE;`;

// === Obscure but real-world features ===

/** DDL #31: Partitioned table */
export const DDL_31_PARTITION_BY = `CREATE TABLE measurements (
  id bigserial,
  sensor_id integer NOT NULL,
  measured_at timestamptz NOT NULL,
  value double precision,
  PRIMARY KEY (id, measured_at)
) PARTITION BY RANGE (measured_at);`;

/** DDL #32: Partition child table */
export const DDL_32_PARTITION_OF = `CREATE TABLE measurements_2025 PARTITION OF measurements
  FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');`;

/** DDL #33: Generated column */
export const DDL_33_GENERATED_COL = `ALTER TABLE orders ADD COLUMN total_display text
  GENERATED ALWAYS AS ('$' || (total_cents / 100)::text) STORED;`;

/** DDL #34a: Enable RLS */
export const DDL_34A_ENABLE_RLS = `ALTER TABLE orders ENABLE ROW LEVEL SECURITY;`;

/** DDL #34b: CREATE POLICY */
export const DDL_34B_CREATE_POLICY = `CREATE POLICY user_sees_own_orders ON orders
  FOR SELECT
  USING (user_id = current_setting('app.current_user_id')::bigint);`;

/** DDL #35a: Extension uuid-ossp */
export const DDL_35A_EXTENSION_UUID = `CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`;

/** DDL #35b: Extension pgcrypto */
export const DDL_35B_EXTENSION_PGCRYPTO = `CREATE EXTENSION IF NOT EXISTS pgcrypto;`;

/** DDL #36a: COMMENT ON TABLE */
export const DDL_36A_COMMENT_TABLE = `COMMENT ON TABLE users IS 'Core user accounts table';`;

/** DDL #36b: COMMENT ON COLUMN */
export const DDL_36B_COMMENT_COLUMN = `COMMENT ON COLUMN users.email IS 'Primary login identifier, must be unique';`;

/** DDL #37: Table inheritance */
export const DDL_37_INHERITS = `CREATE TABLE audit.order_events (
  event_type text NOT NULL,
  order_id bigint NOT NULL
) INHERITS (audit.events);`;

/** DDL #38: Domain type */
export const DDL_38_DOMAIN = `CREATE DOMAIN email_address AS varchar(255)
  CHECK (VALUE ~ '^[^@]+@[^@]+\\.[^@]+$');`;

/** DDL #39: Multi-command ALTER TABLE */
export const DDL_39_MULTI_ALTER = `ALTER TABLE users
  ADD COLUMN verified boolean DEFAULT false,
  ADD COLUMN verified_at timestamptz,
  DROP COLUMN IF EXISTS legacy_field,
  ALTER COLUMN email SET NOT NULL;`;

// === Aggregate exports ===

export interface DdlTestCase {
  id: string;
  sql: string;
  description: string;
  expectation: string;
  mandatory: boolean;
}

export const ALL_DDL: DdlTestCase[] = [
  { id: "01", sql: DDL_01_CREATE_TABLE, description: "Basic CREATE TABLE", expectation: "4 columns, types, PK + UNIQUE", mandatory: true },
  { id: "02", sql: DDL_02_ADD_COLUMN, description: "ADD COLUMN", expectation: "table, column, type", mandatory: true },
  { id: "03", sql: DDL_03_DROP_COLUMN, description: "DROP COLUMN", expectation: "table, column", mandatory: true },
  { id: "04", sql: DDL_04_ALTER_TYPE, description: "ALTER COLUMN TYPE", expectation: "table, column, new type", mandatory: true },
  { id: "05", sql: DDL_05_RENAME_COLUMN, description: "RENAME COLUMN", expectation: "table, old name, new name", mandatory: true },
  { id: "06a", sql: DDL_06A_SET_NOT_NULL, description: "SET NOT NULL", expectation: "distinct operation", mandatory: true },
  { id: "06b", sql: DDL_06B_SET_DEFAULT, description: "SET DEFAULT", expectation: "distinct operation", mandatory: true },
  { id: "06c", sql: DDL_06C_DROP_DEFAULT, description: "DROP DEFAULT", expectation: "distinct operation", mandatory: true },
  { id: "07", sql: DDL_07_FK_INLINE, description: "Inline FK", expectation: "FK ref, ON DELETE", mandatory: true },
  { id: "08", sql: DDL_08_FK_NAMED, description: "Named FK constraint", expectation: "name, ON DELETE + ON UPDATE", mandatory: true },
  { id: "09", sql: DDL_09_COMPOSITE_PK, description: "Composite PK + FKs", expectation: "2-col PK, two FKs", mandatory: true },
  { id: "10", sql: DDL_10_SELF_REF_FK, description: "Self-referential FK", expectation: "FK to same table", mandatory: true },
  { id: "11", sql: DDL_11_UNIQUE_MULTI, description: "Multi-column UNIQUE", expectation: "name, UNIQUE, 2 columns", mandatory: true },
  { id: "12", sql: DDL_12_CHECK, description: "CHECK constraint", expectation: "name, CHECK, expression", mandatory: true },
  { id: "13", sql: DDL_13_EXCLUDE, description: "EXCLUDE constraint", expectation: "USING gist, operator pairs", mandatory: true },
  { id: "14a", sql: DDL_14A_INDEX_BASIC, description: "Basic index", expectation: "name, table, column", mandatory: true },
  { id: "14b", sql: DDL_14B_INDEX_EXPR, description: "Expression index", expectation: "unique, expression", mandatory: true },
  { id: "15", sql: DDL_15_PARTIAL_INDEX, description: "Partial index", expectation: "WHERE condition", mandatory: true },
  { id: "16a", sql: DDL_16A_ADD_JSONB, description: "ADD jsonb column", expectation: "column, type, default", mandatory: true },
  { id: "16b", sql: DDL_16B_GIN_INDEX, description: "GIN index", expectation: "method = gin", mandatory: true },
  { id: "17", sql: DDL_17_MULTI_COL_INDEX, description: "Multi-col index + DESC", expectation: "2 columns, DESC", mandatory: true },
  { id: "18", sql: DDL_18_DROP_INDEX, description: "DROP INDEX IF EXISTS", expectation: "name, IF EXISTS", mandatory: true },
  { id: "19", sql: DDL_19_CREATE_ENUM, description: "CREATE ENUM", expectation: "name, 5 values", mandatory: true },
  { id: "20", sql: DDL_20_ALTER_ENUM, description: "ALTER ENUM ADD VALUE", expectation: "name, value, AFTER", mandatory: true },
  { id: "21", sql: DDL_21_COMPOSITE_TYPE, description: "Composite type", expectation: "name, 4 fields", mandatory: true },
  { id: "22", sql: DDL_22_FUNCTION, description: "CREATE FUNCTION ($$)", expectation: "name, return type, language", mandatory: true },
  { id: "23", sql: DDL_23_TRIGGER, description: "CREATE TRIGGER", expectation: "name, timing, event, table, fn", mandatory: true },
  { id: "24", sql: DDL_24_TRIGGER_WHEN, description: "Trigger with WHEN", expectation: "WHEN clause, UPDATE OF col", mandatory: true },
  { id: "25", sql: DDL_25_CREATE_SCHEMA, description: "CREATE SCHEMA", expectation: "name, IF NOT EXISTS", mandatory: true },
  { id: "26", sql: DDL_26_SCHEMA_TABLE, description: "Schema-qualified table", expectation: "schema = audit", mandatory: true },
  { id: "27", sql: DDL_27_SET_SCHEMA, description: "ALTER SET SCHEMA", expectation: "table, target schema", mandatory: true },
  { id: "28", sql: DDL_28_CREATE_VIEW, description: "CREATE VIEW", expectation: "name, definition SQL", mandatory: true },
  { id: "29", sql: DDL_29_REPLACE_VIEW, description: "CREATE OR REPLACE VIEW", expectation: "OR REPLACE, definition", mandatory: true },
  { id: "30", sql: DDL_30_SEQUENCE, description: "CREATE SEQUENCE", expectation: "name, start, increment, min", mandatory: true },
  { id: "31", sql: DDL_31_PARTITION_BY, description: "PARTITION BY", expectation: "method, column", mandatory: false },
  { id: "32", sql: DDL_32_PARTITION_OF, description: "PARTITION OF", expectation: "parent, range bounds", mandatory: false },
  { id: "33", sql: DDL_33_GENERATED_COL, description: "Generated column", expectation: "expression, STORED", mandatory: false },
  { id: "34a", sql: DDL_34A_ENABLE_RLS, description: "ENABLE RLS", expectation: "RLS flag on table", mandatory: false },
  { id: "34b", sql: DDL_34B_CREATE_POLICY, description: "CREATE POLICY", expectation: "name, FOR, USING", mandatory: false },
  { id: "35a", sql: DDL_35A_EXTENSION_UUID, description: "Extension uuid-ossp", expectation: "name, IF NOT EXISTS", mandatory: false },
  { id: "35b", sql: DDL_35B_EXTENSION_PGCRYPTO, description: "Extension pgcrypto", expectation: "name, IF NOT EXISTS", mandatory: false },
  { id: "36a", sql: DDL_36A_COMMENT_TABLE, description: "COMMENT ON TABLE", expectation: "target=table, text", mandatory: false },
  { id: "36b", sql: DDL_36B_COMMENT_COLUMN, description: "COMMENT ON COLUMN", expectation: "target=column, text", mandatory: false },
  { id: "37", sql: DDL_37_INHERITS, description: "INHERITS", expectation: "parent table", mandatory: false },
  { id: "38", sql: DDL_38_DOMAIN, description: "CREATE DOMAIN", expectation: "name, base type, CHECK", mandatory: false },
  { id: "39", sql: DDL_39_MULTI_ALTER, description: "Multi-command ALTER", expectation: "4 sub-commands", mandatory: false },
];
