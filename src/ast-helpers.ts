// src/ast-helpers.ts
// Utilities for extracting data from pg-parser AST nodes.
// This file isolates all parser-specific knowledge.

import type { Column, Constraint, Index } from "./types";

/** Map pg-parser FK action codes to human-readable strings */
export const FK_ACTIONS: Record<string, string> = {
  a: "NO ACTION",
  r: "RESTRICT",
  c: "CASCADE",
  n: "SET NULL",
  d: "SET DEFAULT",
};

/** Map pg-parser constraint contype to our Constraint type */
export const CONTYPE_MAP: Record<string, Constraint["type"]> = {
  CONSTR_PRIMARY: "PRIMARY KEY",
  CONSTR_FOREIGN: "FOREIGN KEY",
  CONSTR_UNIQUE: "UNIQUE",
  CONSTR_CHECK: "CHECK",
  CONSTR_EXCLUSION: "EXCLUDE",
};

/** SERIAL/BIGSERIAL type expansion */
export const SERIAL_TYPES: Record<string, string> = {
  serial: "integer",
  bigserial: "bigint",
  smallserial: "smallint",
};

/** pg-parser trigger timing values (bitmask from protobuf) */
export const TRIGGER_TIMING: Record<number, string> = {
  2: "BEFORE",
  4: "AFTER",
  64: "INSTEAD OF",
};

/** pg-parser trigger event bitmask values */
export const TRIGGER_EVENTS = {
  INSERT: 4,
  DELETE: 8,
  UPDATE: 16,
  TRUNCATE: 32,
} as const;

/** Extract a schema-qualified name from a RangeVar-like AST node */
export function extractQualifiedName(node: any): { schema: string; name: string } {
  return {
    schema: node.schemaname || "public",
    name: node.relname,
  };
}

/** Extract type name from a TypeName AST node */
export function extractTypeName(typeNameNode: any): string {
  if (!typeNameNode?.names) return "unknown";
  const names = typeNameNode.names
    .map((n: any) => n.String?.sval)
    .filter((n: any) => n && n !== "pg_catalog");
  let typeName = names.join(".");

  // Handle type modifiers (e.g., varchar(255))
  if (typeNameNode.typmods?.length > 0) {
    const mods = typeNameNode.typmods
      .map((m: any) => {
        if (m.A_Const?.ival?.ival !== undefined) return m.A_Const.ival.ival;
        if (m.Integer?.ival !== undefined) return m.Integer.ival;
        return null;
      })
      .filter((m: any) => m !== null);
    if (mods.length > 0) {
      typeName += `(${mods.join(", ")})`;
    }
  }
  return typeName;
}

/** Attempt to deparse an expression AST node to a SQL-ish string (best effort) */
export function deparseExpr(node: any): string {
  if (!node) return "";
  if (node.A_Const) {
    if (node.A_Const.ival !== undefined) {
      const ival = typeof node.A_Const.ival === "object" ? node.A_Const.ival.ival : node.A_Const.ival;
      return String(ival);
    }
    if (node.A_Const.fval !== undefined) return node.A_Const.fval;
    if (node.A_Const.sval !== undefined) {
      const sval = typeof node.A_Const.sval === "object" ? node.A_Const.sval.sval : node.A_Const.sval;
      return `'${sval}'`;
    }
    if (node.A_Const.boolval !== undefined) {
      const bval = typeof node.A_Const.boolval === "object" ? node.A_Const.boolval.boolval : node.A_Const.boolval;
      return String(bval);
    }
    if (node.A_Const.isnull) return "NULL";
  }
  if (node.FuncCall) {
    const fname = node.FuncCall.funcname?.map((n: any) => n.String?.sval).join(".") ?? "?";
    return `${fname}()`;
  }
  if (node.String) return node.String.sval;
  if (node.TypeCast) {
    return `${deparseExpr(node.TypeCast.arg)}::${extractTypeName(node.TypeCast.typeName)}`;
  }
  // Fallback: return a placeholder indicating presence
  return "(expression)";
}

/** Extract columns from CREATE TABLE's tableElts */
export function extractColumns(tableElts: any[]): {
  columns: Column[];
  constraints: Constraint[];
  implicitIndices: Index[];
  implicitSequences: { name: string; forColumn: string }[];
} {
  const columns: Column[] = [];
  const constraints: Constraint[] = [];
  const implicitIndices: Index[] = [];
  const implicitSequences: { name: string; forColumn: string }[] = [];

  for (const elt of tableElts) {
    if (elt.ColumnDef) {
      const col = extractColumnDef(elt.ColumnDef, constraints, implicitIndices, implicitSequences);
      columns.push(col);
    } else if (elt.Constraint) {
      const c = extractTableConstraint(elt.Constraint);
      if (c) {
        constraints.push(c);
        // Implicit index for table-level PK and UNIQUE
        if (c.type === "PRIMARY KEY" || c.type === "UNIQUE") {
          implicitIndices.push({
            name: c.name || `${c.type === "PRIMARY KEY" ? "pkey" : "key"}`,
            columns: [...c.columns],
            unique: true,
            method: "btree",
          });
        }
      }
    }
  }

  return { columns, constraints, implicitIndices, implicitSequences };
}

function extractColumnDef(
  colDef: any,
  constraints: Constraint[],
  implicitIndices: Index[],
  implicitSequences: { name: string; forColumn: string }[],
): Column {
  const colName = colDef.colname;
  let typeName = extractTypeName(colDef.typeName);
  let nullable = true;
  let defaultVal: string | undefined;
  let isSerial = false;

  // Handle SERIAL types
  const serialExpansion = SERIAL_TYPES[typeName.toLowerCase()];
  if (serialExpansion) {
    isSerial = true;
    typeName = serialExpansion;
  }

  // Process inline constraints
  for (const c of colDef.constraints ?? []) {
    const con = c.Constraint;
    if (!con) continue;

    switch (con.contype) {
      case "CONSTR_NOTNULL":
        nullable = false;
        break;
      case "CONSTR_DEFAULT":
        defaultVal = deparseExpr(con.raw_expr);
        break;
      case "CONSTR_PRIMARY": {
        nullable = false; // PK implies NOT NULL
        const pkName = con.conname || "";
        constraints.push({
          name: pkName,
          type: "PRIMARY KEY",
          columns: [colName],
        });
        implicitIndices.push({
          name: pkName || "pkey",
          columns: [colName],
          unique: true,
          method: "btree",
        });
        break;
      }
      case "CONSTR_UNIQUE": {
        const uqName = con.conname || "";
        constraints.push({
          name: uqName,
          type: "UNIQUE",
          columns: [colName],
        });
        implicitIndices.push({
          name: uqName || "key",
          columns: [colName],
          unique: true,
          method: "btree",
        });
        break;
      }
      case "CONSTR_FOREIGN": {
        const fkName = con.conname || "";
        constraints.push({
          name: fkName,
          type: "FOREIGN KEY",
          columns: [colName],
          references: {
            schema: con.pktable?.schemaname || undefined,
            table: con.pktable?.relname ?? "",
            columns: con.pk_attrs?.map((a: any) => a.String?.sval) ?? [],
            onDelete: FK_ACTIONS[con.fk_del_action] ?? undefined,
            onUpdate: FK_ACTIONS[con.fk_upd_action] ?? undefined,
          },
        });
        break;
      }
      case "CONSTR_CHECK": {
        constraints.push({
          name: con.conname || "",
          type: "CHECK",
          columns: [],
          definition: deparseExpr(con.raw_expr),
        });
        break;
      }
      case "CONSTR_GENERATED": {
        // generated_when: "a" means ALWAYS
        // Handled below after the loop
        break;
      }
    }
  }

  // Handle SERIAL implicit sequence
  if (isSerial) {
    implicitSequences.push({ name: "", forColumn: colName });
    if (!defaultVal) {
      defaultVal = ""; // Placeholder — handleCreateTable fills in the real nextval()
    }
    nullable = false; // SERIAL implies NOT NULL
  }

  // Check for GENERATED ALWAYS AS
  const genConstraint = (colDef.constraints ?? []).find(
    (c: any) => c.Constraint?.contype === "CONSTR_GENERATED"
  );
  let generated: { expression: string; stored: boolean } | undefined;
  if (genConstraint) {
    generated = {
      expression: deparseExpr(genConstraint.Constraint.raw_expr),
      stored: true, // PostgreSQL only supports STORED currently
    };
  }

  return {
    name: colName,
    type: typeName,
    nullable,
    default: defaultVal,
    generated,
  };
}

function extractTableConstraint(con: any): Constraint | null {
  const contype = CONTYPE_MAP[con.contype];
  if (!contype) return null;

  const columns = (con.keys ?? con.fk_attrs ?? []).map((k: any) => k.String?.sval).filter(Boolean);

  const constraint: Constraint = {
    name: con.conname || "",
    type: contype,
    columns,
  };

  if (contype === "FOREIGN KEY" && con.pktable) {
    constraint.references = {
      schema: con.pktable.schemaname || undefined,
      table: con.pktable.relname ?? "",
      columns: (con.pk_attrs ?? []).map((a: any) => a.String?.sval).filter(Boolean),
      onDelete: FK_ACTIONS[con.fk_del_action] ?? undefined,
      onUpdate: FK_ACTIONS[con.fk_upd_action] ?? undefined,
    };
  }

  if (contype === "CHECK") {
    constraint.definition = deparseExpr(con.raw_expr);
  }

  return constraint;
}

/** Extract index params from IndexStmt */
export function extractIndexParams(params: any[]): { columns: string[]; hasExpressions: boolean } {
  const columns: string[] = [];
  let hasExpressions = false;
  for (const param of params) {
    const ie = param.IndexElem;
    if (ie?.name) {
      columns.push(ie.name);
    } else if (ie?.expr) {
      columns.push(deparseExpr(ie.expr));
      hasExpressions = true;
    }
  }
  return { columns, hasExpressions };
}

/** Extract name from a DropStmt objects list (handles various shapes) */
export function extractDropName(objects: any[]): { schema: string; name: string } | null {
  if (!objects || objects.length === 0) return null;
  const obj = objects[0];

  // List format: { List: { items: [{ String: { sval: "name" } }] } }
  if (obj.List?.items) {
    const items = obj.List.items.map((i: any) => i.String?.sval).filter(Boolean);
    if (items.length === 2) return { schema: items[0], name: items[1] };
    if (items.length === 1) return { schema: "public", name: items[0] };
  }

  // ObjectWithArgs format (for functions): { ObjectWithArgs: { objname: [...] } }
  if (obj.ObjectWithArgs?.objname) {
    const names = obj.ObjectWithArgs.objname.map((n: any) => n.String?.sval).filter(Boolean);
    if (names.length === 2) return { schema: names[0], name: names[1] };
    if (names.length === 1) return { schema: "public", name: names[0] };
  }

  // TypeName format (for DROP TYPE): { TypeName: { names: [...] } }
  if (obj.TypeName?.names) {
    const names = obj.TypeName.names.map((n: any) => n.String?.sval).filter(Boolean);
    if (names.length === 2) return { schema: names[0], name: names[1] };
    if (names.length === 1) return { schema: "public", name: names[0] };
  }

  return null;
}

/** Extract trigger drop name (table + trigger name from List items) */
export function extractTriggerDropName(objects: any[]): { schema: string; table: string; trigger: string } | null {
  if (!objects?.[0]?.List?.items) return null;
  const items = objects[0].List.items.map((i: any) => i.String?.sval).filter(Boolean);
  // Format: [tableName, triggerName] or [schemaName, tableName, triggerName]
  if (items.length === 2) return { schema: "public", table: items[0], trigger: items[1] };
  if (items.length === 3) return { schema: items[0], table: items[1], trigger: items[2] };
  return null;
}

/** Extract names from a typeName array (used by enums, domains) */
export function extractTypeNameList(typeNameArr: any[]): { schema: string; name: string } {
  const names = typeNameArr.map((n: any) => n.String?.sval).filter(Boolean);
  if (names.length >= 2) return { schema: names[0], name: names[1] };
  return { schema: "public", name: names[0] ?? "" };
}
