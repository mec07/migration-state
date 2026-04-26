# migration-state

A Bun TypeScript CLI tool that reads PostgreSQL migration files from disk, applies them sequentially in-memory, and outputs the final schema state as LLM-optimised markdown or JSON.

## Why

LLM agents working with codebases need to understand the database schema. Today that means reading every migration file and burning tokens reconstructing the state mentally. `migration-state` does that once and produces a clean schema summary the agent can reference.

No existing tool reconstructs PostgreSQL schema state purely from migration files on disk without a live database connection.

## Usage

```bash
bunx migration-state ./db/migrations
```

### Options

```
migration-state <dir>

Arguments:
  dir                     Path to migration directory

Options:
  --tool <tool>           Migration tool (auto-detected if omitted)
  --tables <tables>       Comma-separated table names to filter
  --schemas <schemas>     Comma-separated schema names to filter
  --format <format>       Output format: markdown (default) or json
  --no-views              Exclude views from output
  --no-functions          Exclude functions from output
  --no-sequences          Exclude sequences from output
  --quiet                 Suppress warnings
  --help                  Show help
```

## Supported Migration Tools

Auto-detected from file patterns:

- **Flyway** (`V{version}__{desc}.sql`)
- **golang-migrate** (`{version}_{title}.up.sql`)
- **goose** (`-- +goose Up` markers)
- **dbmate** (`-- migrate:up` markers)
- **sql-migrate** (`-- +migrate Up` markers)
- **Prisma** (`{timestamp}_{name}/migration.sql`)
- **Drizzle** (directory + `snapshot.json`)
- **Atlas** (`atlas.sum` present)
- **Generic** (fallback, sorts by filename)

## DDL Coverage

Handles 46 PostgreSQL DDL statement types including:

- Tables (CREATE, ALTER, DROP with all sub-commands)
- Constraints (PK, FK, UNIQUE, CHECK, EXCLUDE)
- Indices (btree, gin, gist, partial, expression, multi-column)
- Types (ENUM, composite, domain)
- Triggers and functions (including dollar-quoted bodies)
- Views (CREATE, CREATE OR REPLACE)
- Schemas, sequences, extensions, comments
- Partitioned tables (PARTITION BY, PARTITION OF)
- Row-level security (ENABLE RLS, CREATE POLICY)
- Generated columns, table inheritance

## Parser

Uses [`@supabase/pg-parser`](https://github.com/supabase-community/pg-parser) (the real PostgreSQL 17 C parser compiled to WASM). Selected over `pgsql-ast-parser` based on a spike comparing both:

| Metric | @supabase/pg-parser | pgsql-ast-parser |
|--------|---------------------|------------------|
| DDL Coverage | 46/46 (100%) | 36/46 (78%) |
| Mandatory DDL | 34/34 | 31/34 |
| Parse Speed | 2.19ms/iter | 7.98ms/iter |
| Bundle Size | 5.1 MB | 2.2 MB |

Full spike results in [`spike/results/comparison.md`](spike/results/comparison.md).

## Tech Stack

- **Runtime:** Bun
- **Parser:** @supabase/pg-parser (WASM)
- **Language:** TypeScript
- **PostgreSQL only, SQL-file migrations only**

## Status

Under active development. See `.planning/ROADMAP.md` for phase details.

## License

MIT
