// test/apply.test.ts
import { describe, test, expect } from "bun:test";
import { applyMigrations } from "../src/apply";
import { parseMigrations } from "../src/parse";
import type { SchemaState } from "../src/types";

// Helper: parse SQL and apply, return final state
async function applySQL(...sqls: string[]): Promise<{ state: SchemaState; warnings: string[] }> {
  const files = sqls.map((_, i) => `${String(i + 1).padStart(3, "0")}.sql`);
  const parsed = await parseMigrations(sqls, files);
  const result = applyMigrations(parsed.statements);
  return {
    state: result.state,
    warnings: [...parsed.warnings, ...result.warnings].map(w => w.message),
  };
}

describe("applyMigrations", () => {
  describe("CREATE TABLE (STATE-01)", () => {
    test("basic table with columns, types, nullable, defaults", async () => {
      const { state } = await applySQL(`CREATE TABLE users (
        id bigserial PRIMARY KEY,
        email varchar(255) NOT NULL UNIQUE,
        name text DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now()
      );`);
      const table = state.schemas.get("public")!.tables.get("users")!;
      expect(table).toBeDefined();
      expect(table.name).toBe("users");
      expect(table.schema).toBe("public");
      expect(table.columns.length).toBe(4);

      // id column
      const id = table.columns[0];
      expect(id.name).toBe("id");
      expect(id.type).toContain("bigint");
      // NOT NULL is NOT explicitly set on bigserial -- PK constraint handles it
      // but we mark PK columns as not null

      // email column
      const email = table.columns[1];
      expect(email.name).toBe("email");
      expect(email.nullable).toBe(false);

      // name column -- nullable, has default
      const name = table.columns[2];
      expect(name.name).toBe("name");
      expect(name.nullable).toBe(true);
      expect(name.default).toBeDefined();

      // created_at -- not null, has default
      const createdAt = table.columns[3];
      expect(createdAt.nullable).toBe(false);
    });

    test("inline PK constraint is extracted", async () => {
      const { state } = await applySQL("CREATE TABLE t (id int PRIMARY KEY);");
      const table = state.schemas.get("public")!.tables.get("t")!;
      const pk = table.constraints.find(c => c.type === "PRIMARY KEY");
      expect(pk).toBeDefined();
      expect(pk!.columns).toContain("id");
    });

    test("inline FK constraint is extracted", async () => {
      const { state } = await applySQL(
        "CREATE TABLE parents (id int PRIMARY KEY);",
        "CREATE TABLE children (id int PRIMARY KEY, parent_id int REFERENCES parents(id) ON DELETE CASCADE);"
      );
      const table = state.schemas.get("public")!.tables.get("children")!;
      const fk = table.constraints.find(c => c.type === "FOREIGN KEY");
      expect(fk).toBeDefined();
      expect(fk!.references?.table).toBe("parents");
      expect(fk!.references?.columns).toContain("id");
      expect(fk!.references?.onDelete).toBe("CASCADE");
    });

    test("inline UNIQUE constraint is extracted", async () => {
      const { state } = await applySQL("CREATE TABLE t (id int PRIMARY KEY, email text NOT NULL UNIQUE);");
      const table = state.schemas.get("public")!.tables.get("t")!;
      const uq = table.constraints.find(c => c.type === "UNIQUE");
      expect(uq).toBeDefined();
      expect(uq!.columns).toContain("email");
    });

    test("table-level CHECK constraint", async () => {
      const { state } = await applySQL("CREATE TABLE t (id int, val int, CHECK (val >= 0));");
      const table = state.schemas.get("public")!.tables.get("t")!;
      const chk = table.constraints.find(c => c.type === "CHECK");
      expect(chk).toBeDefined();
    });

    test("composite primary key", async () => {
      const { state } = await applySQL(
        "CREATE TABLE t (a int, b int, PRIMARY KEY (a, b));"
      );
      const table = state.schemas.get("public")!.tables.get("t")!;
      const pk = table.constraints.find(c => c.type === "PRIMARY KEY");
      expect(pk).toBeDefined();
      expect(pk!.columns.length).toBe(2);
      expect(pk!.columns).toContain("a");
      expect(pk!.columns).toContain("b");
    });

    test("schema-qualified CREATE TABLE (STATE-30)", async () => {
      const { state } = await applySQL(
        "CREATE SCHEMA audit;",
        "CREATE TABLE audit.events (id int PRIMARY KEY, action text);"
      );
      const table = state.schemas.get("audit")!.tables.get("events")!;
      expect(table).toBeDefined();
      expect(table.schema).toBe("audit");
    });

    test("CREATE TABLE IF NOT EXISTS when table exists (STATE-31)", async () => {
      const { state, warnings } = await applySQL(
        "CREATE TABLE t (id int);",
        "CREATE TABLE IF NOT EXISTS t (id int, extra text);"
      );
      const table = state.schemas.get("public")!.tables.get("t")!;
      // Second CREATE should be a no-op -- table still has 1 column, not 2
      expect(table.columns.length).toBe(1);
    });

    test("SERIAL creates implicit sequence and sets type (STATE-32)", async () => {
      const { state } = await applySQL("CREATE TABLE t (id bigserial PRIMARY KEY);");
      const table = state.schemas.get("public")!.tables.get("t")!;
      const col = table.columns[0];
      // bigserial -> bigint with nextval default
      expect(col.type).toBe("bigint");
      expect(col.default).toContain("nextval");
      // Implicit sequence should exist
      const seq = state.schemas.get("public")!.sequences.get("t_id_seq");
      expect(seq).toBeDefined();
    });

    test("PK creates implicit index (STATE-33)", async () => {
      const { state } = await applySQL("CREATE TABLE t (id int PRIMARY KEY);");
      const table = state.schemas.get("public")!.tables.get("t")!;
      const pkIdx = table.indices.find(i => i.columns.includes("id") && i.unique);
      expect(pkIdx).toBeDefined();
    });

    test("UNIQUE constraint creates implicit index (STATE-33)", async () => {
      const { state } = await applySQL("CREATE TABLE t (id int PRIMARY KEY, email text UNIQUE);");
      const table = state.schemas.get("public")!.tables.get("t")!;
      const uqIdx = table.indices.find(i => i.columns.includes("email") && i.unique);
      expect(uqIdx).toBeDefined();
    });
  });

  describe("CREATE SCHEMA (STATE-26)", () => {
    test("creates a new schema", async () => {
      const { state } = await applySQL("CREATE SCHEMA audit;");
      expect(state.schemas.has("audit")).toBe(true);
    });

    test("IF NOT EXISTS when schema exists is a no-op", async () => {
      const { state } = await applySQL(
        "CREATE SCHEMA audit;",
        "CREATE SCHEMA IF NOT EXISTS audit;"
      );
      expect(state.schemas.has("audit")).toBe(true);
    });
  });

  describe("CREATE EXTENSION (STATE-27)", () => {
    test("adds extension to list", async () => {
      const { state } = await applySQL('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
      expect(state.extensions).toContain("uuid-ossp");
    });

    test("duplicate extension is a no-op", async () => {
      const { state } = await applySQL(
        'CREATE EXTENSION "uuid-ossp";',
        'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";'
      );
      expect(state.extensions.filter(e => e === "uuid-ossp").length).toBe(1);
    });
  });

  describe("schema resolution (STATE-30)", () => {
    test("unqualified table resolves to public schema", async () => {
      const { state } = await applySQL("CREATE TABLE users (id int);");
      expect(state.schemas.get("public")!.tables.has("users")).toBe(true);
    });
  });

  describe("ALTER TABLE ADD COLUMN (STATE-02)", () => {
    test("adds a column to existing table", async () => {
      const { state } = await applySQL(
        "CREATE TABLE t (id int PRIMARY KEY);",
        "ALTER TABLE t ADD COLUMN name text DEFAULT 'unknown';"
      );
      const table = state.schemas.get("public")!.tables.get("t")!;
      expect(table.columns.length).toBe(2);
      const col = table.columns[1];
      expect(col.name).toBe("name");
      expect(col.type).toContain("text");
      expect(col.nullable).toBe(true);
    });
  });

  describe("ALTER TABLE DROP COLUMN (STATE-03)", () => {
    test("removes column from table", async () => {
      const { state } = await applySQL(
        "CREATE TABLE t (id int PRIMARY KEY, name text, email text);",
        "ALTER TABLE t DROP COLUMN name;"
      );
      const table = state.schemas.get("public")!.tables.get("t")!;
      expect(table.columns.length).toBe(2);
      expect(table.columns.map(c => c.name)).toEqual(["id", "email"]);
    });

    test("DROP COLUMN removes column from referencing indices", async () => {
      const { state } = await applySQL(
        "CREATE TABLE t (id int PRIMARY KEY, name text, email text);",
        "CREATE INDEX idx ON t (name, email);",
        "ALTER TABLE t DROP COLUMN name;"
      );
      const table = state.schemas.get("public")!.tables.get("t")!;
      const idx = table.indices.find(i => i.name === "idx");
      // Index should still exist but only have 'email'
      expect(idx).toBeDefined();
      expect(idx!.columns).toEqual(["email"]);
    });

    test("DROP COLUMN IF EXISTS on non-existent column is no-op", async () => {
      const { state, warnings } = await applySQL(
        "CREATE TABLE t (id int PRIMARY KEY);",
        "ALTER TABLE t DROP COLUMN IF EXISTS nonexistent;"
      );
      expect(state.schemas.get("public")!.tables.get("t")!.columns.length).toBe(1);
    });
  });

  describe("ALTER TABLE ALTER COLUMN TYPE (STATE-04)", () => {
    test("changes column type", async () => {
      const { state } = await applySQL(
        "CREATE TABLE t (id int PRIMARY KEY, name text);",
        "ALTER TABLE t ALTER COLUMN name TYPE varchar(500);"
      );
      const col = state.schemas.get("public")!.tables.get("t")!.columns.find(c => c.name === "name")!;
      expect(col.type).toContain("varchar");
    });
  });

  describe("ALTER TABLE SET/DROP NOT NULL (STATE-05)", () => {
    test("SET NOT NULL makes column not nullable", async () => {
      const { state } = await applySQL(
        "CREATE TABLE t (id int PRIMARY KEY, name text);",
        "ALTER TABLE t ALTER COLUMN name SET NOT NULL;"
      );
      const col = state.schemas.get("public")!.tables.get("t")!.columns.find(c => c.name === "name")!;
      expect(col.nullable).toBe(false);
    });

    test("DROP NOT NULL makes column nullable", async () => {
      const { state } = await applySQL(
        "CREATE TABLE t (id int PRIMARY KEY, name text NOT NULL);",
        "ALTER TABLE t ALTER COLUMN name DROP NOT NULL;"
      );
      const col = state.schemas.get("public")!.tables.get("t")!.columns.find(c => c.name === "name")!;
      expect(col.nullable).toBe(true);
    });
  });

  describe("ALTER TABLE SET/DROP DEFAULT (STATE-06)", () => {
    test("SET DEFAULT adds default to column", async () => {
      const { state } = await applySQL(
        "CREATE TABLE t (id int PRIMARY KEY, name text);",
        "ALTER TABLE t ALTER COLUMN name SET DEFAULT 'unknown';"
      );
      const col = state.schemas.get("public")!.tables.get("t")!.columns.find(c => c.name === "name")!;
      expect(col.default).toBeDefined();
    });

    test("DROP DEFAULT removes default from column", async () => {
      const { state } = await applySQL(
        "CREATE TABLE t (id int PRIMARY KEY, name text DEFAULT 'hi');",
        "ALTER TABLE t ALTER COLUMN name DROP DEFAULT;"
      );
      const col = state.schemas.get("public")!.tables.get("t")!.columns.find(c => c.name === "name")!;
      expect(col.default).toBeUndefined();
    });
  });

  describe("ALTER TABLE RENAME COLUMN (STATE-07)", () => {
    test("renames column", async () => {
      const { state } = await applySQL(
        "CREATE TABLE t (id int PRIMARY KEY, name text);",
        "ALTER TABLE t RENAME COLUMN name TO full_name;"
      );
      const cols = state.schemas.get("public")!.tables.get("t")!.columns;
      expect(cols.map(c => c.name)).toContain("full_name");
      expect(cols.map(c => c.name)).not.toContain("name");
    });

    test("rename cascades to indices", async () => {
      const { state } = await applySQL(
        "CREATE TABLE t (id int PRIMARY KEY, name text);",
        "CREATE INDEX idx ON t (name);",
        "ALTER TABLE t RENAME COLUMN name TO full_name;"
      );
      const idx = state.schemas.get("public")!.tables.get("t")!.indices.find(i => i.name === "idx")!;
      expect(idx.columns).toContain("full_name");
      expect(idx.columns).not.toContain("name");
    });
  });

  describe("ALTER TABLE RENAME TO (STATE-08)", () => {
    test("renames table in schema map", async () => {
      const { state } = await applySQL(
        "CREATE TABLE t (id int PRIMARY KEY);",
        "ALTER TABLE t RENAME TO t2;"
      );
      expect(state.schemas.get("public")!.tables.has("t2")).toBe(true);
      expect(state.schemas.get("public")!.tables.has("t")).toBe(false);
    });
  });

  describe("ALTER TABLE SET SCHEMA (STATE-09)", () => {
    test("moves table between schemas", async () => {
      const { state } = await applySQL(
        "CREATE TABLE t (id int);",
        "CREATE SCHEMA other;",
        "ALTER TABLE t SET SCHEMA other;"
      );
      expect(state.schemas.get("public")!.tables.has("t")).toBe(false);
      expect(state.schemas.get("other")!.tables.has("t")).toBe(true);
      expect(state.schemas.get("other")!.tables.get("t")!.schema).toBe("other");
    });
  });

  describe("ALTER TABLE ADD CONSTRAINT (STATE-10)", () => {
    test("adds FK constraint", async () => {
      const { state } = await applySQL(
        "CREATE TABLE parents (id int PRIMARY KEY);",
        "CREATE TABLE children (id int PRIMARY KEY, parent_id int);",
        "ALTER TABLE children ADD CONSTRAINT fk_parent FOREIGN KEY (parent_id) REFERENCES parents(id) ON DELETE CASCADE;"
      );
      const fk = state.schemas.get("public")!.tables.get("children")!.constraints.find(c => c.name === "fk_parent");
      expect(fk).toBeDefined();
      expect(fk!.type).toBe("FOREIGN KEY");
      expect(fk!.references?.table).toBe("parents");
      expect(fk!.references?.onDelete).toBe("CASCADE");
    });

    test("adds UNIQUE constraint", async () => {
      const { state } = await applySQL(
        "CREATE TABLE t (id int PRIMARY KEY, email text);",
        "ALTER TABLE t ADD CONSTRAINT uq_email UNIQUE (email);"
      );
      const uq = state.schemas.get("public")!.tables.get("t")!.constraints.find(c => c.name === "uq_email");
      expect(uq).toBeDefined();
      expect(uq!.type).toBe("UNIQUE");
    });
  });

  describe("ALTER TABLE DROP CONSTRAINT (STATE-11)", () => {
    test("removes named constraint", async () => {
      const { state } = await applySQL(
        "CREATE TABLE t (id int PRIMARY KEY, email text);",
        "ALTER TABLE t ADD CONSTRAINT uq_email UNIQUE (email);",
        "ALTER TABLE t DROP CONSTRAINT uq_email;"
      );
      const uq = state.schemas.get("public")!.tables.get("t")!.constraints.find(c => c.name === "uq_email");
      expect(uq).toBeUndefined();
    });
  });

  describe("multi-command ALTER TABLE (STATE-29)", () => {
    test("processes all sub-commands in one statement", async () => {
      const { state } = await applySQL(
        "CREATE TABLE t (id int PRIMARY KEY, old_col text);",
        `ALTER TABLE t
          ADD COLUMN new_col text,
          DROP COLUMN IF EXISTS old_col,
          ALTER COLUMN id SET NOT NULL;`
      );
      const table = state.schemas.get("public")!.tables.get("t")!;
      expect(table.columns.map(c => c.name)).toContain("new_col");
      expect(table.columns.map(c => c.name)).not.toContain("old_col");
    });
  });

  describe("DROP TABLE (STATE-12)", () => {
    test("removes table from schema", async () => {
      const { state } = await applySQL(
        "CREATE TABLE t (id int);",
        "DROP TABLE t;"
      );
      expect(state.schemas.get("public")!.tables.has("t")).toBe(false);
    });

    test("DROP TABLE IF EXISTS on non-existent table is no-op (STATE-31)", async () => {
      const { state, warnings } = await applySQL("DROP TABLE IF EXISTS nonexistent;");
      // No error, no warning for IF EXISTS
      expect(state.schemas.get("public")!.tables.has("nonexistent")).toBe(false);
    });

    test("DROP TABLE without IF EXISTS on non-existent table warns", async () => {
      const { warnings } = await applySQL("DROP TABLE nonexistent;");
      expect(warnings.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("CREATE INDEX (STATE-13)", () => {
    test("basic btree index", async () => {
      const { state } = await applySQL(
        "CREATE TABLE t (id int PRIMARY KEY, name text);",
        "CREATE INDEX idx_name ON t (name);"
      );
      const idx = state.schemas.get("public")!.tables.get("t")!.indices.find(i => i.name === "idx_name");
      expect(idx).toBeDefined();
      expect(idx!.columns).toEqual(["name"]);
      expect(idx!.unique).toBe(false);
      expect(idx!.method).toBe("btree");
    });

    test("unique index", async () => {
      const { state } = await applySQL(
        "CREATE TABLE t (id int PRIMARY KEY, email text);",
        "CREATE UNIQUE INDEX idx_email ON t (email);"
      );
      const idx = state.schemas.get("public")!.tables.get("t")!.indices.find(i => i.name === "idx_email");
      expect(idx!.unique).toBe(true);
    });

    test("GIN index", async () => {
      const { state } = await applySQL(
        "CREATE TABLE t (id int PRIMARY KEY, data jsonb);",
        "CREATE INDEX idx_data ON t USING gin (data);"
      );
      const idx = state.schemas.get("public")!.tables.get("t")!.indices.find(i => i.name === "idx_data");
      expect(idx!.method).toBe("gin");
    });

    test("partial index with WHERE clause", async () => {
      const { state } = await applySQL(
        "CREATE TABLE t (id int PRIMARY KEY, active boolean);",
        "CREATE INDEX idx_active ON t (id) WHERE active = true;"
      );
      const idx = state.schemas.get("public")!.tables.get("t")!.indices.find(i => i.name === "idx_active");
      expect(idx!.where).toBeTruthy();
    });

    test("expression index", async () => {
      const { state } = await applySQL(
        "CREATE TABLE t (id int PRIMARY KEY, email text);",
        "CREATE INDEX idx_lower ON t (lower(email));"
      );
      const idx = state.schemas.get("public")!.tables.get("t")!.indices.find(i => i.name === "idx_lower");
      expect(idx!.columns.length).toBe(1);
      // Expression should contain "lower"
      expect(idx!.columns[0]).toContain("lower");
    });

    test("multi-column index", async () => {
      const { state } = await applySQL(
        "CREATE TABLE t (id int, a text, b text);",
        "CREATE INDEX idx_ab ON t (a, b);"
      );
      const idx = state.schemas.get("public")!.tables.get("t")!.indices.find(i => i.name === "idx_ab");
      expect(idx!.columns).toEqual(["a", "b"]);
    });
  });

  describe("DROP INDEX (STATE-14)", () => {
    test("removes index from table", async () => {
      const { state } = await applySQL(
        "CREATE TABLE t (id int PRIMARY KEY, name text);",
        "CREATE INDEX idx_name ON t (name);",
        "DROP INDEX idx_name;"
      );
      const idx = state.schemas.get("public")!.tables.get("t")!.indices.find(i => i.name === "idx_name");
      expect(idx).toBeUndefined();
    });

    test("DROP INDEX IF EXISTS on non-existent is no-op", async () => {
      const { state } = await applySQL(
        "CREATE TABLE t (id int PRIMARY KEY);",
        "DROP INDEX IF EXISTS nonexistent;"
      );
      // No crash
    });
  });

  describe("CREATE TYPE ENUM (STATE-15)", () => {
    test("creates enum with values", async () => {
      const { state } = await applySQL("CREATE TYPE status AS ENUM ('active', 'inactive', 'deleted');");
      const e = state.schemas.get("public")!.enums.get("status");
      expect(e).toBeDefined();
      expect(e!.values).toEqual(["active", "inactive", "deleted"]);
    });
  });

  describe("ALTER TYPE ADD VALUE (STATE-16)", () => {
    test("adds value to enum", async () => {
      const { state } = await applySQL(
        "CREATE TYPE status AS ENUM ('active', 'inactive');",
        "ALTER TYPE status ADD VALUE 'deleted';"
      );
      const e = state.schemas.get("public")!.enums.get("status")!;
      expect(e.values).toContain("deleted");
    });

    test("adds value AFTER specific value", async () => {
      const { state } = await applySQL(
        "CREATE TYPE status AS ENUM ('active', 'inactive');",
        "ALTER TYPE status ADD VALUE 'suspended' AFTER 'active';"
      );
      const e = state.schemas.get("public")!.enums.get("status")!;
      expect(e.values.indexOf("suspended")).toBe(e.values.indexOf("active") + 1);
    });
  });

  describe("ALTER TYPE RENAME VALUE", () => {
    test("renames an existing enum value", async () => {
      const { state } = await applySQL(
        "CREATE TYPE status AS ENUM ('pending', 'complete', 'failed');",
        "ALTER TYPE status RENAME VALUE 'complete' TO 'completed';"
      );
      const e = state.schemas.get("public")!.enums.get("status")!;
      expect(e.values).toEqual(["pending", "completed", "failed"]);
      expect(e.values).not.toContain("complete");
    });

    test("rename preserves position in values list", async () => {
      const { state } = await applySQL(
        "CREATE TYPE priority AS ENUM ('low', 'medium', 'high', 'critical');",
        "ALTER TYPE priority RENAME VALUE 'medium' TO 'normal';"
      );
      const e = state.schemas.get("public")!.enums.get("priority")!;
      expect(e.values).toEqual(["low", "normal", "high", "critical"]);
    });

    test("rename then add value works in sequence", async () => {
      const { state } = await applySQL(
        "CREATE TYPE status AS ENUM ('pending', 'complete');",
        "ALTER TYPE status ADD VALUE 'accepted';",
        "ALTER TYPE status ADD VALUE 'rejected';",
        "ALTER TYPE status ADD VALUE 'failed';",
        "ALTER TYPE status RENAME VALUE 'complete' TO 'completed';"
      );
      const e = state.schemas.get("public")!.enums.get("status")!;
      expect(e.values).toEqual(["pending", "completed", "accepted", "rejected", "failed"]);
    });
  });

  describe("DROP TYPE (STATE-17)", () => {
    test("removes enum", async () => {
      const { state } = await applySQL(
        "CREATE TYPE status AS ENUM ('a');",
        "DROP TYPE status;"
      );
      expect(state.schemas.get("public")!.enums.has("status")).toBe(false);
    });
  });

  describe("CREATE TRIGGER (STATE-18)", () => {
    test("creates trigger on table", async () => {
      const { state } = await applySQL(
        "CREATE TABLE t (id int PRIMARY KEY);",
        "CREATE TRIGGER trg BEFORE UPDATE ON t FOR EACH ROW EXECUTE FUNCTION fn();"
      );
      const trg = state.schemas.get("public")!.tables.get("t")!.triggers.find(t => t.name === "trg");
      expect(trg).toBeDefined();
      expect(trg!.function).toContain("fn");
    });
  });

  describe("DROP TRIGGER (STATE-19)", () => {
    test("removes trigger", async () => {
      const { state } = await applySQL(
        "CREATE TABLE t (id int PRIMARY KEY);",
        "CREATE TRIGGER trg BEFORE UPDATE ON t FOR EACH ROW EXECUTE FUNCTION fn();",
        "DROP TRIGGER trg ON t;"
      );
      const trg = state.schemas.get("public")!.tables.get("t")!.triggers.find(t => t.name === "trg");
      expect(trg).toBeUndefined();
    });
  });

  describe("CREATE VIEW (STATE-20)", () => {
    test("creates view", async () => {
      const { state } = await applySQL("CREATE VIEW v AS SELECT 1 AS x;");
      const view = state.schemas.get("public")!.views.get("v");
      expect(view).toBeDefined();
    });

    test("CREATE OR REPLACE VIEW replaces existing", async () => {
      const { state } = await applySQL(
        "CREATE VIEW v AS SELECT 1 AS x;",
        "CREATE OR REPLACE VIEW v AS SELECT 2 AS y;"
      );
      const view = state.schemas.get("public")!.views.get("v");
      expect(view).toBeDefined();
    });
  });

  describe("DROP VIEW (STATE-21)", () => {
    test("removes view", async () => {
      const { state } = await applySQL(
        "CREATE VIEW v AS SELECT 1;",
        "DROP VIEW v;"
      );
      expect(state.schemas.get("public")!.views.has("v")).toBe(false);
    });
  });

  describe("CREATE/ALTER SEQUENCE (STATE-22)", () => {
    test("creates sequence", async () => {
      const { state } = await applySQL("CREATE SEQUENCE s START 1000 INCREMENT 5;");
      const seq = state.schemas.get("public")!.sequences.get("s");
      expect(seq).toBeDefined();
      expect(seq!.start).toBe(1000);
      expect(seq!.increment).toBe(5);
    });

    test("ALTER SEQUENCE updates options", async () => {
      const { state } = await applySQL(
        "CREATE SEQUENCE s START 1;",
        "ALTER SEQUENCE s RESTART WITH 500;"
      );
      const seq = state.schemas.get("public")!.sequences.get("s");
      expect(seq).toBeDefined();
    });
  });

  describe("DROP SEQUENCE (STATE-23)", () => {
    test("removes sequence", async () => {
      const { state } = await applySQL(
        "CREATE SEQUENCE s;",
        "DROP SEQUENCE s;"
      );
      expect(state.schemas.get("public")!.sequences.has("s")).toBe(false);
    });
  });

  describe("CREATE FUNCTION (STATE-24)", () => {
    test("creates function", async () => {
      const { state } = await applySQL(
        "CREATE FUNCTION foo(x int) RETURNS text AS $$ BEGIN RETURN x::text; END; $$ LANGUAGE plpgsql;"
      );
      const fn = state.schemas.get("public")!.functions.get("foo");
      expect(fn).toBeDefined();
      expect(fn!.language).toBe("plpgsql");
      expect(fn!.returnType).toContain("text");
    });
  });

  describe("DROP FUNCTION (STATE-25)", () => {
    test("removes function", async () => {
      const { state } = await applySQL(
        "CREATE FUNCTION foo() RETURNS void AS $$ BEGIN END; $$ LANGUAGE plpgsql;",
        "DROP FUNCTION foo;"
      );
      expect(state.schemas.get("public")!.functions.has("foo")).toBe(false);
    });
  });

  describe("COMMENT ON (STATE-28)", () => {
    test("sets comment on table", async () => {
      const { state } = await applySQL(
        "CREATE TABLE t (id int);",
        "COMMENT ON TABLE t IS 'A test table';"
      );
      expect(state.schemas.get("public")!.tables.get("t")!.comment).toBe("A test table");
    });

    test("sets comment on column", async () => {
      const { state } = await applySQL(
        "CREATE TABLE t (id int, name text);",
        "COMMENT ON COLUMN t.name IS 'Full name';"
      );
      const col = state.schemas.get("public")!.tables.get("t")!.columns.find(c => c.name === "name")!;
      expect(col.comment).toBe("Full name");
    });
  });

  describe("PARTITION BY (ADV-01)", () => {
    test("CREATE TABLE with PARTITION BY RANGE stores partition info", async () => {
      const { state } = await applySQL(`CREATE TABLE measurements (
        id bigserial,
        sensor_id int NOT NULL,
        measured_at timestamptz NOT NULL,
        value double precision,
        PRIMARY KEY (id, measured_at)
      ) PARTITION BY RANGE (measured_at);`);
      const table = state.schemas.get("public")!.tables.get("measurements")!;
      expect(table.partitionBy).toBeDefined();
      expect(table.partitionBy!.method).toContain("RANGE");
      expect(table.partitionBy!.columns).toContain("measured_at");
    });
  });

  describe("PARTITION OF (ADV-02)", () => {
    test("CREATE TABLE PARTITION OF stores parent and bounds", async () => {
      const { state } = await applySQL(
        `CREATE TABLE measurements (
          id bigserial, measured_at timestamptz NOT NULL, PRIMARY KEY (id, measured_at)
        ) PARTITION BY RANGE (measured_at);`,
        `CREATE TABLE m_2025 PARTITION OF measurements
          FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');`
      );
      const child = state.schemas.get("public")!.tables.get("m_2025")!;
      expect(child.partitionOf).toBeDefined();
      expect(child.partitionOf!.parent).toBe("measurements");
      expect(child.partitionOf!.bounds).toContain("2025");
    });
  });

  describe("GENERATED ALWAYS AS (ADV-03)", () => {
    test("ADD COLUMN with GENERATED ALWAYS AS STORED", async () => {
      const { state } = await applySQL(
        "CREATE TABLE orders (id int PRIMARY KEY, total_cents int NOT NULL);",
        "ALTER TABLE orders ADD COLUMN total_display text GENERATED ALWAYS AS (total_cents::text) STORED;"
      );
      const col = state.schemas.get("public")!.tables.get("orders")!.columns.find(c => c.name === "total_display")!;
      expect(col.generated).toBeDefined();
      expect(col.generated!.stored).toBe(true);
      expect(col.generated!.expression).toBeTruthy();
    });

    test("CREATE TABLE with inline generated column", async () => {
      const { state } = await applySQL(
        "CREATE TABLE t (id int PRIMARY KEY, val int, doubled int GENERATED ALWAYS AS (val * 2) STORED);"
      );
      const col = state.schemas.get("public")!.tables.get("t")!.columns.find(c => c.name === "doubled")!;
      expect(col.generated).toBeDefined();
      expect(col.generated!.stored).toBe(true);
    });
  });

  describe("INHERITS (ADV-07)", () => {
    test("CREATE TABLE with INHERITS stores parent reference", async () => {
      const { state } = await applySQL(
        "CREATE TABLE parent (id int PRIMARY KEY, data text);",
        "CREATE TABLE child (extra text) INHERITS (parent);"
      );
      const child = state.schemas.get("public")!.tables.get("child")!;
      expect(child.inherits).toBeDefined();
      expect(child.inherits).toContain("parent");
    });
  });
});
