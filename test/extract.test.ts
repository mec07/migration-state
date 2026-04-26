import { describe, test, expect } from "bun:test";
import {
  extractSql,
  extractUpSection,
  detectMarkerType,
  stripBom,
  normalizeLineEndings,
} from "../src/extract";
import { join } from "path";
import type { MigrationFile } from "../src/types";

const FIXTURES = join(import.meta.dir, "fixtures");

describe("detectMarkerType", () => {
  test("goose content returns 'goose'", () => {
    expect(detectMarkerType("-- +goose Up\nCREATE TABLE t (id int);")).toBe(
      "goose",
    );
  });

  test("dbmate content returns 'dbmate'", () => {
    expect(detectMarkerType("-- migrate:up\nCREATE TABLE t (id int);")).toBe(
      "dbmate",
    );
  });

  test("sql-migrate content returns 'sql-migrate'", () => {
    expect(
      detectMarkerType("-- +migrate Up\nCREATE TABLE t (id int);"),
    ).toBe("sql-migrate");
  });

  test("no markers returns null", () => {
    expect(detectMarkerType("CREATE TABLE t (id int);")).toBeNull();
  });
});

describe("extractUpSection", () => {
  test("goose: extracts between Up and Down", () => {
    const content = [
      "-- +goose Up",
      "CREATE TABLE users (id int);",
      "",
      "-- +goose Down",
      "DROP TABLE users;",
    ].join("\n");
    const result = extractUpSection(content, "goose");
    expect(result).toBe("CREATE TABLE users (id int);");
  });

  test("goose: extracts to EOF when no Down marker", () => {
    const content = [
      "-- +goose Up",
      "CREATE TABLE users (id int);",
      "CREATE INDEX idx ON users(id);",
    ].join("\n");
    const result = extractUpSection(content, "goose");
    expect(result).toBe(
      "CREATE TABLE users (id int);\nCREATE INDEX idx ON users(id);",
    );
  });

  test("goose: strips StatementBegin/StatementEnd markers", () => {
    const content = [
      "-- +goose Up",
      "-- +goose StatementBegin",
      "CREATE FUNCTION foo() RETURNS void AS $$ BEGIN END; $$ LANGUAGE plpgsql;",
      "-- +goose StatementEnd",
      "",
      "-- +goose Down",
      "DROP FUNCTION foo;",
    ].join("\n");
    const result = extractUpSection(content, "goose");
    expect(result).not.toContain("StatementBegin");
    expect(result).not.toContain("StatementEnd");
    expect(result).toContain("CREATE FUNCTION foo()");
  });

  test("dbmate: extracts between migrate:up and migrate:down", () => {
    const content = [
      "-- migrate:up",
      "CREATE TABLE users (id int);",
      "",
      "-- migrate:down",
      "DROP TABLE users;",
    ].join("\n");
    const result = extractUpSection(content, "dbmate");
    expect(result).toBe("CREATE TABLE users (id int);");
  });

  test("sql-migrate: extracts between +migrate Up and +migrate Down", () => {
    const content = [
      "-- +migrate Up",
      "CREATE TABLE users (id int);",
      "",
      "-- +migrate Down",
      "DROP TABLE users;",
    ].join("\n");
    const result = extractUpSection(content, "sql-migrate");
    expect(result).toBe("CREATE TABLE users (id int);");
  });
});

describe("stripBom", () => {
  test("strips UTF-8 BOM", () => {
    const bom = "\uFEFF";
    const result = stripBom(bom + "hello");
    expect(result).toBe("hello");
    expect(result.charCodeAt(0)).toBe(104); // 'h'
  });

  test("leaves non-BOM content unchanged", () => {
    const input = "hello world";
    expect(stripBom(input)).toBe(input);
  });
});

describe("normalizeLineEndings", () => {
  test("converts CRLF to LF", () => {
    expect(normalizeLineEndings("a\r\nb\r\nc")).toBe("a\nb\nc");
  });

  test("leaves LF unchanged", () => {
    expect(normalizeLineEndings("a\nb\nc")).toBe("a\nb\nc");
  });
});

describe("extractSql", () => {
  test("flat-numbered: returns all 2 files' content", () => {
    const files: MigrationFile[] = [
      {
        path: join(FIXTURES, "flat-numbered/001_create_users.sql"),
        version: "001",
      },
      {
        path: join(FIXTURES, "flat-numbered/002_create_orders.sql"),
        version: "002",
      },
    ];
    const result = extractSql(files);
    expect(result.sql.length).toBe(2);
    expect(result.sql[0]).toContain("CREATE TABLE users");
    expect(result.sql[1]).toContain("CREATE TABLE orders");
    expect(result.warnings.length).toBe(0);
  });

  test("goose-markers file 001: contains CREATE TABLE, not DROP TABLE", () => {
    const files: MigrationFile[] = [
      {
        path: join(FIXTURES, "goose-markers/001_create_users.sql"),
        version: "001",
      },
    ];
    const result = extractSql(files);
    expect(result.sql.length).toBe(1);
    expect(result.sql[0]).toContain("CREATE TABLE");
    expect(result.sql[0]).not.toContain("DROP TABLE");
  });

  test("goose-markers file 002: contains CREATE FUNCTION, no StatementBegin/End", () => {
    const files: MigrationFile[] = [
      {
        path: join(FIXTURES, "goose-markers/002_add_function.sql"),
        version: "002",
      },
    ];
    const result = extractSql(files);
    expect(result.sql.length).toBe(1);
    expect(result.sql[0]).toContain("CREATE OR REPLACE FUNCTION");
    expect(result.sql[0]).not.toContain("DROP FUNCTION");
    expect(result.sql[0]).not.toContain("StatementBegin");
    expect(result.sql[0]).not.toContain("StatementEnd");
  });

  test("empty file: skipped with warning", () => {
    const files: MigrationFile[] = [
      {
        path: join(FIXTURES, "empty-and-edge-cases/002_empty.sql"),
        version: "002",
      },
    ];
    const result = extractSql(files);
    expect(result.sql.length).toBe(0);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0].level).toBe("warn");
    expect(result.warnings[0].stage).toBe("extraction");
  });

  test("comments-only file: skipped with warning", () => {
    const files: MigrationFile[] = [
      {
        path: join(FIXTURES, "empty-and-edge-cases/003_comments_only.sql"),
        version: "003",
      },
    ];
    const result = extractSql(files);
    expect(result.sql.length).toBe(0);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0].level).toBe("warn");
    expect(result.warnings[0].stage).toBe("extraction");
  });

  test("BOM+CRLF file: normalized", () => {
    const files: MigrationFile[] = [
      {
        path: join(FIXTURES, "empty-and-edge-cases/004_bom_crlf.sql"),
        version: "004",
      },
    ];
    const result = extractSql(files);
    expect(result.sql.length).toBe(1);
    expect(result.sql[0]).not.toContain("\uFEFF");
    expect(result.sql[0]).not.toContain("\r");
    expect(result.sql[0]).toContain("CREATE TABLE bom_test");
  });
});
