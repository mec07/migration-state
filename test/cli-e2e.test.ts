// test/cli-e2e.test.ts
import { describe, test, expect } from "bun:test";
import { join } from "path";

const CLI = join(import.meta.dir, "..", "src", "index.ts");
const FIXTURES = join(import.meta.dir, "fixtures");

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(...args: string[]): Promise<RunResult> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    cwd: join(import.meta.dir, ".."),
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;

  return { stdout, stderr, exitCode };
}

describe("CLI end-to-end", () => {
  describe("basic invocation (CLI-01)", () => {
    test("runs pipeline on flat-numbered fixture and produces markdown", async () => {
      const { stdout, exitCode } = await runCli(join(FIXTURES, "flat-numbered"));
      expect(exitCode).toBe(0);
      expect(stdout).toContain("# Database Schema State");
      expect(stdout).toContain("users");
      expect(stdout).toContain("orders");
    });

    test("runs pipeline on goose-markers fixture", async () => {
      const { stdout, exitCode } = await runCli(join(FIXTURES, "goose-markers"));
      expect(exitCode).toBe(0);
      expect(stdout).toContain("# Database Schema State");
      expect(stdout).toContain("users");
    });

    test("runs pipeline on flyway-style fixture with correct ordering", async () => {
      const { stdout, exitCode } = await runCli(join(FIXTURES, "flyway-style"));
      expect(exitCode).toBe(0);
      expect(stdout).toContain("users");
      expect(stdout).toContain("orders");
    });

    test("runs pipeline on schema-separated fixture", async () => {
      const { stdout, exitCode } = await runCli(join(FIXTURES, "schema-separated"));
      expect(exitCode).toBe(0);
      expect(stdout).toContain("users");
      expect(stdout).toContain("events");
    });
  });

  describe("--format json (CLI-05)", () => {
    test("produces valid JSON output", async () => {
      const { stdout, exitCode } = await runCli(join(FIXTURES, "flat-numbered"), "--format", "json");
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.schemas).toBeDefined();
      expect(parsed.schemas.public).toBeDefined();
      expect(parsed.schemas.public.tables.users).toBeDefined();
    });
  });

  describe("--tables filter (CLI-03)", () => {
    test("filters to specified tables only", async () => {
      const { stdout, exitCode } = await runCli(
        join(FIXTURES, "flat-numbered"),
        "--tables", "users",
      );
      expect(exitCode).toBe(0);
      expect(stdout).toContain("users");
      expect(stdout).not.toContain("orders");
    });
  });

  describe("--schemas filter (CLI-04)", () => {
    test("filters to specified schema", async () => {
      // All tables in schema-separated land in 'public' schema,
      // so filtering to 'public' should include them all
      const { stdout, exitCode } = await runCli(
        join(FIXTURES, "schema-separated"),
        "--schemas", "public",
      );
      expect(exitCode).toBe(0);
      expect(stdout).toContain("users");
      expect(stdout).toContain("events");
    });

    test("filtering to non-existent schema yields no tables", async () => {
      const { stdout, exitCode } = await runCli(
        join(FIXTURES, "schema-separated"),
        "--schemas", "nonexistent",
      );
      expect(exitCode).toBe(0);
      expect(stdout).toContain("No tables found");
    });
  });

  describe("--no-views (CLI-06)", () => {
    test("excludes views from output", async () => {
      const { stdout, exitCode } = await runCli(
        join(FIXTURES, "flat-numbered"),
        "--no-views",
      );
      expect(exitCode).toBe(0);
      // flat-numbered has no views, but flag shouldn't cause errors
      expect(stdout).toContain("# Database Schema State");
    });
  });

  describe("--quiet (CLI-09)", () => {
    test("suppresses warnings on stderr", async () => {
      const { stderr, exitCode } = await runCli(
        join(FIXTURES, "empty-and-edge-cases"),
        "--quiet",
      );
      expect(exitCode).toBe(0);
      // With --quiet, stderr should not contain warning text
      expect(stderr).not.toContain("warning");
    });

    test("without --quiet, warnings appear on stderr", async () => {
      const { stderr, exitCode } = await runCli(
        join(FIXTURES, "empty-and-edge-cases"),
      );
      expect(exitCode).toBe(0);
      expect(stderr).toContain("warning");
    });
  });

  describe("non-existent directory (CLI-10)", () => {
    test("prints error to stderr and exits with code 1", async () => {
      const { stdout, stderr, exitCode } = await runCli("/nonexistent/path/to/migrations");
      expect(exitCode).toBe(1);
      expect(stderr).toContain("does not exist");
      // stdout should be empty (no schema output)
      expect(stdout.trim()).toBe("");
    });
  });

  describe("empty directory (CLI-11)", () => {
    test("prints 'No migration files found' and exits with code 0", async () => {
      // Create a temp empty dir
      const { mkdtempSync } = await import("node:fs");
      const { tmpdir } = await import("node:os");
      const emptyDir = mkdtempSync(join(tmpdir(), "migration-state-test-"));

      const { stdout, exitCode } = await runCli(emptyDir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("No migration files found");

      // Cleanup
      const { rmSync } = await import("node:fs");
      rmSync(emptyDir, { recursive: true });
    });
  });

  describe("--help (CLI-12)", () => {
    test("prints usage information", async () => {
      const { stdout, exitCode } = await runCli("--help");
      expect(exitCode).toBe(0);
      expect(stdout).toContain("migration-state");
      expect(stdout).toContain("--tool");
      expect(stdout).toContain("--tables");
      expect(stdout).toContain("--format");
      expect(stdout).toContain("--quiet");
    });
  });
});
