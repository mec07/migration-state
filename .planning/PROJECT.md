# migration-state

## What This Is

A Bun TypeScript CLI tool that reads PostgreSQL migration files from disk, parses them into an AST, applies DDL operations sequentially in-memory to build schema state, and outputs the final database schema as LLM-optimised markdown or JSON. Published to npm as `migration-state`.

## Core Value

Given a directory of SQL migration files, produce an accurate, complete representation of the current database schema state — so an LLM agent never has to read and mentally reconstruct hundreds of migration files.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Parse and apply 30+ PostgreSQL DDL statement types correctly (CREATE TABLE, ALTER TABLE, CREATE INDEX, CREATE TYPE, triggers, views, sequences, schemas, extensions, etc.)
- [ ] Auto-detect migration tool from file patterns (Flyway, golang-migrate, goose, dbmate, sql-migrate, Prisma, Drizzle, generic)
- [ ] Extract "up" SQL from tool-specific file formats (markers, directory structures, file naming)
- [ ] Handle silent-failure sequences correctly (column rename then alter, table rename then alter, enum drop+create, expression indices, DROP IF EXISTS, schema resolution, multi-command ALTER, CREATE OR REPLACE VIEW)
- [ ] Output LLM-optimised markdown (token-efficient, structured for agent comprehension)
- [ ] Output JSON format as alternative
- [ ] Filter output by table name or schema name
- [ ] Surface warnings for unparseable statements (never silently drop)
- [ ] Publish to npm as unscoped `migration-state` package
- [ ] Work via `bunx migration-state <dir>` without local install

### Out of Scope

- Code-based migration tools (Django, Rails, TypeORM, Sequelize) — require language runtime, out of scope for SQL-file parser
- Non-PostgreSQL databases — PostgreSQL only for v1
- Caching / performance optimisation — sub-second for 500 migrations already, not needed
- RepoSkills integration — follow-up after v1 CLI is solid
- Human-oriented output formatting — output optimised for LLM token efficiency, not human readability
- DOWN migration execution — only UP migrations are applied

## Context

- **Parser candidates:** `pgsql-ast-parser` (pure TypeScript, lighter) and Supabase `pg-parser` (PG C parser compiled to WASM, heavier but more complete). Leaning toward `pg-parser` but Phase 1 spike will evaluate both against 39 DDL test statements.
- **Critical finding:** `libpg-query` (native C addon via node-gyp) is incompatible with Bun's JavaScriptCore runtime. Do not attempt.
- **Architecture:** Pipeline of 5 components: Discovery (find files) -> Extraction (get UP SQL) -> Parsing (SQL to AST) -> Application (state machine) -> Output (render)
- **Risk area:** The Application layer (state machine) is where bugs will hide. Parsing is a library call; correctly applying DDL operations in sequence with rename tracking, schema resolution, and constraint management is the hard part.
- **Migration tool landscape:** 10 SQL-file tools are directly parseable. 9 code-based tools are out of scope.
- **Existing plan:** Detailed 10-phase implementation plan exists at `Plans/migration-state-implementation-plan.md`

## Constraints

- **Runtime:** Bun (not Node.js) — JavaScriptCore, not V8
- **Language:** TypeScript
- **No native addons:** Must use pure TS or WASM dependencies only (Bun native addon compat ~34%)
- **PostgreSQL only:** No MySQL, SQLite, etc.
- **SQL-file migrations only:** No ORM code generation

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Bun runtime over Node.js | Project ecosystem uses Bun, faster startup for CLI tool | — Pending |
| Pure TS / WASM parser only | libpg-query native addon incompatible with Bun's JSC | — Pending |
| Spike both parser candidates | pg-parser (WASM) likely more complete, but pgsql-ast-parser (pure TS) lighter — need data | — Pending |
| Unscoped npm package name | `migration-state` is available, simpler than scoped | — Pending |
| LLM-optimised output | Primary consumers are LLM agents, optimise for token efficiency | — Pending |
| RepoSkills integration deferred | Get CLI working first, integrate later | — Pending |
| commander for CLI args | Many optional flags benefit from a library over manual parsing | — Pending |

---
*Last updated: 2026-04-24 after initialization*
