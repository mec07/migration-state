import { describe, test, expect } from "bun:test";
import { parseMigrations, DDL_TYPES } from "../src/parse";
import type { ParseResult } from "../src/parse";

// ---------------------------------------------------------------------------
// Helper: parse a single SQL string from a single file
// ---------------------------------------------------------------------------
async function parseSingle(
  sql: string,
  file = "test.sql",
): Promise<ParseResult> {
  return parseMigrations([sql], [file]);
}

// ---------------------------------------------------------------------------
// 1. DDL statements pass through (19 tests)
// ---------------------------------------------------------------------------
describe("DDL statements pass through", () => {
  test("CREATE TABLE → CreateStmt", async () => {
    const r = await parseSingle(
      "CREATE TABLE t (id serial PRIMARY KEY, name text);",
    );
    expect(r.statements).toHaveLength(1);
    expect(r.statements[0].type).toBe("CreateStmt");
    expect(r.statements[0].sql).toBeTruthy();
    expect(r.statements[0].source.file).toBe("test.sql");
    expect(r.statements[0].source.statementIndex).toBe(0);
  });

  test("ALTER TABLE → AlterTableStmt", async () => {
    const r = await parseSingle(
      "ALTER TABLE t ADD COLUMN age int;",
    );
    expect(r.statements).toHaveLength(1);
    expect(r.statements[0].type).toBe("AlterTableStmt");
    expect(r.statements[0].sql).toBeTruthy();
    expect(r.statements[0].source.file).toBe("test.sql");
  });

  test("CREATE INDEX → IndexStmt", async () => {
    const r = await parseSingle("CREATE INDEX idx_t_name ON t (name);");
    expect(r.statements).toHaveLength(1);
    expect(r.statements[0].type).toBe("IndexStmt");
    expect(r.statements[0].sql).toBeTruthy();
  });

  test("DROP TABLE → DropStmt", async () => {
    const r = await parseSingle("DROP TABLE IF EXISTS t;");
    expect(r.statements).toHaveLength(1);
    expect(r.statements[0].type).toBe("DropStmt");
    expect(r.statements[0].sql).toBeTruthy();
  });

  test("CREATE ENUM → CreateEnumStmt", async () => {
    const r = await parseSingle(
      "CREATE TYPE status AS ENUM ('a', 'b', 'c');",
    );
    expect(r.statements).toHaveLength(1);
    expect(r.statements[0].type).toBe("CreateEnumStmt");
    expect(r.statements[0].sql).toBeTruthy();
  });

  test("ALTER ENUM → AlterEnumStmt", async () => {
    const r = await parseSingle(
      "ALTER TYPE status ADD VALUE 'd' AFTER 'c';",
    );
    expect(r.statements).toHaveLength(1);
    expect(r.statements[0].type).toBe("AlterEnumStmt");
    expect(r.statements[0].sql).toBeTruthy();
  });

  test("CREATE TRIGGER → CreateTrigStmt", async () => {
    const r = await parseSingle(
      "CREATE TRIGGER trg BEFORE INSERT ON t FOR EACH ROW EXECUTE FUNCTION fn();",
    );
    expect(r.statements).toHaveLength(1);
    expect(r.statements[0].type).toBe("CreateTrigStmt");
    expect(r.statements[0].sql).toBeTruthy();
  });

  test("CREATE FUNCTION → CreateFunctionStmt", async () => {
    const r = await parseSingle(
      "CREATE FUNCTION fn() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;",
    );
    expect(r.statements).toHaveLength(1);
    expect(r.statements[0].type).toBe("CreateFunctionStmt");
    expect(r.statements[0].sql).toBeTruthy();
  });

  test("CREATE VIEW → ViewStmt", async () => {
    const r = await parseSingle(
      "CREATE VIEW v AS SELECT 1 AS id;",
    );
    expect(r.statements).toHaveLength(1);
    expect(r.statements[0].type).toBe("ViewStmt");
    expect(r.statements[0].sql).toBeTruthy();
  });

  test("CREATE SCHEMA → CreateSchemaStmt", async () => {
    const r = await parseSingle("CREATE SCHEMA IF NOT EXISTS myschema;");
    expect(r.statements).toHaveLength(1);
    expect(r.statements[0].type).toBe("CreateSchemaStmt");
    expect(r.statements[0].sql).toBeTruthy();
  });

  test("CREATE SEQUENCE → CreateSeqStmt", async () => {
    const r = await parseSingle("CREATE SEQUENCE myseq START 1;");
    expect(r.statements).toHaveLength(1);
    expect(r.statements[0].type).toBe("CreateSeqStmt");
    expect(r.statements[0].sql).toBeTruthy();
  });

  test("ALTER SEQUENCE → AlterSeqStmt", async () => {
    const r = await parseSingle("ALTER SEQUENCE myseq RESTART WITH 100;");
    expect(r.statements).toHaveLength(1);
    expect(r.statements[0].type).toBe("AlterSeqStmt");
    expect(r.statements[0].sql).toBeTruthy();
  });

  test("CREATE EXTENSION → CreateExtensionStmt", async () => {
    const r = await parseSingle(
      'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";',
    );
    expect(r.statements).toHaveLength(1);
    expect(r.statements[0].type).toBe("CreateExtensionStmt");
    expect(r.statements[0].sql).toBeTruthy();
  });

  test("COMMENT ON → CommentStmt", async () => {
    const r = await parseSingle(
      "COMMENT ON TABLE t IS 'A table';",
    );
    expect(r.statements).toHaveLength(1);
    expect(r.statements[0].type).toBe("CommentStmt");
    expect(r.statements[0].sql).toBeTruthy();
  });

  test("CREATE POLICY → CreatePolicyStmt", async () => {
    const r = await parseSingle(
      "CREATE POLICY pol ON t FOR SELECT USING (true);",
    );
    expect(r.statements).toHaveLength(1);
    expect(r.statements[0].type).toBe("CreatePolicyStmt");
    expect(r.statements[0].sql).toBeTruthy();
  });

  test("CREATE DOMAIN → CreateDomainStmt", async () => {
    const r = await parseSingle(
      "CREATE DOMAIN posint AS integer CHECK (VALUE > 0);",
    );
    expect(r.statements).toHaveLength(1);
    expect(r.statements[0].type).toBe("CreateDomainStmt");
    expect(r.statements[0].sql).toBeTruthy();
  });

  test("RENAME → RenameStmt", async () => {
    const r = await parseSingle(
      "ALTER TABLE t RENAME COLUMN old_col TO new_col;",
    );
    expect(r.statements).toHaveLength(1);
    expect(r.statements[0].type).toBe("RenameStmt");
    expect(r.statements[0].sql).toBeTruthy();
  });

  test("SET SCHEMA → AlterObjectSchemaStmt", async () => {
    const r = await parseSingle(
      "ALTER TABLE t SET SCHEMA myschema;",
    );
    expect(r.statements).toHaveLength(1);
    expect(r.statements[0].type).toBe("AlterObjectSchemaStmt");
    expect(r.statements[0].sql).toBeTruthy();
  });

  test("ENABLE RLS → AlterTableStmt", async () => {
    const r = await parseSingle(
      "ALTER TABLE t ENABLE ROW LEVEL SECURITY;",
    );
    expect(r.statements).toHaveLength(1);
    expect(r.statements[0].type).toBe("AlterTableStmt");
    expect(r.statements[0].sql).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 2. Non-DDL silently skipped (9 tests)
// ---------------------------------------------------------------------------
describe("Non-DDL silently skipped", () => {
  test("INSERT → 0 statements, 0 warnings", async () => {
    const r = await parseSingle("INSERT INTO t (id) VALUES (1);");
    expect(r.statements).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });

  test("UPDATE → 0 statements, 0 warnings", async () => {
    const r = await parseSingle("UPDATE t SET name = 'x' WHERE id = 1;");
    expect(r.statements).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });

  test("DELETE → 0 statements, 0 warnings", async () => {
    const r = await parseSingle("DELETE FROM t WHERE id = 1;");
    expect(r.statements).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });

  test("SELECT → 0 statements, 0 warnings", async () => {
    const r = await parseSingle("SELECT * FROM t;");
    expect(r.statements).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });

  test("GRANT → 0 statements, 0 warnings", async () => {
    const r = await parseSingle("GRANT SELECT ON t TO role1;");
    expect(r.statements).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });

  test("REVOKE → 0 statements, 0 warnings", async () => {
    const r = await parseSingle("REVOKE SELECT ON t FROM role1;");
    expect(r.statements).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });

  test("SET → 0 statements, 0 warnings", async () => {
    const r = await parseSingle("SET search_path TO public;");
    expect(r.statements).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });

  test("BEGIN → 0 statements, 0 warnings", async () => {
    const r = await parseSingle("BEGIN;");
    expect(r.statements).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });

  test("COMMIT → 0 statements, 0 warnings", async () => {
    const r = await parseSingle("COMMIT;");
    expect(r.statements).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Multi-statement input (3 tests)
// ---------------------------------------------------------------------------
describe("Multi-statement input", () => {
  test("mixed DDL+DML in one string: only DDL passes through", async () => {
    const sql = [
      "CREATE TABLE t (id int);",
      "INSERT INTO t VALUES (1);",
      "ALTER TABLE t ADD COLUMN name text;",
      "SELECT * FROM t;",
    ].join("\n");
    const r = await parseSingle(sql);
    expect(r.statements).toHaveLength(2);
    expect(r.statements[0].type).toBe("CreateStmt");
    expect(r.statements[1].type).toBe("AlterTableStmt");
    expect(r.warnings).toHaveLength(0);
  });

  test("multiple SQL strings from different files: source.file correct per statement", async () => {
    const r = await parseMigrations(
      [
        "CREATE TABLE a (id int);",
        "CREATE TABLE b (id int);",
      ],
      ["001_a.sql", "002_b.sql"],
    );
    expect(r.statements).toHaveLength(2);
    expect(r.statements[0].source.file).toBe("001_a.sql");
    expect(r.statements[1].source.file).toBe("002_b.sql");
  });

  test("statement indices are per-file not global", async () => {
    const r = await parseMigrations(
      [
        "CREATE TABLE a (id int); CREATE TABLE b (id int);",
        "CREATE TABLE c (id int); CREATE TABLE d (id int);",
      ],
      ["file1.sql", "file2.sql"],
    );
    expect(r.statements).toHaveLength(4);
    // File 1: indices 0, 1
    expect(r.statements[0].source.file).toBe("file1.sql");
    expect(r.statements[0].source.statementIndex).toBe(0);
    expect(r.statements[1].source.file).toBe("file1.sql");
    expect(r.statements[1].source.statementIndex).toBe(1);
    // File 2: indices reset to 0, 1
    expect(r.statements[2].source.file).toBe("file2.sql");
    expect(r.statements[2].source.statementIndex).toBe(0);
    expect(r.statements[3].source.file).toBe("file2.sql");
    expect(r.statements[3].source.statementIndex).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Error handling (2 tests)
// ---------------------------------------------------------------------------
describe("Error handling", () => {
  test("unparseable SQL → warning with original SQL, 0 statements", async () => {
    const badSql = "NOT VALID SQL AT ALL %%% $$$ ;;;";
    const r = await parseSingle(badSql, "bad.sql");
    expect(r.statements).toHaveLength(0);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].level).toBe("warn");
    expect(r.warnings[0].stage).toBe("parsing");
    expect(r.warnings[0].source?.file).toBe("bad.sql");
    expect(r.warnings[0].source?.sql).toBe(badSql);
  });

  test("one bad file doesn't prevent others from parsing", async () => {
    const r = await parseMigrations(
      [
        "NOT VALID SQL %%% $$$",
        "CREATE TABLE good (id int);",
      ],
      ["bad.sql", "good.sql"],
    );
    expect(r.statements).toHaveLength(1);
    expect(r.statements[0].type).toBe("CreateStmt");
    expect(r.statements[0].source.file).toBe("good.sql");
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].source?.file).toBe("bad.sql");
  });
});

// ---------------------------------------------------------------------------
// 5. DO block handling (3 tests)
// ---------------------------------------------------------------------------
describe("DO block handling", () => {
  test("DO block with CREATE TYPE inside → extracts CreateEnumStmt", async () => {
    const sql = `DO $$ BEGIN
  CREATE TYPE mood AS ENUM ('happy', 'sad');
END $$;`;
    const r = await parseSingle(sql);
    expect(r.statements).toHaveLength(1);
    expect(r.statements[0].type).toBe("CreateEnumStmt");
    expect(r.statements[0].sql).toContain("CREATE TYPE mood");
  });

  test("DO block with no DDL → info warning", async () => {
    const sql = `DO $$ BEGIN
  RAISE NOTICE 'hello';
END $$;`;
    const r = await parseSingle(sql);
    expect(r.statements).toHaveLength(0);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].level).toBe("info");
    expect(r.warnings[0].stage).toBe("parsing");
    expect(r.warnings[0].message).toContain("no extractable DDL");
  });

  test("DO block with ALTER TYPE inside → extracts AlterEnumStmt", async () => {
    const sql = `DO $$ BEGIN
  ALTER TYPE mood ADD VALUE IF NOT EXISTS 'neutral';
END $$;`;
    const r = await parseSingle(sql);
    expect(r.statements).toHaveLength(1);
    expect(r.statements[0].type).toBe("AlterEnumStmt");
    expect(r.statements[0].sql).toContain("ALTER TYPE mood");
  });
});

// ---------------------------------------------------------------------------
// 6. DDL_TYPES allowlist (2 tests)
// ---------------------------------------------------------------------------
describe("DDL_TYPES allowlist", () => {
  test("contains all expected types", () => {
    const expected = [
      "CreateStmt",
      "AlterTableStmt",
      "IndexStmt",
      "DropStmt",
      "CreateEnumStmt",
      "AlterEnumStmt",
      "CompositeTypeStmt",
      "CreateTrigStmt",
      "CreateFunctionStmt",
      "ViewStmt",
      "CreateSchemaStmt",
      "CreateSeqStmt",
      "AlterSeqStmt",
      "CreateExtensionStmt",
      "CommentStmt",
      "CreatePolicyStmt",
      "CreateDomainStmt",
      "RenameStmt",
      "AlterObjectSchemaStmt",
    ];
    for (const t of expected) {
      expect(DDL_TYPES.has(t)).toBe(true);
    }
    expect(DDL_TYPES.size).toBe(expected.length);
  });

  test("does not contain DML/DCL types", () => {
    const excluded = [
      "InsertStmt",
      "UpdateStmt",
      "DeleteStmt",
      "SelectStmt",
      "GrantStmt",
      "VariableSetStmt",
      "TransactionStmt",
    ];
    for (const t of excluded) {
      expect(DDL_TYPES.has(t)).toBe(false);
    }
  });
});
