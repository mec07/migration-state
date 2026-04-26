// test/silent-failures.test.ts
// Silent-failure sequence tests: multi-step migration sequences that
// produce wrong results if the state machine has rename, resolution, or
// ordering bugs. These are the quality gate for the state machine.
import { describe, test, expect } from "bun:test";
import { applyMigrations } from "../src/apply";
import { parseMigrations } from "../src/parse";
import type { SchemaState } from "../src/types";

async function applySQL(...sqls: string[]): Promise<{ state: SchemaState; warnings: string[] }> {
  const files = sqls.map((_, i) => `${String(i + 1).padStart(3, "0")}.sql`);
  const parsed = await parseMigrations(sqls, files);
  const result = applyMigrations(parsed.statements);
  return {
    state: result.state,
    warnings: [...parsed.warnings, ...result.warnings].map(w => w.message),
  };
}

describe("Silent-Failure Sequences", () => {

  describe("SF-01: Column rename then type change on renamed column", () => {
    test("rename column, then ALTER TYPE on new name succeeds", async () => {
      const { state } = await applySQL(
        "CREATE TABLE users (id int PRIMARY KEY, name text);",
        "ALTER TABLE users RENAME COLUMN name TO full_name;",
        "ALTER TABLE users ALTER COLUMN full_name TYPE varchar(500);"
      );
      const col = state.schemas.get("public")!.tables.get("users")!.columns.find(c => c.name === "full_name")!;
      expect(col).toBeDefined();
      expect(col.type).toContain("varchar");
      // Old name should NOT exist
      const oldCol = state.schemas.get("public")!.tables.get("users")!.columns.find(c => c.name === "name");
      expect(oldCol).toBeUndefined();
    });

    test("rename column, then SET NOT NULL on new name succeeds", async () => {
      const { state } = await applySQL(
        "CREATE TABLE t (id int PRIMARY KEY, val text);",
        "ALTER TABLE t RENAME COLUMN val TO value;",
        "ALTER TABLE t ALTER COLUMN value SET NOT NULL;"
      );
      const col = state.schemas.get("public")!.tables.get("t")!.columns.find(c => c.name === "value")!;
      expect(col.nullable).toBe(false);
    });

    test("rename column, then ADD INDEX on new name includes new name", async () => {
      const { state } = await applySQL(
        "CREATE TABLE t (id int PRIMARY KEY, name text);",
        "CREATE INDEX idx_name ON t (name);",
        "ALTER TABLE t RENAME COLUMN name TO full_name;",
        "CREATE INDEX idx_full ON t (full_name);"
      );
      const table = state.schemas.get("public")!.tables.get("t")!;
      // Old index should have been cascaded to full_name
      const oldIdx = table.indices.find(i => i.name === "idx_name")!;
      expect(oldIdx.columns).toContain("full_name");
      expect(oldIdx.columns).not.toContain("name");
      // New index should have full_name
      const newIdx = table.indices.find(i => i.name === "idx_full")!;
      expect(newIdx.columns).toContain("full_name");
    });
  });

  describe("SF-02: Table rename then ALTER on renamed table", () => {
    test("rename table, then ADD COLUMN on new name succeeds", async () => {
      const { state } = await applySQL(
        "CREATE TABLE users (id int PRIMARY KEY);",
        "ALTER TABLE users RENAME TO accounts;",
        "ALTER TABLE accounts ADD COLUMN email text NOT NULL;"
      );
      // Old name should not exist
      expect(state.schemas.get("public")!.tables.has("users")).toBe(false);
      // New name should have the added column
      const table = state.schemas.get("public")!.tables.get("accounts")!;
      expect(table).toBeDefined();
      expect(table.columns.map(c => c.name)).toContain("email");
    });

    test("rename table, FK references in other tables update", async () => {
      const { state } = await applySQL(
        "CREATE TABLE users (id int PRIMARY KEY);",
        "CREATE TABLE orders (id int PRIMARY KEY, user_id int);",
        "ALTER TABLE orders ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id);",
        "ALTER TABLE users RENAME TO accounts;"
      );
      const fk = state.schemas.get("public")!.tables.get("orders")!.constraints.find(c => c.name === "fk_user")!;
      expect(fk.references?.table).toBe("accounts");
    });
  });

  describe("SF-03: Enum DROP + CREATE vs ALTER TYPE ADD VALUE", () => {
    test("DROP TYPE then CREATE TYPE with new values replaces enum", async () => {
      const { state } = await applySQL(
        "CREATE TYPE status AS ENUM ('active', 'inactive');",
        "DROP TYPE status;",
        "CREATE TYPE status AS ENUM ('active', 'inactive', 'deleted', 'archived');"
      );
      const e = state.schemas.get("public")!.enums.get("status")!;
      expect(e.values).toEqual(["active", "inactive", "deleted", "archived"]);
    });

    test("ALTER TYPE ADD VALUE produces same result as DROP+CREATE", async () => {
      const { state } = await applySQL(
        "CREATE TYPE status AS ENUM ('active', 'inactive');",
        "ALTER TYPE status ADD VALUE 'deleted';",
        "ALTER TYPE status ADD VALUE 'archived';"
      );
      const e = state.schemas.get("public")!.enums.get("status")!;
      expect(e.values).toEqual(["active", "inactive", "deleted", "archived"]);
    });
  });

  describe("SF-04: Expression index columns preserved as expressions", () => {
    test("expression index stores expression text, not column name", async () => {
      const { state } = await applySQL(
        "CREATE TABLE users (id int PRIMARY KEY, email text);",
        "CREATE UNIQUE INDEX idx_email_lower ON users (lower(email));"
      );
      const idx = state.schemas.get("public")!.tables.get("users")!.indices.find(i => i.name === "idx_email_lower")!;
      expect(idx.columns.length).toBe(1);
      // Should contain the expression, not just "email"
      expect(idx.columns[0]).toContain("lower");
    });

    test("expression index is NOT rewritten on column rename (acceptable limitation)", async () => {
      const { state } = await applySQL(
        "CREATE TABLE users (id int PRIMARY KEY, email text);",
        "CREATE UNIQUE INDEX idx_email_lower ON users (lower(email));",
        "ALTER TABLE users RENAME COLUMN email TO email_address;"
      );
      const idx = state.schemas.get("public")!.tables.get("users")!.indices.find(i => i.name === "idx_email_lower")!;
      // Expression text stays as-is (contains old name) — this is acceptable
      // because we don't rewrite expression strings
      expect(idx.columns[0]).toContain("lower");
    });
  });

  describe("SF-05: DROP IF EXISTS for non-existent table is a no-op", () => {
    test("DROP TABLE IF EXISTS on non-existent table produces no error and no warning", async () => {
      const { state, warnings } = await applySQL(
        "DROP TABLE IF EXISTS nonexistent;"
      );
      expect(state.schemas.get("public")!.tables.has("nonexistent")).toBe(false);
      // Should not produce a warning when IF EXISTS is used
      const dropWarnings = warnings.filter(w => w.includes("nonexistent"));
      expect(dropWarnings.length).toBe(0);
    });

    test("DROP INDEX IF EXISTS on non-existent index is silent", async () => {
      const { state, warnings } = await applySQL(
        "CREATE TABLE t (id int PRIMARY KEY);",
        "DROP INDEX IF EXISTS idx_nonexistent;"
      );
      const idxWarnings = warnings.filter(w => w.includes("idx_nonexistent"));
      expect(idxWarnings.length).toBe(0);
    });

    test("DROP TYPE IF EXISTS on non-existent type is silent", async () => {
      const { warnings } = await applySQL(
        "DROP TYPE IF EXISTS nonexistent_type;"
      );
      const typeWarnings = warnings.filter(w => w.includes("nonexistent_type"));
      expect(typeWarnings.length).toBe(0);
    });
  });

  describe("SF-06: public.users and users resolve to same table", () => {
    test("CREATE TABLE users then ALTER TABLE public.users works", async () => {
      const { state } = await applySQL(
        "CREATE TABLE users (id int PRIMARY KEY);",
        "ALTER TABLE public.users ADD COLUMN name text;"
      );
      const table = state.schemas.get("public")!.tables.get("users")!;
      expect(table.columns.length).toBe(2);
      expect(table.columns.map(c => c.name)).toContain("name");
    });

    test("CREATE TABLE public.users then ALTER TABLE users works", async () => {
      const { state } = await applySQL(
        "CREATE TABLE public.users (id int PRIMARY KEY);",
        "ALTER TABLE users ADD COLUMN email text;"
      );
      const table = state.schemas.get("public")!.tables.get("users")!;
      expect(table.columns.length).toBe(2);
    });

    test("CREATE INDEX on unqualified table, DROP INDEX on qualified works", async () => {
      const { state } = await applySQL(
        "CREATE TABLE users (id int PRIMARY KEY, email text);",
        "CREATE INDEX idx_email ON users (email);",
        "DROP INDEX public.idx_email;"
      );
      const idx = state.schemas.get("public")!.tables.get("users")!.indices.find(i => i.name === "idx_email");
      expect(idx).toBeUndefined();
    });
  });

  describe("SF-07: Multi-command ALTER TABLE applies all sub-commands", () => {
    test("4 sub-commands in one ALTER TABLE all take effect", async () => {
      const { state } = await applySQL(
        "CREATE TABLE users (id int PRIMARY KEY, name text, legacy text, email text);",
        `ALTER TABLE users
          ADD COLUMN verified boolean DEFAULT false,
          ADD COLUMN verified_at timestamptz,
          DROP COLUMN IF EXISTS legacy,
          ALTER COLUMN email SET NOT NULL;`
      );
      const table = state.schemas.get("public")!.tables.get("users")!;
      const colNames = table.columns.map(c => c.name);
      expect(colNames).toContain("verified");
      expect(colNames).toContain("verified_at");
      expect(colNames).not.toContain("legacy");
      const email = table.columns.find(c => c.name === "email")!;
      expect(email.nullable).toBe(false);
    });

    test("ADD COLUMN then immediately reference it in same ALTER", async () => {
      const { state } = await applySQL(
        "CREATE TABLE t (id int PRIMARY KEY);",
        `ALTER TABLE t
          ADD COLUMN status text DEFAULT 'active',
          ALTER COLUMN status SET NOT NULL;`
      );
      const col = state.schemas.get("public")!.tables.get("t")!.columns.find(c => c.name === "status")!;
      expect(col).toBeDefined();
      expect(col.nullable).toBe(false);
      expect(col.default).toBeDefined();
    });
  });

  describe("SF-08: CREATE OR REPLACE VIEW replaces existing view definition", () => {
    test("view definition is replaced, not duplicated", async () => {
      const { state } = await applySQL(
        "CREATE TABLE users (id int PRIMARY KEY, name text, email text);",
        "CREATE VIEW user_names AS SELECT id, name FROM users;",
        "CREATE OR REPLACE VIEW user_names AS SELECT id, name, email FROM users;"
      );
      const views = state.schemas.get("public")!.views;
      // Should have exactly 1 view, not 2
      expect(views.size).toBe(1);
      const view = views.get("user_names")!;
      expect(view).toBeDefined();
      // The definition should be the replacement, containing "email"
      expect(view.definition).toContain("email");
    });

    test("original view is gone after replacement", async () => {
      const { state } = await applySQL(
        "CREATE VIEW v AS SELECT 1 AS old_col;",
        "CREATE OR REPLACE VIEW v AS SELECT 2 AS new_col;"
      );
      const view = state.schemas.get("public")!.views.get("v")!;
      expect(view.definition).toContain("new_col");
    });
  });
});
