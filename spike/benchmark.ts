import { PgParser, unwrapParseResult } from "@supabase/pg-parser";
import { parse } from "pgsql-ast-parser";
import { ALL_DDL } from "./ddl-statements";

const ITERATIONS = 1000;

const EXPECTED_FAILURES = new Set(["13", "20", "23", "24", "27", "31", "32", "34a", "34b", "38"]);
const commonDdl = ALL_DDL.filter(d => !EXPECTED_FAILURES.has(d.id));
const commonSql = commonDdl.map(d => d.sql).join("\n");
const allSql = ALL_DDL.map(d => d.sql).join("\n");

async function benchPgParser() {
  const parser = new PgParser();
  await parser.parse("SELECT 1;");  // warm up

  const start = Bun.nanoseconds();
  for (let i = 0; i < ITERATIONS; i++) {
    await parser.parse(allSql);
  }
  const elapsed = (Bun.nanoseconds() - start) / 1_000_000;
  return elapsed;
}

function benchPgsqlAst() {
  parse("SELECT 1;");  // warm up

  const start = Bun.nanoseconds();
  for (let i = 0; i < ITERATIONS; i++) {
    parse(commonSql);
  }
  const elapsed = (Bun.nanoseconds() - start) / 1_000_000;
  return elapsed;
}

async function main() {
  console.log(`Benchmarking ${ITERATIONS} iterations...\n`);

  const pgTime = await benchPgParser();
  console.log(`pg-parser:        ${pgTime.toFixed(1)}ms total, ${(pgTime / ITERATIONS).toFixed(2)}ms/iter (${ALL_DDL.length} stmts)`);

  const astTime = benchPgsqlAst();
  console.log(`pgsql-ast-parser: ${astTime.toFixed(1)}ms total, ${(astTime / ITERATIONS).toFixed(2)}ms/iter (${commonDdl.length} stmts)`);

  console.log(`\nRatio: pg-parser is ${(pgTime / astTime).toFixed(1)}x slower than pgsql-ast-parser`);
}

main();
