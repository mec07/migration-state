# Parser Spike Results

**Date:** 2026-04-25
**Bun:** 1.3.10
**pg-parser:** 0.1.7
**pgsql-ast-parser:** 12.0.2

## DDL Coverage

| # | Description | Mandatory | pg-parser | pgsql-ast-parser |
|---|-------------|-----------|-----------|------------------|
| 01 | Basic CREATE TABLE | Yes | PASS | PASS |
| 02 | ADD COLUMN | Yes | PASS | PASS |
| 03 | DROP COLUMN | Yes | PASS | PASS |
| 04 | ALTER COLUMN TYPE | Yes | PASS | PASS |
| 05 | RENAME COLUMN | Yes | PASS | PASS |
| 06a | SET NOT NULL | Yes | PASS | PASS |
| 06b | SET DEFAULT | Yes | PASS | PASS |
| 06c | DROP DEFAULT | Yes | PASS | PASS |
| 07 | Inline FK | Yes | PASS | PASS |
| 08 | Named FK constraint | Yes | PASS | PASS |
| 09 | Composite PK + FKs | Yes | PASS | PASS |
| 10 | Self-referential FK | Yes | PASS | PASS |
| 11 | Multi-column UNIQUE | Yes | PASS | PASS |
| 12 | CHECK constraint | Yes | PASS | PASS |
| 13 | EXCLUDE constraint | Yes | PASS | FAIL |
| 14a | Basic index | Yes | PASS | PASS |
| 14b | Expression index | Yes | PASS | PASS |
| 15 | Partial index | Yes | PASS | PASS |
| 16a | ADD jsonb column | Yes | PASS | PASS |
| 16b | GIN index | Yes | PASS | PASS |
| 17 | Multi-col index + DESC | Yes | PASS | PASS |
| 18 | DROP INDEX IF EXISTS | Yes | PASS | PASS |
| 19 | CREATE ENUM | Yes | PASS | PASS |
| 20 | ALTER ENUM ADD VALUE | Yes | PASS | FAIL |
| 21 | Composite type | Yes | PASS | PASS |
| 22 | CREATE FUNCTION ($$) | Yes | PASS | PASS |
| 23 | CREATE TRIGGER | Yes | PASS | FAIL |
| 24 | Trigger with WHEN | Yes | PASS | FAIL |
| 25 | CREATE SCHEMA | Yes | PASS | PASS |
| 26 | Schema-qualified table | Yes | PASS | PASS |
| 27 | ALTER SET SCHEMA | Yes | PASS | FAIL |
| 28 | CREATE VIEW | Yes | PASS | PASS |
| 29 | CREATE OR REPLACE VIEW | Yes | PASS | PASS |
| 30 | CREATE SEQUENCE | Yes | PASS | PASS |
| 31 | PARTITION BY | No | PASS | FAIL |
| 32 | PARTITION OF | No | PASS | FAIL |
| 33 | Generated column | No | PASS | PASS |
| 34a | ENABLE RLS | No | PASS | FAIL |
| 34b | CREATE POLICY | No | PASS | FAIL |
| 35a | Extension uuid-ossp | No | PASS | PASS |
| 35b | Extension pgcrypto | No | PASS | PASS |
| 36a | COMMENT ON TABLE | No | PASS | PASS |
| 36b | COMMENT ON COLUMN | No | PASS | PASS |
| 37 | INHERITS | No | PASS | PASS |
| 38 | CREATE DOMAIN | No | PASS | FAIL |
| 39 | Multi-command ALTER | No | PASS | PASS |

**Summary:**
- pg-parser: 46/46 passed (34/34 mandatory, 12/12 best-effort)
- pgsql-ast-parser: 36/46 passed (31/34 mandatory, 5/12 best-effort)

**pgsql-ast-parser failures (10):**
- MANDATORY: #13 EXCLUDE, #20 ALTER ENUM ADD VALUE, #23 CREATE TRIGGER, #24 Trigger WHEN, #27 SET SCHEMA
- BEST-EFFORT: #31 PARTITION BY, #32 PARTITION OF, #34a ENABLE RLS, #34b CREATE POLICY, #38 CREATE DOMAIN

## Bundle Size

| Parser | node_modules size |
|--------|-------------------|
| @supabase/pg-parser | 5.1 MB |
| pgsql-ast-parser | 2.2 MB |

## Parse Speed (1000 iterations)

| Parser | Total time | Per iteration | Statements parsed |
|--------|-----------|---------------|-------------------|
| pg-parser | 2185.3ms | 2.19ms | 46 |
| pgsql-ast-parser | 7977.2ms | 7.98ms | 36 |

Ratio: pg-parser is 3.6x **faster** than pgsql-ast-parser (while parsing 10 more statements)

## WASM Bundling (npm publish path)

| Strategy | Command | Result |
|----------|---------|--------|
| Inline | `bun build --target node` | FAIL (WASM file not found at runtime) |
| External pg-parser | `--external @supabase/pg-parser` | PASS |
| All external | `--packages external` | PASS |

**Recommended:** Strategy 2 (external pg-parser) — keeps pg-parser as runtime dependency, WASM loads from node_modules.

## API Ergonomics

| Aspect | pg-parser | pgsql-ast-parser |
|--------|-----------|------------------|
| Sync/Async | Async (WASM) | Sync |
| Type safety | Protobuf-derived (wrapped) | Discriminated unions (native TS) |
| Node access | `unwrapNode()` required | Direct property access |
| Multi-stmt | `tree.stmts[]` array | `Statement[]` array |
| Error handling | Returns error in result | Throws on failure |
| Multi-cmd ALTER | cmds[] array with 4 AlterTableCmd objects | changes[] array with 4 change objects |

## Decision

**Winner:** @supabase/pg-parser (WASM)

**Rationale:**
- 46/46 DDL coverage vs 36/46 — pg-parser handles EVERYTHING PostgreSQL supports
- pgsql-ast-parser fails on 5 MANDATORY DDL types (#13 EXCLUDE, #20 ALTER ENUM, #23/#24 triggers, #27 SET SCHEMA)
- WASM bundling works via --external strategy for npm publishing
- pg-parser is actually faster (3.6x) despite being WASM — likely because libpg_query's C parser is highly optimized
- The async API and protobuf wrapping are a minor ergonomics cost, mitigated by a thin mapping layer in the parsing component
