import { describe, test, expect } from "bun:test";
import { discover, extractVersion, isSchemaDirectory } from "../src/discover";
import { join } from "path";

const FIXTURES = join(import.meta.dir, "fixtures");

describe("extractVersion", () => {
  test("numeric prefix: 001_name.sql", () => {
    expect(extractVersion("001_create_users.sql")).toBe("001");
  });
  test("numeric prefix: 001_name.up.sql", () => {
    expect(extractVersion("001_create_users.up.sql")).toBe("001");
  });
  test("flyway V prefix: V1__name.sql", () => {
    expect(extractVersion("V1__create_users.sql")).toBe("1");
  });
  test("flyway semantic: V1.2.3__name.sql", () => {
    expect(extractVersion("V1.2.3__name.sql")).toBe("1.2.3");
  });
  test("timestamp prefix: 20240101120000_name.sql", () => {
    expect(extractVersion("20240101120000_name.sql")).toBe("20240101120000");
  });
  test("directory-per-migration: uses parent dir name", () => {
    expect(extractVersion("migration.sql", "20240101_create_users")).toBe("20240101");
  });
  test("no version found: returns filename", () => {
    expect(extractVersion("random.sql")).toBe("random.sql");
  });
});

describe("isSchemaDirectory", () => {
  test("schema-like names return true", () => {
    expect(isSchemaDirectory("public")).toBe(true);
    expect(isSchemaDirectory("audit")).toBe(true);
    expect(isSchemaDirectory("my_schema")).toBe(true);
  });
  test("version-like names return false", () => {
    expect(isSchemaDirectory("001_create_users")).toBe(false);
    expect(isSchemaDirectory("20240101_init")).toBe(false);
    expect(isSchemaDirectory("V1__init")).toBe(false);
  });
});

describe("discover", () => {
  test("flat numbered files: finds 3 files in order", () => {
    const result = discover(join(FIXTURES, "flat-numbered"));
    expect(result.files.length).toBe(3);
    expect(result.files[0].version).toBe("001");
    expect(result.files[1].version).toBe("002");
    expect(result.files[2].version).toBe("003");
    expect(result.files[0].schema).toBeUndefined();
  });

  test("up/down pairs: finds only .up.sql files", () => {
    const result = discover(join(FIXTURES, "up-down-pairs"));
    expect(result.files.length).toBe(2);
    expect(result.files.every(f => f.path.endsWith(".up.sql"))).toBe(true);
  });

  test("goose markers: finds all .sql files (markers handled in extraction)", () => {
    const result = discover(join(FIXTURES, "goose-markers"));
    expect(result.files.length).toBe(2);
  });

  test("dir-per-migration: finds migration.sql inside each dir", () => {
    const result = discover(join(FIXTURES, "dir-per-migration"));
    expect(result.files.length).toBe(2);
    expect(result.files[0].path).toContain("migration.sql");
    expect(result.files[0].version).toBe("20240101");
  });

  test("flyway style: finds V-prefixed files, sorted correctly", () => {
    const result = discover(join(FIXTURES, "flyway-style"));
    expect(result.files.length).toBe(3);
    expect(result.files[0].version).toBe("1");
    expect(result.files[1].version).toBe("1.1");
    expect(result.files[2].version).toBe("2");
  });

  test("schema-separated: detects schema directories, tags files", () => {
    const result = discover(join(FIXTURES, "schema-separated"));
    expect(result.files.length).toBe(3);
    const publicFiles = result.files.filter(f => f.schema === "public");
    const auditFiles = result.files.filter(f => f.schema === "audit");
    expect(publicFiles.length).toBe(2);
    expect(auditFiles.length).toBe(1);
  });

  test("flyway callbacks: excludes beforeMigrate.sql and afterMigrate.sql", () => {
    const result = discover(join(FIXTURES, "flyway-callbacks"));
    expect(result.files.length).toBe(1);
    expect(result.files[0].path).toContain("V1__create_users.sql");
  });

  test("non-existent directory: returns empty with error warning", () => {
    const result = discover("/nonexistent/path");
    expect(result.files.length).toBe(0);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings[0].level).toBe("error");
  });

  test("empty directory fixture: finds non-empty SQL files", () => {
    const result = discover(join(FIXTURES, "empty-and-edge-cases"));
    expect(result.files.length).toBeGreaterThanOrEqual(1);
  });
});
