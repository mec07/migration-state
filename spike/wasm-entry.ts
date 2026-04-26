import { PgParser, unwrapParseResult, unwrapNode } from "@supabase/pg-parser";

async function main() {
  const parser = new PgParser();

  const tree = await unwrapParseResult(
    parser.parse("CREATE TABLE test (id int PRIMARY KEY, name text NOT NULL);")
  );

  if (tree.stmts.length !== 1) {
    console.error(`FAIL: Expected 1 statement, got ${tree.stmts.length}`);
    process.exit(1);
  }

  const { type, node } = unwrapNode(tree.stmts[0].stmt);
  if (type !== "CreateStmt") {
    console.error(`FAIL: Expected CreateStmt, got ${type}`);
    process.exit(1);
  }

  console.log("PASS: WASM parser loaded and parsed successfully");
  console.log(`  Node type: ${type}`);
  console.log(`  Table: ${node.relation.relname}`);
  console.log(`  Columns: ${node.tableElts.length}`);
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
