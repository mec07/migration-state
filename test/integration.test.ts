import { describe, test, expect } from "bun:test";
import { discover } from "../src/discover";
import { extractSql } from "../src/extract";
import { join } from "path";

const FIXTURES = join(import.meta.dir, "fixtures");

function discoverAndExtract(fixturePath: string) {
  const { files, warnings: discoverWarnings } = discover(fixturePath);
  const { sql, warnings: extractWarnings } = extractSql(files);
  return {
    files,
    sql,
    warnings: [...discoverWarnings, ...extractWarnings],
  };
}

describe("discover + extract integration", () => {
  test("flat-numbered: 3 migrations, all content preserved", () => {
    const result = discoverAndExtract(join(FIXTURES, "flat-numbered"));
    expect(result.sql.length).toBe(3);
    expect(result.sql[0]).toContain("CREATE TABLE users");
    expect(result.sql[1]).toContain("CREATE TABLE orders");
    expect(result.sql[2]).toContain("CREATE INDEX");
  });

  test("up-down-pairs: only UP files, DOWN excluded", () => {
    const result = discoverAndExtract(join(FIXTURES, "up-down-pairs"));
    expect(result.sql.length).toBe(2);
    expect(result.sql[0]).toContain("CREATE TABLE users");
    expect(result.sql[1]).toContain("ADD COLUMN name");
    for (const s of result.sql) {
      expect(s).not.toContain("DROP TABLE");
      expect(s).not.toContain("DROP COLUMN");
    }
  });

  test("goose-markers: UP section only, no DOWN content", () => {
    const result = discoverAndExtract(join(FIXTURES, "goose-markers"));
    expect(result.sql.length).toBe(2);
    expect(result.sql[0]).toContain("CREATE TABLE users");
    expect(result.sql[0]).not.toContain("DROP TABLE");
    expect(result.sql[1]).toContain("CREATE OR REPLACE FUNCTION");
    expect(result.sql[1]).not.toContain("DROP FUNCTION");
    expect(result.sql[1]).not.toContain("StatementBegin");
  });

  test("dbmate-markers: UP section only", () => {
    const result = discoverAndExtract(join(FIXTURES, "dbmate-markers"));
    expect(result.sql.length).toBe(1);
    expect(result.sql[0]).toContain("CREATE TABLE users");
    expect(result.sql[0]).not.toContain("DROP TABLE");
  });

  test("sql-migrate-markers: UP section only", () => {
    const result = discoverAndExtract(join(FIXTURES, "sql-migrate-markers"));
    expect(result.sql.length).toBe(1);
    expect(result.sql[0]).toContain("CREATE TABLE users");
    expect(result.sql[0]).not.toContain("DROP TABLE");
  });

  test("dir-per-migration: finds migration.sql in each dir", () => {
    const result = discoverAndExtract(join(FIXTURES, "dir-per-migration"));
    expect(result.sql.length).toBe(2);
    expect(result.sql[0]).toContain("CREATE TABLE users");
    expect(result.sql[1]).toContain("CREATE TABLE orders");
  });

  test("flyway-style: V-prefixed files in correct order", () => {
    const result = discoverAndExtract(join(FIXTURES, "flyway-style"));
    expect(result.sql.length).toBe(3);
    // V1 first, then V1.1, then V2
    expect(result.sql[0]).toContain("CREATE TABLE users");
    expect(result.sql[1]).toContain("ADD COLUMN name");
    expect(result.sql[2]).toContain("CREATE TABLE orders");
  });

  test("schema-separated: files tagged with schema, both schemas present", () => {
    const result = discoverAndExtract(join(FIXTURES, "schema-separated"));
    expect(result.files.length).toBe(3);
    expect(result.sql.length).toBe(3);
    const schemas = result.files.map(f => f.schema);
    expect(schemas).toContain("public");
    expect(schemas).toContain("audit");
  });

  test("flyway-callbacks: callbacks excluded", () => {
    const result = discoverAndExtract(join(FIXTURES, "flyway-callbacks"));
    expect(result.sql.length).toBe(1);
    expect(result.sql[0]).toContain("CREATE TABLE users");
    for (const s of result.sql) {
      expect(s).not.toContain("lock_timeout");
      expect(s).not.toContain("ANALYZE");
    }
  });

  test("empty-and-edge-cases: handles BOM, CRLF, empty, comments-only", () => {
    const result = discoverAndExtract(join(FIXTURES, "empty-and-edge-cases"));
    // Should get content from 001_normal.sql and 004_bom_crlf.sql
    // Should skip 002_empty.sql and 003_comments_only.sql with warnings
    expect(result.sql.length).toBe(2);
    expect(result.warnings.some(w => w.message.includes("empty") || w.message.includes("comments"))).toBe(true);
    for (const s of result.sql) {
      expect(s).not.toContain("\uFEFF");
      expect(s).not.toContain("\r");
    }
  });
});
