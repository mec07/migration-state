// src/apply.ts
import type { DdlStatement, SchemaState, Warning, Table, Column, Constraint, Sequence } from "./types";
import { createEmptyState, createEmptySchemaDefinition } from "./types";
import {
  extractQualifiedName,
  extractColumns,
  extractIndexParams,
  extractDropName,
  extractTriggerDropName,
  extractTypeNameList,
  extractTypeName,
  deparseExpr,
  FK_ACTIONS,
  CONTYPE_MAP,
  SERIAL_TYPES,
  TRIGGER_TIMING,
  TRIGGER_EVENTS,
} from "./ast-helpers";

export interface ApplyResult {
  state: SchemaState;
  warnings: Warning[];
}

type DdlHandler = (state: SchemaState, stmt: DdlStatement) => void;

// Dispatch table: pg-parser node type -> handler
const handlers: Record<string, DdlHandler> = {
  CreateStmt: handleCreateTable,
  CreateSchemaStmt: handleCreateSchema,
  CreateExtensionStmt: handleCreateExtension,
  AlterTableStmt: handleAlterTable,
  RenameStmt: handleRename,
  AlterObjectSchemaStmt: handleSetSchema,
  IndexStmt: handleCreateIndex,
  DropStmt: handleDrop,
  CreateEnumStmt: handleCreateEnum,
  AlterEnumStmt: handleAlterEnum,
  CompositeTypeStmt: handleCompositeType,
  CreateTrigStmt: handleCreateTrigger,
  CreateFunctionStmt: handleCreateFunction,
  ViewStmt: handleCreateView,
  CreateSeqStmt: handleCreateSequence,
  AlterSeqStmt: handleAlterSequence,
  CommentStmt: handleComment,
  CreatePolicyStmt: handleCreatePolicy,
  CreateDomainStmt: handleCreateDomain,
};

function addWarning(state: SchemaState, message: string, stmt?: DdlStatement): void {
  state.warnings.push({
    level: "warn",
    stage: "application",
    message,
    source: stmt ? { file: stmt.source.file, sql: stmt.sql } : undefined,
  });
}

function resolveTable(state: SchemaState, schemaName: string, tableName: string): Table | undefined {
  return state.schemas.get(schemaName)?.tables.get(tableName);
}

export function applyMigrations(statements: DdlStatement[]): ApplyResult {
  const state = createEmptyState();

  for (const stmt of statements) {
    const handler = handlers[stmt.type];
    if (handler) {
      try {
        handler(state, stmt);
      } catch (err) {
        addWarning(state, `Failed to apply ${stmt.type}: ${(err as Error).message}`, stmt);
      }
    }
    // Unknown types silently skipped
  }

  return { state, warnings: state.warnings };
}

function handleCreateTable(state: SchemaState, stmt: DdlStatement): void {
  const { schema: schemaName, name: tableName } = extractQualifiedName(stmt.ast.relation);

  // Ensure schema exists
  if (!state.schemas.has(schemaName)) {
    state.schemas.set(schemaName, createEmptySchemaDefinition(schemaName));
  }
  const schemaDef = state.schemas.get(schemaName)!;

  // IF NOT EXISTS check
  if (stmt.ast.if_not_exists && schemaDef.tables.has(tableName)) {
    return; // No-op
  }

  const { columns, constraints, implicitIndices, implicitSequences } = extractColumns(stmt.ast.tableElts ?? []);

  // Create implicit sequences for SERIAL columns
  for (const seq of implicitSequences) {
    const seqName = `${tableName}_${seq.forColumn}_seq`;
    schemaDef.sequences.set(seqName, {
      name: seqName,
      schema: schemaName,
    });
    const col = columns.find(c => c.name === seq.forColumn);
    if (col) {
      col.default = `nextval('${seqName}')`;
    }
  }

  const table: Table = {
    name: tableName,
    schema: schemaName,
    columns,
    constraints,
    indices: [...implicitIndices],
    triggers: [],
    policies: [],
    rlsEnabled: false,
  };

  // PARTITION BY
  if (stmt.ast.partspec) {
    const strategyMap: Record<string, string> = {
      PARTITION_STRATEGY_RANGE: "RANGE",
      PARTITION_STRATEGY_LIST: "LIST",
      PARTITION_STRATEGY_HASH: "HASH",
    };
    const method = strategyMap[stmt.ast.partspec.strategy] ?? stmt.ast.partspec.strategy;
    const partCols = (stmt.ast.partspec.partParams ?? [])
      .map((p: any) => p.PartitionElem?.name)
      .filter(Boolean);
    table.partitionBy = { method, columns: partCols };
  }

  // PARTITION OF (child table)
  if (stmt.ast.partbound) {
    const parentRelation = stmt.ast.inhRelations?.[0]?.RangeVar;
    const parentName = parentRelation?.relname ?? "";
    const lowerVals = (stmt.ast.partbound.lowerdatums ?? [])
      .map((d: any) => deparseExpr(d)).join(", ");
    const upperVals = (stmt.ast.partbound.upperdatums ?? [])
      .map((d: any) => deparseExpr(d)).join(", ");
    table.partitionOf = {
      parent: parentName,
      bounds: `FROM (${lowerVals}) TO (${upperVals})`,
    };
  }

  // INHERITS (without PARTITION OF)
  if (stmt.ast.inhRelations && !stmt.ast.partbound) {
    table.inherits = (stmt.ast.inhRelations ?? [])
      .map((r: any) => {
        const rv = r.RangeVar;
        return rv?.schemaname ? `${rv.schemaname}.${rv.relname}` : rv?.relname;
      })
      .filter(Boolean);
  }

  schemaDef.tables.set(tableName, table);
}

function handleCreateSchema(state: SchemaState, stmt: DdlStatement): void {
  const name = stmt.ast.schemaname;
  if (stmt.ast.if_not_exists && state.schemas.has(name)) return;
  if (!state.schemas.has(name)) {
    state.schemas.set(name, createEmptySchemaDefinition(name));
  }
}

function handleCreateExtension(state: SchemaState, stmt: DdlStatement): void {
  const name = stmt.ast.extname;
  if (stmt.ast.if_not_exists && state.extensions.includes(name)) return;
  if (!state.extensions.includes(name)) {
    state.extensions.push(name);
  }
}

// ---------------------------------------------------------------------------
// ALTER TABLE handlers
// ---------------------------------------------------------------------------

function handleAlterTable(state: SchemaState, stmt: DdlStatement): void {
  const { schema: schemaName, name: tableName } = extractQualifiedName(stmt.ast.relation);
  const table = resolveTable(state, schemaName, tableName);
  if (!table) {
    addWarning(state, `ALTER TABLE on non-existent table: ${schemaName}.${tableName}`, stmt);
    return;
  }

  for (const cmd of stmt.ast.cmds ?? []) {
    const altCmd = cmd.AlterTableCmd;
    if (!altCmd) continue;

    switch (altCmd.subtype) {
      case "AT_AddColumn":
        handleAddColumn(table, altCmd, state, stmt);
        break;
      case "AT_DropColumn":
        handleDropColumn(table, altCmd, state, stmt);
        break;
      case "AT_AlterColumnType":
        handleAlterColumnType(table, altCmd);
        break;
      case "AT_SetNotNull": {
        const col = table.columns.find(c => c.name === altCmd.name);
        if (col) col.nullable = false;
        break;
      }
      case "AT_DropNotNull": {
        const col = table.columns.find(c => c.name === altCmd.name);
        if (col) col.nullable = true;
        break;
      }
      case "AT_ColumnDefault": {
        const col = table.columns.find(c => c.name === altCmd.name);
        if (col) {
          col.default = altCmd.def ? deparseExpr(altCmd.def) : undefined;
        }
        break;
      }
      case "AT_AddConstraint":
        handleAddConstraint(table, altCmd);
        break;
      case "AT_DropConstraint":
        handleDropConstraint(table, altCmd);
        break;
      case "AT_EnableRowSecurity":
        table.rlsEnabled = true;
        break;
    }
  }
}

function handleAddColumn(table: Table, cmd: any, state: SchemaState, stmt: DdlStatement): void {
  const colDef = cmd.def?.ColumnDef;
  if (!colDef) return;

  const typeName = extractTypeName(colDef.typeName);
  let nullable = true;
  let defaultVal: string | undefined;

  const serialExpansion = SERIAL_TYPES[typeName.toLowerCase()];
  const isSerial = !!serialExpansion;
  const actualType = serialExpansion ?? typeName;

  for (const c of colDef.constraints ?? []) {
    const con = c.Constraint;
    if (!con) continue;
    if (con.contype === "CONSTR_NOTNULL") nullable = false;
    if (con.contype === "CONSTR_DEFAULT") defaultVal = deparseExpr(con.raw_expr);
    if (con.contype === "CONSTR_GENERATED") {
      // Handled after loop
    }
  }

  if (isSerial) {
    nullable = false;
    const seqName = `${table.name}_${colDef.colname}_seq`;
    defaultVal = `nextval('${seqName}')`;
    const schemaDef = state.schemas.get(table.schema);
    if (schemaDef) {
      schemaDef.sequences.set(seqName, { name: seqName, schema: table.schema });
    }
  }

  // Check for generated column
  const genConstraint = (colDef.constraints ?? []).find(
    (c: any) => c.Constraint?.contype === "CONSTR_GENERATED"
  );
  let generated: Column["generated"];
  if (genConstraint) {
    generated = {
      expression: deparseExpr(genConstraint.Constraint.raw_expr),
      stored: true,
    };
  }

  table.columns.push({
    name: colDef.colname,
    type: actualType,
    nullable,
    default: defaultVal,
    generated,
  });
}

function handleDropColumn(table: Table, cmd: any, state: SchemaState, stmt: DdlStatement): void {
  const colName = cmd.name;
  const colIdx = table.columns.findIndex(c => c.name === colName);

  if (colIdx === -1) {
    if (!cmd.missing_ok) {
      addWarning(state, `DROP COLUMN on non-existent column: ${table.name}.${colName}`, stmt);
    }
    return;
  }

  table.columns.splice(colIdx, 1);

  // Cascade to indices: remove column from each index, remove index if empty
  table.indices = table.indices.filter(idx => {
    idx.columns = idx.columns.filter(c => c !== colName);
    return idx.columns.length > 0;
  });

  // Cascade to constraints: remove column, remove constraint if empty (except CHECK)
  table.constraints = table.constraints.filter(c => {
    if (c.type === "CHECK") return true;
    c.columns = c.columns.filter(col => col !== colName);
    return c.columns.length > 0;
  });
}

function handleAlterColumnType(table: Table, cmd: any): void {
  const col = table.columns.find(c => c.name === cmd.name);
  if (!col) return;
  if (cmd.def?.ColumnDef?.typeName) {
    col.type = extractTypeName(cmd.def.ColumnDef.typeName);
  }
}

function handleAddConstraint(table: Table, cmd: any): void {
  const con = cmd.def?.Constraint;
  if (!con) return;

  const type = CONTYPE_MAP[con.contype];
  if (!type) return;

  const columns = (con.keys ?? con.fk_attrs ?? []).map((k: any) => k.String?.sval).filter(Boolean);

  const constraint: Constraint = { name: con.conname || "", type, columns };

  if (type === "FOREIGN KEY" && con.pktable) {
    constraint.references = {
      schema: con.pktable.schemaname || undefined,
      table: con.pktable.relname ?? "",
      columns: (con.pk_attrs ?? []).map((a: any) => a.String?.sval).filter(Boolean),
      onDelete: FK_ACTIONS[con.fk_del_action] ?? undefined,
      onUpdate: FK_ACTIONS[con.fk_upd_action] ?? undefined,
    };
  }

  if (type === "CHECK") {
    constraint.definition = deparseExpr(con.raw_expr);
  }

  table.constraints.push(constraint);

  // Implicit index for PK and UNIQUE via ALTER TABLE ADD CONSTRAINT
  if (type === "PRIMARY KEY" || type === "UNIQUE") {
    table.indices.push({
      name: constraint.name || (type === "PRIMARY KEY" ? "pkey" : "key"),
      columns: [...columns],
      unique: true,
      method: "btree",
    });
  }
}

function handleDropConstraint(table: Table, cmd: any): void {
  const name = cmd.name;
  table.constraints = table.constraints.filter(c => c.name !== name);
}

// ---------------------------------------------------------------------------
// RENAME handler
// ---------------------------------------------------------------------------

function handleRename(state: SchemaState, stmt: DdlStatement): void {
  const { schema: schemaName, name: objName } = extractQualifiedName(stmt.ast.relation);

  if (stmt.ast.renameType === "OBJECT_TABLE") {
    // RENAME TABLE
    const schemaDef = state.schemas.get(schemaName);
    if (!schemaDef) return;
    const table = schemaDef.tables.get(objName);
    if (!table) return;

    schemaDef.tables.delete(objName);
    table.name = stmt.ast.newname;
    schemaDef.tables.set(stmt.ast.newname, table);

    // Cascade FK references in other tables
    for (const [, otherSchema] of state.schemas) {
      for (const [, otherTable] of otherSchema.tables) {
        for (const constraint of otherTable.constraints) {
          if (constraint.type === "FOREIGN KEY" && constraint.references) {
            if (constraint.references.table === objName &&
                (constraint.references.schema ?? "public") === schemaName) {
              constraint.references.table = stmt.ast.newname;
            }
          }
        }
      }
    }
  } else if (stmt.ast.renameType === "OBJECT_COLUMN") {
    // RENAME COLUMN
    const table = resolveTable(state, schemaName, objName);
    if (!table) return;

    const oldName = stmt.ast.subname;
    const newName = stmt.ast.newname;
    const col = table.columns.find(c => c.name === oldName);
    if (col) col.name = newName;

    // Cascade to indices
    for (const idx of table.indices) {
      idx.columns = idx.columns.map(c => c === oldName ? newName : c);
    }

    // Cascade to constraints
    for (const con of table.constraints) {
      con.columns = con.columns.map(c => c === oldName ? newName : c);
    }
  }
}

// ---------------------------------------------------------------------------
// SET SCHEMA handler
// ---------------------------------------------------------------------------

function handleSetSchema(state: SchemaState, stmt: DdlStatement): void {
  const { schema: oldSchema, name: tableName } = extractQualifiedName(stmt.ast.relation);
  const newSchema = stmt.ast.newschema;

  const oldSchemaDef = state.schemas.get(oldSchema);
  if (!oldSchemaDef) return;

  const table = oldSchemaDef.tables.get(tableName);
  if (!table) return;

  // Ensure target schema exists
  if (!state.schemas.has(newSchema)) {
    state.schemas.set(newSchema, createEmptySchemaDefinition(newSchema));
  }

  oldSchemaDef.tables.delete(tableName);
  table.schema = newSchema;
  state.schemas.get(newSchema)!.tables.set(tableName, table);
}

// ---------------------------------------------------------------------------
// CREATE INDEX handler (needed by ALTER TABLE tests for cascade behavior)
// ---------------------------------------------------------------------------

function handleCreateIndex(state: SchemaState, stmt: DdlStatement): void {
  const { schema: schemaName, name: tableName } = extractQualifiedName(stmt.ast.relation);
  const table = resolveTable(state, schemaName, tableName);
  if (!table) {
    addWarning(state, `CREATE INDEX on non-existent table: ${schemaName}.${tableName}`, stmt);
    return;
  }

  const { columns } = extractIndexParams(stmt.ast.indexParams ?? []);

  table.indices.push({
    name: stmt.ast.idxname ?? "",
    columns,
    unique: stmt.ast.unique ?? false,
    method: stmt.ast.accessMethod || "btree",
    where: stmt.ast.whereClause ? deparseExpr(stmt.ast.whereClause) : undefined,
  });
}

// ---------------------------------------------------------------------------
// DROP handler
// ---------------------------------------------------------------------------

function handleDrop(state: SchemaState, stmt: DdlStatement): void {
  const removeType = stmt.ast.removeType;
  const missingOk = stmt.ast.missing_ok;

  switch (removeType) {
    case "OBJECT_TABLE": {
      const target = extractDropName(stmt.ast.objects);
      if (!target) return;
      const schemaDef = state.schemas.get(target.schema);
      if (!schemaDef?.tables.has(target.name)) {
        if (!missingOk) addWarning(state, `DROP TABLE on non-existent: ${target.schema}.${target.name}`, stmt);
        return;
      }
      schemaDef.tables.delete(target.name);
      break;
    }
    case "OBJECT_INDEX": {
      const target = extractDropName(stmt.ast.objects);
      if (!target) return;
      // Search all tables in the schema for this index
      const schemaDef = state.schemas.get(target.schema);
      if (!schemaDef) { if (!missingOk) addWarning(state, `DROP INDEX: schema not found: ${target.schema}`, stmt); return; }
      let found = false;
      for (const [, table] of schemaDef.tables) {
        const idxBefore = table.indices.length;
        table.indices = table.indices.filter(i => i.name !== target.name);
        if (table.indices.length < idxBefore) { found = true; break; }
      }
      if (!found && !missingOk) {
        addWarning(state, `DROP INDEX on non-existent: ${target.name}`, stmt);
      }
      break;
    }
    case "OBJECT_TYPE": {
      const target = extractDropName(stmt.ast.objects);
      if (!target) return;
      const schemaDef = state.schemas.get(target.schema);
      if (!schemaDef) return;
      if (!schemaDef.enums.delete(target.name) && !schemaDef.domains.delete(target.name)) {
        if (!missingOk) addWarning(state, `DROP TYPE on non-existent: ${target.name}`, stmt);
      }
      break;
    }
    case "OBJECT_VIEW": {
      const target = extractDropName(stmt.ast.objects);
      if (!target) return;
      const schemaDef = state.schemas.get(target.schema);
      if (!schemaDef?.views.delete(target.name) && !missingOk) {
        addWarning(state, `DROP VIEW on non-existent: ${target.name}`, stmt);
      }
      break;
    }
    case "OBJECT_TRIGGER": {
      const target = extractTriggerDropName(stmt.ast.objects);
      if (!target) return;
      const table = resolveTable(state, target.schema, target.table);
      if (!table) { if (!missingOk) addWarning(state, `DROP TRIGGER: table not found: ${target.table}`, stmt); return; }
      table.triggers = table.triggers.filter(t => t.name !== target.trigger);
      break;
    }
    case "OBJECT_FUNCTION": {
      const target = extractDropName(stmt.ast.objects);
      if (!target) return;
      const schemaDef = state.schemas.get(target.schema);
      if (!schemaDef?.functions.delete(target.name) && !missingOk) {
        addWarning(state, `DROP FUNCTION on non-existent: ${target.name}`, stmt);
      }
      break;
    }
    case "OBJECT_SEQUENCE": {
      const target = extractDropName(stmt.ast.objects);
      if (!target) return;
      const schemaDef = state.schemas.get(target.schema);
      if (!schemaDef?.sequences.delete(target.name) && !missingOk) {
        addWarning(state, `DROP SEQUENCE on non-existent: ${target.name}`, stmt);
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Enum handlers
// ---------------------------------------------------------------------------

function handleCreateEnum(state: SchemaState, stmt: DdlStatement): void {
  const { schema, name } = extractTypeNameList(stmt.ast.typeName);
  const schemaDef = state.schemas.get(schema) ?? state.schemas.get("public")!;
  schemaDef.enums.set(name, {
    name,
    schema: schemaDef.name,
    values: (stmt.ast.vals ?? []).map((v: any) => v.String?.sval).filter(Boolean),
  });
}

function handleAlterEnum(state: SchemaState, stmt: DdlStatement): void {
  const { schema, name } = extractTypeNameList(stmt.ast.typeName);
  const schemaDef = state.schemas.get(schema) ?? state.schemas.get("public")!;
  const e = schemaDef.enums.get(name);
  if (!e) { addWarning(state, `ALTER TYPE on non-existent enum: ${name}`, stmt); return; }

  const newVal = stmt.ast.newVal;
  if (!newVal) return;

  if (stmt.ast.newValNeighbor) {
    const neighborIdx = e.values.indexOf(stmt.ast.newValNeighbor);
    if (neighborIdx !== -1) {
      const insertAt = stmt.ast.newValIsAfter ? neighborIdx + 1 : neighborIdx;
      e.values.splice(insertAt, 0, newVal);
      return;
    }
  }
  e.values.push(newVal);
}

function handleCompositeType(state: SchemaState, stmt: DdlStatement): void {
  // CompositeTypeStmt uses typevar for the name
  const { schema, name } = extractQualifiedName(stmt.ast.typevar);
  const schemaDef = state.schemas.get(schema) ?? state.schemas.get("public")!;
  // Store as enum-like with fields as values (simplified)
  const fields = (stmt.ast.coldeflist ?? []).map((c: any) => {
    const col = c.ColumnDef;
    return `${col.colname} ${extractTypeName(col.typeName)}`;
  });
  schemaDef.enums.set(name, { name, schema: schemaDef.name, values: fields });
}

// ---------------------------------------------------------------------------
// Trigger handler
// ---------------------------------------------------------------------------

function handleCreateTrigger(state: SchemaState, stmt: DdlStatement): void {
  const { schema, name: tableName } = extractQualifiedName(stmt.ast.relation);
  const table = resolveTable(state, schema, tableName);
  if (!table) { addWarning(state, `CREATE TRIGGER on non-existent table: ${tableName}`, stmt); return; }

  const funcName = (stmt.ast.funcname ?? []).map((n: any) => n.String?.sval).filter(Boolean).join(".");

  const timing = TRIGGER_TIMING[stmt.ast.timing] ?? String(stmt.ast.timing);

  const events: string[] = [];
  const ev = stmt.ast.events ?? 0;
  if (ev & TRIGGER_EVENTS.INSERT) events.push("INSERT");
  if (ev & TRIGGER_EVENTS.DELETE) events.push("DELETE");
  if (ev & TRIGGER_EVENTS.UPDATE) events.push("UPDATE");
  if (ev & TRIGGER_EVENTS.TRUNCATE) events.push("TRUNCATE");

  table.triggers.push({
    name: stmt.ast.trigname,
    timing,
    events,
    forEach: stmt.ast.row ? "ROW" : "STATEMENT",
    function: funcName,
    condition: stmt.ast.whenClause ? deparseExpr(stmt.ast.whenClause) : undefined,
    columns: stmt.ast.columns?.map((c: any) => c.String?.sval).filter(Boolean),
  });
}

// ---------------------------------------------------------------------------
// Function handler
// ---------------------------------------------------------------------------

function handleCreateFunction(state: SchemaState, stmt: DdlStatement): void {
  const names = (stmt.ast.funcname ?? []).map((n: any) => n.String?.sval).filter(Boolean);
  const schema = names.length > 1 ? names[0] : "public";
  const name = names[names.length - 1] ?? "";

  const schemaDef = state.schemas.get(schema) ?? state.schemas.get("public")!;

  const returnType = stmt.ast.returnType ? extractTypeName(stmt.ast.returnType) : "void";

  let language = "sql";
  for (const opt of stmt.ast.options ?? []) {
    const de = opt.DefElem;
    if (de?.defname === "language") {
      language = de.arg?.String?.sval ?? "sql";
    }
  }

  const args = (stmt.ast.parameters ?? [])
    .map((p: any) => {
      const fp = p.FunctionParameter;
      if (!fp) return null;
      const argType = extractTypeName(fp.argType);
      return fp.name ? `${fp.name} ${argType}` : argType;
    })
    .filter(Boolean)
    .join(", ");

  schemaDef.functions.set(name, {
    name,
    schema: schemaDef.name,
    args,
    returnType,
    language,
  });
}

// ---------------------------------------------------------------------------
// View handler
// ---------------------------------------------------------------------------

function handleCreateView(state: SchemaState, stmt: DdlStatement): void {
  const { schema, name } = extractQualifiedName(stmt.ast.view);
  const schemaDef = state.schemas.get(schema) ?? state.schemas.get("public")!;

  // Store the SQL definition (we use the original stmt.sql since deparsing the query AST is complex)
  schemaDef.views.set(name, {
    name,
    schema: schemaDef.name,
    definition: stmt.sql,
    replace: stmt.ast.replace ?? false,
  });
}

// ---------------------------------------------------------------------------
// Sequence handlers
// ---------------------------------------------------------------------------

function handleCreateSequence(state: SchemaState, stmt: DdlStatement): void {
  const { schema, name } = extractQualifiedName(stmt.ast.sequence);
  const schemaDef = state.schemas.get(schema) ?? state.schemas.get("public")!;

  const seq: Sequence = { name, schema: schemaDef.name };
  for (const opt of stmt.ast.options ?? []) {
    const de = opt.DefElem;
    if (!de) continue;
    const val = de.arg?.Integer?.ival ?? de.arg?.Float?.fval;
    if (de.defname === "start") seq.start = val;
    if (de.defname === "increment") seq.increment = val;
    if (de.defname === "minvalue") seq.min = val;
    if (de.defname === "maxvalue") seq.max = val;
  }
  schemaDef.sequences.set(name, seq);
}

function handleAlterSequence(state: SchemaState, stmt: DdlStatement): void {
  const { schema, name } = extractQualifiedName(stmt.ast.sequence);
  const schemaDef = state.schemas.get(schema) ?? state.schemas.get("public")!;
  const seq = schemaDef.sequences.get(name);
  if (!seq) {
    schemaDef.sequences.set(name, { name, schema: schemaDef.name });
    return;
  }
  // Update with any new options
  for (const opt of stmt.ast.options ?? []) {
    const de = opt.DefElem;
    if (!de) continue;
    const val = de.arg?.Integer?.ival ?? de.arg?.Float?.fval;
    if (de.defname === "start" || de.defname === "restart") seq.start = val;
    if (de.defname === "increment") seq.increment = val;
    if (de.defname === "minvalue") seq.min = val;
    if (de.defname === "maxvalue") seq.max = val;
  }
}

// ---------------------------------------------------------------------------
// Comment handler
// ---------------------------------------------------------------------------

function handleComment(state: SchemaState, stmt: DdlStatement): void {
  const objtype = stmt.ast.objtype;
  const comment = stmt.ast.comment;

  if (objtype === "OBJECT_TABLE") {
    const items = stmt.ast.object?.List?.items?.map((i: any) => i.String?.sval).filter(Boolean) ?? [];
    const tableName = items[items.length - 1];
    const schemaName = items.length > 1 ? items[0] : "public";
    const table = resolveTable(state, schemaName, tableName);
    if (table) table.comment = comment;
  } else if (objtype === "OBJECT_COLUMN") {
    const items = stmt.ast.object?.List?.items?.map((i: any) => i.String?.sval).filter(Boolean) ?? [];
    // Format: [table, column] or [schema, table, column]
    let schemaName = "public", tableName: string, colName: string;
    if (items.length === 3) {
      [schemaName, tableName, colName] = items;
    } else if (items.length === 2) {
      [tableName, colName] = items;
    } else return;
    const table = resolveTable(state, schemaName, tableName!);
    if (table) {
      const col = table.columns.find(c => c.name === colName);
      if (col) col.comment = comment;
    }
  }
}

// ---------------------------------------------------------------------------
// Policy handler
// ---------------------------------------------------------------------------

function handleCreatePolicy(state: SchemaState, stmt: DdlStatement): void {
  const { schema, name: tableName } = extractQualifiedName(stmt.ast.table);
  const table = resolveTable(state, schema, tableName);
  if (!table) return;
  table.policies.push({
    name: stmt.ast.policy_name ?? "",
    command: stmt.ast.cmd_name ?? undefined,
    using: stmt.ast.qual ? deparseExpr(stmt.ast.qual) : undefined,
    withCheck: stmt.ast.with_check ? deparseExpr(stmt.ast.with_check) : undefined,
  });
}

// ---------------------------------------------------------------------------
// Domain handler
// ---------------------------------------------------------------------------

function handleCreateDomain(state: SchemaState, stmt: DdlStatement): void {
  const names = (stmt.ast.domainname ?? []).map((n: any) => n.String?.sval).filter(Boolean);
  const schema = names.length > 1 ? names[0] : "public";
  const name = names[names.length - 1] ?? "";
  const schemaDef = state.schemas.get(schema) ?? state.schemas.get("public")!;
  const baseType = extractTypeName(stmt.ast.typeName);
  const constraints = (stmt.ast.constraints ?? [])
    .map((c: any) => c.Constraint ? deparseExpr(c.Constraint.raw_expr) : "")
    .filter(Boolean);
  schemaDef.domains.set(name, { name, schema: schemaDef.name, baseType, constraints });
}
