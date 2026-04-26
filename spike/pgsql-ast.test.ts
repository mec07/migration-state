// spike/pgsql-ast.test.ts
// Tests pgsql-ast-parser against all 46 DDL statements from ddl-statements.ts
//
// pgsql-ast-parser is SYNCHRONOUS and throws on unparseable SQL.
// Several DDL types are known to fail — this test captures which ones
// succeed and fail to produce comparison data vs. @supabase/pg-parser.

import { describe, test, expect } from "bun:test";
import { parse, parseFirst } from "pgsql-ast-parser";
import { ALL_DDL } from "./ddl-statements";
import * as DDL from "./ddl-statements";

// ---------------------------------------------------------------------------
// Known unsupported DDL IDs — empirically confirmed
// ---------------------------------------------------------------------------
// Research predictions: 23, 24, 31, 32, 34a, 34b, 38
// Empirical surprises:  13 (EXCLUDE), 20 (ALTER ENUM ADD VALUE), 27 (SET SCHEMA)
const EXPECTED_FAILURES = new Set([
  "13",  // EXCLUDE constraint — EXCLUDE USING gist not supported
  "20",  // ALTER TYPE ADD VALUE — AFTER clause not supported
  "23",  // CREATE TRIGGER
  "24",  // Trigger with WHEN
  "27",  // ALTER TABLE SET SCHEMA — SET SCHEMA not supported
  "31",  // PARTITION BY
  "32",  // PARTITION OF
  "34a", // ENABLE ROW LEVEL SECURITY
  "34b", // CREATE POLICY
  "38",  // CREATE DOMAIN
]);

// ---------------------------------------------------------------------------
// Results tracker
// ---------------------------------------------------------------------------
interface TestResult {
  id: string;
  description: string;
  passed: boolean;
  stmtType?: string;
  stmtCount?: number;
  error?: string;
  expectedFailure: boolean;
}

const results: TestResult[] = [];

// ---------------------------------------------------------------------------
// Section 1: All DDL statements
// ---------------------------------------------------------------------------
describe("all DDL statements", () => {
  for (const { id, sql, description } of ALL_DDL) {
    test(`#${id} ${description}`, () => {
      const isExpectedFailure = EXPECTED_FAILURES.has(id);
      try {
        const stmts = parse(sql);
        expect(stmts.length).toBeGreaterThanOrEqual(1);

        const stmtType = stmts[0]?.type ?? "unknown";
        console.log(`  #${id} -> ${stmtType} (${stmts.length} stmt(s))`);

        results.push({
          id,
          description,
          passed: true,
          stmtType,
          stmtCount: stmts.length,
          expectedFailure: isExpectedFailure,
        });

        // If this was expected to fail but passed, note it
        if (isExpectedFailure) {
          console.log(`  *** UNEXPECTED SUCCESS: #${id} was expected to fail but parsed OK`);
        }
      } catch (err: any) {
        const msg = err?.message ?? String(err);

        if (isExpectedFailure) {
          console.log(`  #${id} -> EXPECTED FAIL: ${msg.split("\n")[0]}`);
          results.push({
            id,
            description,
            passed: false,
            error: msg.split("\n")[0],
            expectedFailure: true,
          });
          // Don't re-throw — expected failure
        } else {
          console.log(`  #${id} -> UNEXPECTED FAIL: ${msg.split("\n")[0]}`);
          results.push({
            id,
            description,
            passed: false,
            error: msg.split("\n")[0],
            expectedFailure: false,
          });
          // Re-throw to fail the test — this DDL should have worked
          throw err;
        }
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Section 2: Structural assertions (only DDLs known to parse)
// ---------------------------------------------------------------------------
describe("structural assertions", () => {
  test("#01 CREATE TABLE: type, columns >= 4", () => {
    const stmts = parse(DDL.DDL_01_CREATE_TABLE);
    const stmt = stmts[0] as any;
    expect(stmt.type).toBe("create table");
    expect(stmt.columns.length).toBeGreaterThanOrEqual(4);
    console.log(
      `  #01 columns:`,
      stmt.columns.map((c: any) => c.name?.name).join(", "),
    );
  });

  test("#02 ADD COLUMN: type = alter table", () => {
    const stmts = parse(DDL.DDL_02_ADD_COLUMN);
    const stmt = stmts[0] as any;
    expect(stmt.type).toBe("alter table");
    expect(stmt.changes.length).toBeGreaterThanOrEqual(1);
    expect(stmt.changes[0].type).toBe("add column");
  });

  test("#05 RENAME COLUMN: type = alter table, change.type = rename column", () => {
    const stmts = parse(DDL.DDL_05_RENAME_COLUMN);
    const stmt = stmts[0] as any;
    expect(stmt.type).toBe("alter table");
    expect(stmt.changes[0].type).toBe("rename column");
    expect(stmt.changes[0].to.name).toBe("full_name");
  });

  test("#19 CREATE ENUM: type, 5 values", () => {
    const stmts = parse(DDL.DDL_19_CREATE_ENUM);
    const stmt = stmts[0] as any;
    expect(stmt.type).toBe("create enum");
    expect(stmt.values.length).toBe(5);
    console.log(
      `  #19 values:`,
      stmt.values.map((v: any) => v.value).join(", "),
    );
  });

  test("#22 CREATE FUNCTION: type = create function", () => {
    const stmts = parse(DDL.DDL_22_FUNCTION);
    const stmt = stmts[0] as any;
    expect(stmt.type).toBe("create function");
    expect(stmt.name.name).toBe("update_modified_at");
    expect(stmt.language.name).toBe("plpgsql");
    console.log(`  #22 returns: ${stmt.returns?.name}, language: ${stmt.language?.name}`);
  });
});

// ---------------------------------------------------------------------------
// Section 3: Multi-command ALTER Table (#39) — diagnostic
// ---------------------------------------------------------------------------
describe("Multi-command ALTER Table (#39)", () => {
  test("diagnostic: how does parse handle multi-command ALTER?", () => {
    const stmts = parse(DDL.DDL_39_MULTI_ALTER);

    console.log(`  #39 statement count: ${stmts.length}`);

    for (let i = 0; i < stmts.length; i++) {
      const s = stmts[i] as any;
      console.log(`  #39 stmt[${i}] type: ${s.type}`);
      if (s.changes) {
        console.log(`  #39 stmt[${i}] changes (${s.changes.length}):`);
        for (let j = 0; j < s.changes.length; j++) {
          console.log(`    change[${j}] type: ${s.changes[j].type}`);
        }
      }
    }

    // Key diagnostic: does it return 1 statement with 4 changes?
    expect(stmts.length).toBe(1);
    const stmt = stmts[0] as any;
    expect(stmt.type).toBe("alter table");
    expect(stmt.changes.length).toBe(4);

    console.log(`\n  #39 FINDING: pgsql-ast-parser returns 1 AlterTableStatement with ${stmt.changes.length} changes`);
    console.log(`  #39 Full JSON:\n${JSON.stringify(stmts, null, 2)}`);
  });
});

// ---------------------------------------------------------------------------
// Section 4: Batch parse (parseable DDLs only)
// ---------------------------------------------------------------------------
describe("batch parse", () => {
  test("all parseable DDL concatenated", () => {
    const parseableDdls = ALL_DDL.filter((d) => !EXPECTED_FAILURES.has(d.id));
    const batchSql = parseableDdls.map((d) => d.sql).join("\n");

    const stmts = parse(batchSql);
    console.log(
      `  Batch parse: ${stmts.length} statements from ${parseableDdls.length} DDL inputs`,
    );
    expect(stmts.length).toBeGreaterThanOrEqual(parseableDdls.length);
  });
});

// ---------------------------------------------------------------------------
// Section 5: Summary
// ---------------------------------------------------------------------------
describe("summary", () => {
  test("print results table", () => {
    // Force this to run last by depending on results array being populated
    console.log("\n");
    console.log("=".repeat(80));
    console.log("  pgsql-ast-parser RESULTS SUMMARY");
    console.log("=".repeat(80));
    console.log("");
    console.log(
      "| ID   | Description                  | Result         | Type / Error                    |",
    );
    console.log(
      "|------|------------------------------|----------------|---------------------------------|",
    );

    let passCount = 0;
    let failExpectedCount = 0;
    let failUnexpectedCount = 0;
    let unexpectedSuccessCount = 0;

    for (const r of results) {
      let status: string;
      let detail: string;

      if (r.passed && !r.expectedFailure) {
        status = "PASS";
        detail = r.stmtType ?? "";
        passCount++;
      } else if (r.passed && r.expectedFailure) {
        status = "SURPRISE PASS";
        detail = r.stmtType ?? "";
        unexpectedSuccessCount++;
        passCount++;
      } else if (!r.passed && r.expectedFailure) {
        status = "EXPECTED FAIL";
        detail = (r.error ?? "").substring(0, 33);
        failExpectedCount++;
      } else {
        status = "UNEXPECTED FAIL";
        detail = (r.error ?? "").substring(0, 33);
        failUnexpectedCount++;
      }

      const idCol = r.id.padEnd(4);
      const descCol = r.description.padEnd(28);
      const statusCol = status.padEnd(14);
      const detailCol = detail.padEnd(33);
      console.log(`| ${idCol} | ${descCol} | ${statusCol} | ${detailCol} |`);
    }

    console.log("");
    console.log(`  Total:              ${results.length}`);
    console.log(`  Passed:             ${passCount}`);
    console.log(`  Expected failures:  ${failExpectedCount}`);
    console.log(`  Unexpected fails:   ${failUnexpectedCount}`);
    console.log(`  Unexpected passes:  ${unexpectedSuccessCount}`);
    console.log("=".repeat(80));
    console.log("");

    // The summary test itself should not fail
    expect(results.length).toBe(ALL_DDL.length);
    expect(failUnexpectedCount).toBe(0);
  });
});
