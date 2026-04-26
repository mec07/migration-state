# Database Schema State

Generated from 10 migrations (generic) in `examples/flyway`

## Extensions

- `uuid-ossp`
- `pgcrypto`

## Enums

### `address`
Values: `street text`, `city text`, `postcode varchar(10)`, `country varchar(2)`

### `order_status`
Values: `pending`, `confirmed`, `shipped`, `delivered`, `cancelled`, `refunded`

### `priority_level`
Values: `low`, `medium`, `high`, `urgent`

### `user_status`
Values: `active`, `suspended`, `deleted`

## Domains

- `email_address` (varchar(255)) CHECK (expression)

## Tables

### `api.tokens`
API authentication tokens

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | bigint | NO | nextval('tokens_id_seq') |
| user_id | int8 | NO |  |
| token | text | NO |  |
| expires_at | timestamptz | NO |  |
| created_at | timestamptz | NO | now() |

**Constraints:**
- PRIMARY KEY (id)
- FOREIGN KEY (user_id) -> users(id) ON DELETE CASCADE
- UNIQUE (token)

**Indices:**
- `idx_tokens_user` (user_id)
- `idx_tokens_expires` (expires_at)

### `audit.events`
Audit trail for all data changes

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | bigint | NO | nextval('events_id_seq') |
| table_name | text | NO |  |
| action | text | NO |  |
| row_id | int8 | YES |  |
| payload | jsonb | YES |  |
| created_at | timestamptz | NO | now() |

**Constraints:**
- PRIMARY KEY (id)

**Indices:**
- `idx_audit_events_table` (table_name, created_at)

### `audit.order_events`

*Inherits from: `audit.events`*

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| event_type | text | NO |  |
| order_id | int8 | NO |  |

### `measurements`

*Partitioned by RANGE (measured_at)*

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | bigint | NO | nextval('measurements_id_seq') |
| sensor_id | int4 | NO |  |
| measured_at | timestamptz | NO |  |
| value | float8 | YES |  |

**Constraints:**
- PRIMARY KEY (id, measured_at)

### `measurements_2025`

*Partition of `measurements`: FROM ('2025-01-01') TO ('2026-01-01')*

| Column | Type | Nullable | Default |
|--------|------|----------|---------|

### `measurements_2026`

*Partition of `measurements`: FROM ('2026-01-01') TO ('2027-01-01')*

| Column | Type | Nullable | Default |
|--------|------|----------|---------|

### `orders`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | bigint | NO | nextval('orders_id_seq') |
| user_id | int8 | NO |  |
| org_id | int8 | YES |  |
| total_cents | int4 | NO | 0 |
| status | order_status | NO | 'pending' |
| priority | priority_level | NO | 'medium' |
| created_at | timestamptz | NO | now() |
| notes | text | YES |  |
| shipped_at | timestamptz | YES |  |
| total_display | text | YES | GENERATED (expression)::text |

**Constraints:**
- PRIMARY KEY (id)
- FOREIGN KEY (user_id) -> users(id) ON DELETE CASCADE
- FOREIGN KEY (org_id) -> organisations(id) ON DELETE SET NULL
- CHECK (expression)
- `fk_orders_org` FOREIGN KEY (org_id) -> organisations(id) ON DELETE SET NULL ON UPDATE RESTRICT
- `uq_orders_user_status` UNIQUE (user_id, status)

**Indices:**
- `uq_orders_user_status` UNIQUE (user_id, status)
- `idx_active_orders` (user_id) WHERE (expression)
- `idx_orders_recent` (user_id, created_at)

**Triggers:**
- `set_orders_updated_at` BEFORE UPDATE FOR EACH ROW -> update_updated_at()

**Policies:**
- `user_sees_own_orders` FOR select USING (expression)

*Row-level security enabled*

### `organisations`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | bigint | NO | nextval('organisations_id_seq') |
| name | text | NO |  |
| parent_id | int8 | YES |  |
| created_at | timestamptz | NO | now() |

**Constraints:**
- PRIMARY KEY (id)
- FOREIGN KEY (parent_id) -> organisations(id) ON DELETE SET NULL

### `user_roles`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| user_id | int8 | NO |  |
| role_id | int8 | NO |  |
| granted_at | timestamptz | NO | now() |

**Constraints:**
- FOREIGN KEY (user_id) -> users(id) ON DELETE CASCADE
- PRIMARY KEY (user_id, role_id)

### `users`
Core user accounts

| Column | Type | Nullable | Default | Comment |
|--------|------|----------|---------|---------|
| id | bigint | NO | nextval('users_id_seq') |  |
| email | varchar(255) | NO |  | Primary login identifier, must be unique |
| full_name | varchar(500) | NO | 'Unnamed' |  |
| status | user_status | NO | 'active' |  |
| metadata | jsonb | YES | '{}' |  |
| created_at | timestamptz | NO | now() |  |
| updated_at | timestamptz | NO | now() |  |
| verified | bool | YES | false |  |
| last_login | timestamptz | YES |  |  |
| login_count | int4 | YES | 0 |  |

**Constraints:**
- PRIMARY KEY (id)
- UNIQUE (email)

**Indices:**
- `idx_users_email_lower` UNIQUE (lower())
- `idx_users_metadata` gin (metadata)

**Triggers:**
- `set_updated_at` BEFORE UPDATE FOR EACH ROW -> update_updated_at()
- `audit_users` 0 INSERT/UPDATE FOR EACH ROW -> audit.log_change()

## Views

### `active_users`
```sql
-- Recreate views with new column name
CREATE VIEW active_users AS
  SELECT id, email, full_name, verified, created_at
  FROM users
  WHERE status = 'active'
```

### `api.order_summary`
```sql
CREATE VIEW api.order_summary AS
  SELECT o.id, u.email AS user_email, u.full_name AS user_name,
         o.total_cents, o.status, o.priority, o.notes, o.created_at
  FROM orders o
  JOIN users u ON u.id = o.user_id
  WHERE o.status != 'cancelled'
```

## Functions

- `audit.log_change()` -> trigger [plpgsql]
- `update_updated_at()` -> trigger [plpgsql]

## Sequences

- `audit.events_id_seq`
- `invoice_number_seq` START 10000 INCREMENT 1 MIN 10000
- `measurements_id_seq`
- `orders_id_seq`
- `organisations_id_seq`
- `api.tokens_id_seq`
- `users_id_seq`

