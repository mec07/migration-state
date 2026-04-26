// test/examples.test.ts
// Integration tests: run all 4 migration tool formats against the same SQL,
// verify they all produce identical output matching the expected baseline.
import { describe, test, expect } from "bun:test";
import { discover } from "../src/discover";
import { extractSql } from "../src/extract";
import { parseMigrations } from "../src/parse";
import { applyMigrations } from "../src/apply";
import { renderMarkdown } from "../src/output";
import { readFileSync } from "node:fs";
import { join } from "path";
import type { OutputOptions } from "../src/types";

const EXAMPLES = join(import.meta.dir, "..", "examples");

const options: OutputOptions = {
  format: "markdown",
  includeViews: true,
  includeFunctions: true,
  includeSequences: true,
};

function runPipeline(dir: string): string {
  const { files } = discover(dir);
  const { sql } = extractSql(files);
  const sourceFiles = files.map((f) => f.path);
  // parseMigrations is async, so we need to handle it
  return ""; // placeholder — actual impl below
}

async function runPipelineAsync(dir: string): Promise<string> {
  const { files } = discover(dir);
  const { sql } = extractSql(files);
  const sourceFiles = files.map((f) => f.path);
  const { statements } = await parseMigrations(sql, sourceFiles);
  const { state } = applyMigrations(statements);
  const meta = { migrationCount: files.length, tool: "generic", dir };
  return renderMarkdown(state, options, meta);
}

/** Strip the header line (contains dir path which differs) and return body */
function stripHeader(md: string): string {
  const lines = md.split("\n");
  // Remove first 3 lines: title, blank, "Generated from..." line
  return lines.slice(3).join("\n");
}

describe("examples: all 4 formats produce identical output", () => {
  let flyway: string;
  let goose: string;
  let golangMigrate: string;
  let prisma: string;

  test("flyway format produces output", async () => {
    flyway = await runPipelineAsync(join(EXAMPLES, "flyway"));
    expect(flyway).toContain("# Database Schema State");
    expect(flyway).toContain("users");
    expect(flyway).toContain("orders");
  });

  test("goose format produces output", async () => {
    goose = await runPipelineAsync(join(EXAMPLES, "goose"));
    expect(goose).toContain("# Database Schema State");
  });

  test("golang-migrate format produces output", async () => {
    golangMigrate = await runPipelineAsync(join(EXAMPLES, "golang-migrate"));
    expect(golangMigrate).toContain("# Database Schema State");
  });

  test("prisma format produces output", async () => {
    prisma = await runPipelineAsync(join(EXAMPLES, "prisma"));
    expect(prisma).toContain("# Database Schema State");
  });

  test("flyway and goose produce identical schema", async () => {
    expect(stripHeader(flyway)).toBe(stripHeader(goose));
  });

  test("flyway and golang-migrate produce identical schema", async () => {
    expect(stripHeader(flyway)).toBe(stripHeader(golangMigrate));
  });

  test("flyway and prisma produce identical schema", async () => {
    expect(stripHeader(flyway)).toBe(stripHeader(prisma));
  });
});

describe("examples: output matches expected baseline", () => {
  test("flyway output body matches expected/output.md body", async () => {
    const actual = await runPipelineAsync(join(EXAMPLES, "flyway"));
    const expected = readFileSync(join(EXAMPLES, "expected", "output.md"), "utf-8");
    expect(stripHeader(actual).trimEnd()).toBe(stripHeader(expected).trimEnd());
  });
});

describe("examples: schema coverage", () => {
  let md: string;

  test("setup", async () => {
    md = await runPipelineAsync(join(EXAMPLES, "flyway"));
  });

  // Extensions
  test("includes extensions", () => {
    expect(md).toContain("uuid-ossp");
    expect(md).toContain("pgcrypto");
  });

  // Enums
  test("includes enums with correct values", () => {
    expect(md).toContain("user_status");
    expect(md).toContain("`active`, `suspended`, `deleted`");
    expect(md).toContain("order_status");
    expect(md).toContain("`refunded`");
    expect(md).toContain("priority_level");
    expect(md).toContain("`urgent`"); // renamed from 'critical'
    expect(md).not.toContain("`critical`"); // was renamed
  });

  // Tables
  test("includes core tables", () => {
    expect(md).toContain("### `users`");
    expect(md).toContain("### `orders`");
    expect(md).toContain("### `organisations`");
    expect(md).toContain("### `user_roles`");
    expect(md).toContain("### `audit.events`");
    expect(md).toContain("### `api.tokens`");
  });

  // Column rename (F1)
  test("column rename applied: full_name not name", () => {
    expect(md).toContain("full_name");
    // 'name' might appear in other contexts, but check the users table section
    const usersSection = md.split("### `users`")[1]?.split("###")[0] ?? "";
    expect(usersSection).toContain("full_name");
    expect(usersSection).not.toContain("| name |");
  });

  // Dropped column
  test("dropped column phone not in output", () => {
    const usersSection = md.split("### `users`")[1]?.split("###")[0] ?? "";
    expect(usersSection).not.toContain("phone");
  });

  // Comments
  test("table and column comments present", () => {
    expect(md).toContain("Core user accounts");
    expect(md).toContain("Primary login identifier");
    expect(md).toContain("Audit trail for all data changes");
  });

  // FK constraints
  test("FK constraints show referenced table and action", () => {
    expect(md).toContain("FOREIGN KEY");
    expect(md).toContain("CASCADE");
  });

  // Indices
  test("indices present with correct methods", () => {
    expect(md).toContain("idx_users_email_lower");
    expect(md).toContain("idx_users_metadata");
    expect(md).toContain("gin");
    expect(md).toContain("idx_active_orders");
  });

  // Dropped index
  test("dropped index not in output", () => {
    expect(md).not.toContain("idx_orders_user");
  });

  // Views
  test("views present", () => {
    expect(md).toContain("## Views");
    expect(md).toContain("active_users");
    expect(md).toContain("api.order_summary");
  });

  // Functions
  test("functions present", () => {
    expect(md).toContain("## Functions");
    expect(md).toContain("update_updated_at");
    expect(md).toContain("plpgsql");
  });

  // Sequences
  test("sequences present", () => {
    expect(md).toContain("## Sequences");
    expect(md).toContain("invoice_number_seq");
  });

  // Partitions
  test("partitioned table info present", () => {
    expect(md).toContain("measurements");
    expect(md).toContain("RANGE");
    expect(md).toContain("measurements_2025");
    expect(md).toContain("measurements_2026");
  });

  // RLS
  test("RLS and policy present", () => {
    expect(md).toContain("Row-level security enabled");
    expect(md).toContain("user_sees_own_orders");
  });

  // Domain
  test("domain type present", () => {
    // Domains are stored in the enums section for now
    expect(md).toContain("email_address");
  });

  // Composite type
  test("composite type present", () => {
    expect(md).toContain("address");
  });

  // Inheritance
  test("table inheritance present", () => {
    expect(md).toContain("audit.order_events");
    expect(md).toContain("Inherits");
  });

  // Generated column
  test("generated column present", () => {
    expect(md).toContain("total_display");
    expect(md).toContain("GENERATED");
  });

  // Multi-command ALTER
  test("multi-command ALTER results applied", () => {
    const usersSection = md.split("### `users`")[1]?.split("###")[0] ?? "";
    expect(usersSection).toContain("last_login");
    expect(usersSection).toContain("login_count");
    expect(usersSection).not.toContain("verified_at"); // dropped by multi-command ALTER
  });
});
