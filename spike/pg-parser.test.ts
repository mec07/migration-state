// spike/pg-parser.test.ts
// Tests @supabase/pg-parser against all 46 DDL statements from ddl-statements.ts

import { describe, test, expect } from "bun:test";
import { PgParser, unwrapParseResult, unwrapNode } from "@supabase/pg-parser";
import {
  ALL_DDL,
  DDL_01_CREATE_TABLE,
  DDL_02_ADD_COLUMN,
  DDL_03_DROP_COLUMN,
  DDL_04_ALTER_TYPE,
  DDL_05_RENAME_COLUMN,
  DDL_06A_SET_NOT_NULL,
  DDL_06B_SET_DEFAULT,
  DDL_06C_DROP_DEFAULT,
  DDL_07_FK_INLINE,
  DDL_08_FK_NAMED,
  DDL_09_COMPOSITE_PK,
  DDL_10_SELF_REF_FK,
  DDL_11_UNIQUE_MULTI,
  DDL_12_CHECK,
  DDL_13_EXCLUDE,
  DDL_14A_INDEX_BASIC,
  DDL_14B_INDEX_EXPR,
  DDL_15_PARTIAL_INDEX,
  DDL_16A_ADD_JSONB,
  DDL_16B_GIN_INDEX,
  DDL_17_MULTI_COL_INDEX,
  DDL_18_DROP_INDEX,
  DDL_19_CREATE_ENUM,
  DDL_20_ALTER_ENUM,
  DDL_21_COMPOSITE_TYPE,
  DDL_22_FUNCTION,
  DDL_23_TRIGGER,
  DDL_24_TRIGGER_WHEN,
  DDL_25_CREATE_SCHEMA,
  DDL_26_SCHEMA_TABLE,
  DDL_27_SET_SCHEMA,
  DDL_28_CREATE_VIEW,
  DDL_29_REPLACE_VIEW,
  DDL_30_SEQUENCE,
  DDL_31_PARTITION_BY,
  DDL_32_PARTITION_OF,
  DDL_33_GENERATED_COL,
  DDL_34A_ENABLE_RLS,
  DDL_34B_CREATE_POLICY,
  DDL_35A_EXTENSION_UUID,
  DDL_35B_EXTENSION_PGCRYPTO,
  DDL_36A_COMMENT_TABLE,
  DDL_36B_COMMENT_COLUMN,
  DDL_37_INHERITS,
  DDL_38_DOMAIN,
  DDL_39_MULTI_ALTER,
} from "./ddl-statements";

// Single parser instance for all tests (WASM init happens once)
const parser = new PgParser();

// ---------------------------------------------------------------------------
// Section 1: All DDL statements parse without error
// ---------------------------------------------------------------------------
describe("all DDL statements parse without error", () => {
  for (const { id, sql, description } of ALL_DDL) {
    test(`#${id} ${description}`, async () => {
      const tree = await unwrapParseResult(parser.parse(sql));
      expect(tree.stmts.length).toBeGreaterThanOrEqual(1);

      const { type, node } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBeTruthy();

      console.log(`  #${id} -> ${type}`);
    });
  }
});

// ---------------------------------------------------------------------------
// Section 2: Structural assertions
// ---------------------------------------------------------------------------
describe("structural assertions", () => {
  // === Core table operations ===
  describe("core table operations", () => {
    test("#01 CREATE TABLE", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_01_CREATE_TABLE));
      const { type, node } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("CreateStmt");
      expect(node.relation.relname).toBe("users");
      expect(node.tableElts.length).toBeGreaterThanOrEqual(4);
    });

    test("#02 ADD COLUMN", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_02_ADD_COLUMN));
      const { type, node } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("AlterTableStmt");
      expect(node.relation.relname).toBe("users");
      expect(node.cmds.length).toBeGreaterThanOrEqual(1);
    });

    test("#03 DROP COLUMN", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_03_DROP_COLUMN));
      const { type } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("AlterTableStmt");
    });

    test("#04 ALTER TYPE", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_04_ALTER_TYPE));
      const { type } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("AlterTableStmt");
    });

    test("#05 RENAME COLUMN", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_05_RENAME_COLUMN));
      const { type, node } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("RenameStmt");
      expect(node.newname).toBe("full_name");
    });

    test("#06a SET NOT NULL", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_06A_SET_NOT_NULL));
      const { type } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("AlterTableStmt");
    });

    test("#06b SET DEFAULT", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_06B_SET_DEFAULT));
      const { type } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("AlterTableStmt");
    });

    test("#06c DROP DEFAULT", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_06C_DROP_DEFAULT));
      const { type } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("AlterTableStmt");
    });
  });

  // === Foreign keys ===
  describe("foreign keys", () => {
    test("#07 inline FK", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_07_FK_INLINE));
      const { type, node } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("CreateStmt");
      expect(node.relation.relname).toBe("orders");
      // tableElts include columns; FK constraints are inline on column defs
      expect(node.tableElts.length).toBeGreaterThanOrEqual(1);
    });

    test("#08 named FK", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_08_FK_NAMED));
      const { type, node } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("AlterTableStmt");
      expect(node.cmds.length).toBeGreaterThanOrEqual(1);
    });

    test("#09 composite PK", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_09_COMPOSITE_PK));
      const { type, node } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("CreateStmt");
      expect(node.relation.relname).toBe("user_roles");
    });

    test("#10 self-ref FK", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_10_SELF_REF_FK));
      const { type, node } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("CreateStmt");
      expect(node.relation.relname).toBe("organisations");
    });
  });

  // === Constraints ===
  describe("constraints", () => {
    test("#11 UNIQUE", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_11_UNIQUE_MULTI));
      const { type } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("AlterTableStmt");
    });

    test("#12 CHECK", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_12_CHECK));
      const { type } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("AlterTableStmt");
    });

    test("#13 EXCLUDE", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_13_EXCLUDE));
      const { type, node } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("CreateStmt");
      expect(node.relation.relname).toBe("reservations");
    });
  });

  // === Indices ===
  describe("indices", () => {
    test("#14a basic index", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_14A_INDEX_BASIC));
      const { type, node } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("IndexStmt");
      expect(node.idxname).toBe("idx_orders_user");
    });

    test("#14b expression index", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_14B_INDEX_EXPR));
      const { type, node } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("IndexStmt");
      expect(node.unique).toBe(true);
      expect(node.idxname).toBe("idx_users_email_lower");
    });

    test("#15 partial index", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_15_PARTIAL_INDEX));
      const { type, node } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("IndexStmt");
      expect(node.whereClause).toBeTruthy();
    });

    test("#16b GIN index", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_16B_GIN_INDEX));
      const { type, node } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("IndexStmt");
      expect(node.accessMethod).toBe("gin");
    });

    test("#17 multi-column index", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_17_MULTI_COL_INDEX));
      const { type, node } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("IndexStmt");
      expect(node.indexParams.length).toBe(2);
    });

    test("#18 DROP INDEX", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_18_DROP_INDEX));
      const { type, node } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("DropStmt");
      expect(node.missing_ok).toBe(true);
    });
  });

  // === Enums and custom types ===
  describe("enums and types", () => {
    test("#19 ENUM", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_19_CREATE_ENUM));
      const { type, node } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("CreateEnumStmt");
      expect(node.vals.length).toBe(5);
    });

    test("#20 ALTER ENUM", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_20_ALTER_ENUM));
      const { type, node } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("AlterEnumStmt");
      expect(node.newVal).toBeTruthy();
    });

    test("#21 composite type", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_21_COMPOSITE_TYPE));
      const { type, node } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("CompositeTypeStmt");
      expect(node.coldeflist.length).toBe(4);
    });
  });

  // === Triggers and functions ===
  describe("triggers and functions", () => {
    test("#22 FUNCTION", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_22_FUNCTION));
      const { type } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("CreateFunctionStmt");
    });

    test("#23 TRIGGER", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_23_TRIGGER));
      const { type, node } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("CreateTrigStmt");
      expect(node.trigname).toBe("set_updated_at");
      expect(node.relation.relname).toBe("orders");
    });

    test("#24 WHEN trigger", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_24_TRIGGER_WHEN));
      const { type, node } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("CreateTrigStmt");
      expect(node.whenClause).toBeTruthy();
    });
  });

  // === Schema and namespace ===
  describe("schema and namespace", () => {
    test("#25 CREATE SCHEMA", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_25_CREATE_SCHEMA));
      const { type, node } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("CreateSchemaStmt");
      expect(node.schemaname).toBe("audit");
      expect(node.if_not_exists).toBe(true);
    });

    test("#26 schema-qualified table", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_26_SCHEMA_TABLE));
      const { type, node } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("CreateStmt");
      expect(node.relation.schemaname).toBe("audit");
      expect(node.relation.relname).toBe("events");
    });

    test("#27 SET SCHEMA", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_27_SET_SCHEMA));
      const { type, node } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("AlterObjectSchemaStmt");
      expect(node.newschema).toBe("audit");
    });
  });

  // === Views and sequences ===
  describe("views and sequences", () => {
    test("#28 CREATE VIEW", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_28_CREATE_VIEW));
      const { type, node } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("ViewStmt");
      expect(node.view.relname).toBe("active_users");
    });

    test("#29 REPLACE VIEW", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_29_REPLACE_VIEW));
      const { type, node } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("ViewStmt");
      expect(node.replace).toBe(true);
    });

    test("#30 SEQUENCE", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_30_SEQUENCE));
      const { type } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("CreateSeqStmt");
    });
  });

  // === Advanced (best-effort) ===
  describe("advanced features", () => {
    test("#31 PARTITION BY", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_31_PARTITION_BY));
      const { type, node } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("CreateStmt");
      expect(node.partspec).toBeTruthy();
    });

    test("#32 PARTITION OF", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_32_PARTITION_OF));
      const { type, node } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("CreateStmt");
      expect(node.partbound).toBeTruthy();
    });

    test("#33 generated column", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_33_GENERATED_COL));
      const { type } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("AlterTableStmt");
    });

    test("#34a ENABLE RLS", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_34A_ENABLE_RLS));
      const { type } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("AlterTableStmt");
    });

    test("#34b CREATE POLICY", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_34B_CREATE_POLICY));
      const { type } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("CreatePolicyStmt");
    });

    test("#35a extension uuid-ossp", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_35A_EXTENSION_UUID));
      const { type } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("CreateExtensionStmt");
    });

    test("#36a COMMENT ON TABLE", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_36A_COMMENT_TABLE));
      const { type } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("CommentStmt");
    });

    test("#37 INHERITS", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_37_INHERITS));
      const { type, node } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("CreateStmt");
      expect(node.inhRelations).toBeTruthy();
      expect(node.inhRelations.length).toBeGreaterThanOrEqual(1);
    });

    test("#38 DOMAIN", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_38_DOMAIN));
      const { type } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("CreateDomainStmt");
    });

    test("#39 multi ALTER", async () => {
      const tree = await unwrapParseResult(parser.parse(DDL_39_MULTI_ALTER));
      const { type, node } = unwrapNode(tree.stmts[0].stmt);
      expect(type).toBe("AlterTableStmt");
      expect(node.cmds.length).toBe(4);
      console.log("  #39 raw cmds:", JSON.stringify(node.cmds, null, 2));
    });
  });
});

// ---------------------------------------------------------------------------
// Section 3: Batch parse
// ---------------------------------------------------------------------------
describe("batch parse", () => {
  test("all DDL parsed as single string", async () => {
    const allSql = ALL_DDL.map((d) => d.sql).join("\n");
    const tree = await unwrapParseResult(parser.parse(allSql));
    console.log(`  Batch parse: ${tree.stmts.length} statements`);
    expect(tree.stmts.length).toBeGreaterThanOrEqual(46);
  });
});
