// test/output.test.ts
import { describe, test, expect } from "bun:test";
import { renderMarkdown, renderJson } from "../src/output";
import { applyMigrations } from "../src/apply";
import { parseMigrations } from "../src/parse";
import { createEmptyState } from "../src/types";
import type { SchemaState, OutputOptions } from "../src/types";

// Helper: build state from SQL, then render
async function buildAndRender(
  sqls: string[],
  options?: Partial<OutputOptions>,
  meta?: Partial<{ migrationCount: number; tool: string; dir: string }>,
): Promise<string> {
  const files = sqls.map((_, i) => `${String(i + 1).padStart(3, "0")}.sql`);
  const parsed = await parseMigrations(sqls, files);
  const { state } = applyMigrations(parsed.statements);
  const fullOptions: OutputOptions = {
    format: "markdown",
    includeViews: true,
    includeFunctions: true,
    includeSequences: true,
    ...options,
  };
  const fullMeta = {
    migrationCount: sqls.length,
    tool: "generic",
    dir: "./migrations",
    ...meta,
  };
  return renderMarkdown(state, fullOptions, fullMeta);
}

async function buildState(sqls: string[]): Promise<SchemaState> {
  const files = sqls.map((_, i) => `${String(i + 1).padStart(3, "0")}.sql`);
  const parsed = await parseMigrations(sqls, files);
  return applyMigrations(parsed.statements).state;
}

const defaultOptions: OutputOptions = {
  format: "markdown",
  includeViews: true,
  includeFunctions: true,
  includeSequences: true,
};

const defaultMeta = { migrationCount: 3, tool: "goose", dir: "./db/migrations" };

describe("renderMarkdown", () => {
  describe("summary header (OUT-03)", () => {
    test("includes migration count, tool, and directory", async () => {
      const md = await buildAndRender(
        ["CREATE TABLE t (id int PRIMARY KEY);"],
        {},
        { migrationCount: 42, tool: "goose", dir: "db/migrations" },
      );
      expect(md).toContain("42");
      expect(md).toContain("goose");
      expect(md).toContain("db/migrations");
    });
  });

  describe("table columns (OUT-01)", () => {
    test("renders column table with name, type, nullable, default", async () => {
      const md = await buildAndRender([
        `CREATE TABLE users (
          id bigserial PRIMARY KEY,
          email varchar(255) NOT NULL,
          name text DEFAULT '',
          created_at timestamptz NOT NULL DEFAULT now()
        );`,
      ]);
      expect(md).toContain("| Column |");
      expect(md).toContain("| id |");
      expect(md).toContain("| email |");
      expect(md).toContain("| name |");
      expect(md).toContain("| created_at |");
      expect(md).toContain("NO"); // nullable = false
      expect(md).toContain("YES"); // nullable = true
    });

    test("table comment appears after table heading (OUT-07)", async () => {
      const md = await buildAndRender([
        "CREATE TABLE users (id int PRIMARY KEY);",
        "COMMENT ON TABLE users IS 'Core user accounts';",
      ]);
      expect(md).toContain("Core user accounts");
    });

    test("column comment appears in output (OUT-07)", async () => {
      const md = await buildAndRender([
        "CREATE TABLE users (id int PRIMARY KEY, email text);",
        "COMMENT ON COLUMN users.email IS 'Primary login identifier';",
      ]);
      expect(md).toContain("Primary login identifier");
    });
  });

  describe("constraints (OUT-04)", () => {
    test("PK constraint listed", async () => {
      const md = await buildAndRender(["CREATE TABLE t (id int PRIMARY KEY);"]);
      expect(md).toContain("PRIMARY KEY");
      expect(md).toContain("id");
    });

    test("FK constraint shows referenced table, columns, ON DELETE (OUT-04)", async () => {
      const md = await buildAndRender([
        "CREATE TABLE parents (id int PRIMARY KEY);",
        "CREATE TABLE children (id int PRIMARY KEY, parent_id int REFERENCES parents(id) ON DELETE CASCADE);",
      ]);
      expect(md).toContain("FOREIGN KEY");
      expect(md).toContain("parents");
      expect(md).toContain("CASCADE");
    });

    test("UNIQUE constraint listed", async () => {
      const md = await buildAndRender([
        "CREATE TABLE t (id int PRIMARY KEY, email text UNIQUE);",
      ]);
      expect(md).toContain("UNIQUE");
    });
  });

  describe("indices (OUT-06)", () => {
    test("index with method shown", async () => {
      const md = await buildAndRender([
        "CREATE TABLE t (id int PRIMARY KEY, data jsonb);",
        "CREATE INDEX idx_data ON t USING gin (data);",
      ]);
      expect(md).toContain("idx_data");
      expect(md).toContain("gin");
    });

    test("partial index shows WHERE clause", async () => {
      const md = await buildAndRender([
        "CREATE TABLE t (id int PRIMARY KEY, active boolean);",
        "CREATE INDEX idx_active ON t (id) WHERE active = true;",
      ]);
      expect(md).toContain("idx_active");
      expect(md).toContain("WHERE");
    });

    test("unique index marked", async () => {
      const md = await buildAndRender([
        "CREATE TABLE t (id int PRIMARY KEY, email text);",
        "CREATE UNIQUE INDEX idx_email ON t (email);",
      ]);
      expect(md).toContain("UNIQUE");
      expect(md).toContain("idx_email");
    });
  });

  describe("enums (OUT-05)", () => {
    test("enum values listed inline", async () => {
      const md = await buildAndRender([
        "CREATE TYPE status AS ENUM ('active', 'inactive', 'deleted');",
      ]);
      expect(md).toContain("status");
      expect(md).toContain("active");
      expect(md).toContain("inactive");
      expect(md).toContain("deleted");
    });
  });

  describe("triggers (OUT-01)", () => {
    test("trigger listed on table", async () => {
      const md = await buildAndRender([
        "CREATE TABLE t (id int PRIMARY KEY);",
        "CREATE TRIGGER trg BEFORE UPDATE ON t FOR EACH ROW EXECUTE FUNCTION fn();",
      ]);
      expect(md).toContain("trg");
      expect(md).toContain("BEFORE");
      expect(md).toContain("UPDATE");
      expect(md).toContain("fn");
    });
  });

  describe("views (OUT-01)", () => {
    test("views section rendered", async () => {
      const md = await buildAndRender([
        "CREATE TABLE t (id int PRIMARY KEY, name text);",
        "CREATE VIEW v AS SELECT id, name FROM t;",
      ]);
      expect(md).toContain("Views");
      expect(md).toContain("v");
    });

    test("views excluded when includeViews = false", async () => {
      const md = await buildAndRender(
        [
          "CREATE TABLE t (id int PRIMARY KEY);",
          "CREATE VIEW v AS SELECT id FROM t;",
        ],
        { includeViews: false },
      );
      expect(md).not.toContain("Views");
    });
  });

  describe("functions (OUT-01)", () => {
    test("functions section rendered", async () => {
      const md = await buildAndRender([
        "CREATE FUNCTION foo(x int) RETURNS text AS $$ BEGIN RETURN x::text; END; $$ LANGUAGE plpgsql;",
      ]);
      expect(md).toContain("Functions");
      expect(md).toContain("foo");
      expect(md).toContain("plpgsql");
    });

    test("functions excluded when includeFunctions = false", async () => {
      const md = await buildAndRender(
        ["CREATE FUNCTION foo() RETURNS void AS $$ BEGIN END; $$ LANGUAGE plpgsql;"],
        { includeFunctions: false },
      );
      expect(md).not.toContain("Functions");
    });
  });

  describe("sequences (OUT-01)", () => {
    test("sequences section rendered", async () => {
      const md = await buildAndRender([
        "CREATE SEQUENCE invoice_seq START 1000 INCREMENT 5;",
      ]);
      expect(md).toContain("Sequences");
      expect(md).toContain("invoice_seq");
    });

    test("sequences excluded when includeSequences = false", async () => {
      const md = await buildAndRender(
        ["CREATE SEQUENCE s;"],
        { includeSequences: false },
      );
      expect(md).not.toContain("Sequences");
    });
  });

  describe("filtering (OUT-08, OUT-09)", () => {
    test("--tables filters to specified tables only", async () => {
      const md = await buildAndRender(
        [
          "CREATE TABLE users (id int PRIMARY KEY);",
          "CREATE TABLE orders (id int PRIMARY KEY);",
          "CREATE TABLE products (id int PRIMARY KEY);",
        ],
        { tables: ["users", "orders"] },
      );
      expect(md).toContain("users");
      expect(md).toContain("orders");
      expect(md).not.toContain("products");
    });

    test("--tables includes related enums", async () => {
      const md = await buildAndRender(
        [
          "CREATE TYPE status AS ENUM ('active', 'inactive');",
          "CREATE TABLE users (id int PRIMARY KEY, status status);",
          "CREATE TABLE other (id int PRIMARY KEY);",
        ],
        { tables: ["users"] },
      );
      expect(md).toContain("users");
      expect(md).not.toContain("other");
      // Enum used by users should still appear
      expect(md).toContain("status");
    });

    test("--schemas filters to specified schemas", async () => {
      const md = await buildAndRender(
        [
          "CREATE TABLE users (id int PRIMARY KEY);",
          "CREATE SCHEMA audit;",
          "CREATE TABLE audit.events (id int PRIMARY KEY);",
        ],
        { schemas: ["audit"] },
      );
      expect(md).toContain("events");
      expect(md).not.toContain("users");
    });
  });

  describe("empty schema (OUT-10)", () => {
    test("empty schema produces 'No tables found' message", () => {
      const state = createEmptyState();
      const md = renderMarkdown(state, defaultOptions, defaultMeta);
      expect(md).toContain("No tables found");
    });
  });
});

describe("renderJson (OUT-02)", () => {
  test("produces valid JSON", async () => {
    const state = await buildState([
      "CREATE TABLE users (id int PRIMARY KEY, email text NOT NULL);",
      "CREATE TYPE status AS ENUM ('active', 'inactive');",
    ]);
    const json = renderJson(state, defaultOptions);
    const parsed = JSON.parse(json);
    expect(parsed).toBeDefined();
    expect(parsed.schemas).toBeDefined();
    expect(parsed.schemas.public).toBeDefined();
    expect(parsed.schemas.public.tables.users).toBeDefined();
  });

  test("Maps are converted to plain objects", async () => {
    const state = await buildState(["CREATE TABLE t (id int PRIMARY KEY);"]);
    const json = renderJson(state, defaultOptions);
    const parsed = JSON.parse(json);
    // Should be a plain object, not a Map serialisation
    expect(typeof parsed.schemas).toBe("object");
    expect(typeof parsed.schemas.public.tables).toBe("object");
    expect(parsed.schemas.public.tables.t).toBeDefined();
  });

  test("round-trips: can parse back to verify structure", async () => {
    const state = await buildState([
      "CREATE TABLE users (id int PRIMARY KEY, email text NOT NULL UNIQUE);",
      "CREATE INDEX idx ON users (email);",
    ]);
    const json = renderJson(state, defaultOptions);
    const parsed = JSON.parse(json);
    expect(parsed.schemas.public.tables.users.columns.length).toBe(2);
    expect(parsed.schemas.public.tables.users.indices.length).toBeGreaterThanOrEqual(1);
  });

  test("--tables filter applies to JSON", async () => {
    const state = await buildState([
      "CREATE TABLE users (id int PRIMARY KEY);",
      "CREATE TABLE orders (id int PRIMARY KEY);",
    ]);
    const json = renderJson(state, { ...defaultOptions, tables: ["users"] });
    const parsed = JSON.parse(json);
    expect(parsed.schemas.public.tables.users).toBeDefined();
    expect(parsed.schemas.public.tables.orders).toBeUndefined();
  });
});
