// src/output.ts
import type {
  SchemaState,
  SchemaDefinition,
  Table,
  Column,
  Constraint,
  Index,
  Trigger,
  Policy,
  EnumType,
  View,
  Sequence,
  DbFunction,
  OutputOptions,
} from "./types";

// === Filtering ===

/** Collect enum names referenced by a table's column types */
function enumsUsedByTable(table: Table, schemaDef: SchemaDefinition): Set<string> {
  const used = new Set<string>();
  const enumNames = new Set(schemaDef.enums.keys());
  for (const col of table.columns) {
    if (enumNames.has(col.type)) used.add(col.type);
  }
  return used;
}

function filterState(
  state: SchemaState,
  options: OutputOptions,
): SchemaState {
  // No filtering needed
  if (!options.tables?.length && !options.schemas?.length) return state;

  const filtered: SchemaState = {
    schemas: new Map(),
    extensions: state.extensions,
    warnings: state.warnings,
  };

  for (const [schemaName, schemaDef] of state.schemas) {
    // Schema filter
    if (options.schemas?.length && !options.schemas.includes(schemaName)) continue;

    const newSchema: SchemaDefinition = {
      name: schemaName,
      tables: new Map(),
      views: new Map(),
      functions: new Map(),
      enums: new Map(),
      sequences: new Map(),
      domains: new Map(),
    };

    // Table filter
    const relevantEnums = new Set<string>();
    for (const [tableName, table] of schemaDef.tables) {
      if (options.tables?.length && !options.tables.includes(tableName)) continue;
      newSchema.tables.set(tableName, table);
      // Track enums used by included tables
      for (const enumName of enumsUsedByTable(table, schemaDef)) {
        relevantEnums.add(enumName);
      }
    }

    // Include enums: all if no table filter, only relevant ones if table filter active
    for (const [enumName, enumDef] of schemaDef.enums) {
      if (!options.tables?.length || relevantEnums.has(enumName)) {
        newSchema.enums.set(enumName, enumDef);
      }
    }

    // Views, functions, sequences, domains — include if no table filter
    if (!options.tables?.length) {
      for (const [k, v] of schemaDef.views) newSchema.views.set(k, v);
      for (const [k, v] of schemaDef.functions) newSchema.functions.set(k, v);
      for (const [k, v] of schemaDef.sequences) newSchema.sequences.set(k, v);
      for (const [k, v] of schemaDef.domains) newSchema.domains.set(k, v);
    }

    // Only include schema if it has content after filtering
    if (
      newSchema.tables.size > 0 ||
      newSchema.enums.size > 0 ||
      newSchema.views.size > 0 ||
      newSchema.functions.size > 0 ||
      newSchema.sequences.size > 0
    ) {
      filtered.schemas.set(schemaName, newSchema);
    }
  }

  return filtered;
}

// === Markdown Rendering ===

function renderConstraint(c: Constraint): string {
  const name = c.name ? `\`${c.name}\` ` : "";
  const cols = c.columns.length > 0 ? `(${c.columns.join(", ")})` : "";

  if (c.type === "FOREIGN KEY" && c.references) {
    const ref = c.references;
    const refTable = ref.schema && ref.schema !== "public" ? `${ref.schema}.${ref.table}` : ref.table;
    const refCols = ref.columns.length > 0 ? `(${ref.columns.join(", ")})` : "";
    let actions = "";
    if (ref.onDelete && ref.onDelete !== "NO ACTION") actions += ` ON DELETE ${ref.onDelete}`;
    if (ref.onUpdate && ref.onUpdate !== "NO ACTION") actions += ` ON UPDATE ${ref.onUpdate}`;
    return `- ${name}FOREIGN KEY ${cols} -> ${refTable}${refCols}${actions}`;
  }

  if (c.type === "CHECK" && c.definition) {
    return `- ${name}CHECK ${c.definition}`;
  }

  return `- ${name}${c.type} ${cols}`;
}

function renderIndex(idx: Index): string {
  const unique = idx.unique ? "UNIQUE " : "";
  const method = idx.method !== "btree" ? `${idx.method} ` : "";
  const cols = `(${idx.columns.join(", ")})`;
  const where = idx.where ? ` WHERE ${idx.where}` : "";
  return `- \`${idx.name}\` ${unique}${method}${cols}${where}`;
}

function renderTrigger(trg: Trigger): string {
  const events = trg.events.join("/");
  const cols = trg.columns?.length ? ` OF ${trg.columns.join(", ")}` : "";
  return `- \`${trg.name}\` ${trg.timing} ${events}${cols} FOR EACH ${trg.forEach} -> ${trg.function}()`;
}

function renderTable(table: Table): string {
  const lines: string[] = [];
  const qualifiedName = table.schema !== "public" ? `${table.schema}.${table.name}` : table.name;

  lines.push(`### \`${qualifiedName}\``);
  if (table.comment) lines.push(table.comment);
  lines.push("");

  // Partition info
  if (table.partitionBy) {
    lines.push(`*Partitioned by ${table.partitionBy.method} (${table.partitionBy.columns.join(", ")})*`);
    lines.push("");
  }
  if (table.partitionOf) {
    lines.push(`*Partition of \`${table.partitionOf.parent}\`: ${table.partitionOf.bounds}*`);
    lines.push("");
  }
  if (table.inherits?.length) {
    lines.push(`*Inherits from: ${table.inherits.map(p => `\`${p}\``).join(", ")}*`);
    lines.push("");
  }

  // Columns table
  const hasComments = table.columns.some(c => c.comment);
  if (hasComments) {
    lines.push("| Column | Type | Nullable | Default | Comment |");
    lines.push("|--------|------|----------|---------|---------|");
  } else {
    lines.push("| Column | Type | Nullable | Default |");
    lines.push("|--------|------|----------|---------|");
  }
  for (const col of table.columns) {
    const nullable = col.nullable ? "YES" : "NO";
    const def = col.default ?? "";
    const gen = col.generated ? `GENERATED ${col.generated.expression}` : "";
    const displayDefault = gen || def;
    if (hasComments) {
      lines.push(`| ${col.name} | ${col.type} | ${nullable} | ${displayDefault} | ${col.comment ?? ""} |`);
    } else {
      lines.push(`| ${col.name} | ${col.type} | ${nullable} | ${displayDefault} |`);
    }
  }
  lines.push("");

  // Constraints
  if (table.constraints.length > 0) {
    lines.push("**Constraints:**");
    for (const c of table.constraints) {
      lines.push(renderConstraint(c));
    }
    lines.push("");
  }

  // Indices (skip implicit ones that duplicate constraints — show only named/explicit)
  const displayIndices = table.indices.filter(i => i.name && i.name !== "pkey" && i.name !== "key");
  if (displayIndices.length > 0) {
    lines.push("**Indices:**");
    for (const idx of displayIndices) {
      lines.push(renderIndex(idx));
    }
    lines.push("");
  }

  // Triggers
  if (table.triggers.length > 0) {
    lines.push("**Triggers:**");
    for (const trg of table.triggers) {
      lines.push(renderTrigger(trg));
    }
    lines.push("");
  }

  // Policies
  if (table.policies.length > 0) {
    lines.push("**Policies:**");
    for (const pol of table.policies) {
      let line = `- \`${pol.name}\``;
      if (pol.command) line += ` FOR ${pol.command}`;
      if (pol.using) line += ` USING ${pol.using}`;
      lines.push(line);
    }
    lines.push("");
  }

  // RLS
  if (table.rlsEnabled) {
    lines.push("*Row-level security enabled*");
    lines.push("");
  }

  return lines.join("\n");
}

export function renderMarkdown(
  state: SchemaState,
  options: OutputOptions,
  meta: { migrationCount: number; tool: string; dir: string },
): string {
  const filtered = filterState(state, options);
  const lines: string[] = [];

  // Header
  lines.push("# Database Schema State");
  lines.push("");
  lines.push(`Generated from ${meta.migrationCount} migrations (${meta.tool}) in \`${meta.dir}\``);
  lines.push("");

  // Collect all content across schemas
  const allTables: Table[] = [];
  const allEnums: EnumType[] = [];
  const allViews: View[] = [];
  const allFunctions: DbFunction[] = [];
  const allSequences: Sequence[] = [];
  const allDomains: { name: string; schema: string; baseType: string; constraints: string[] }[] = [];

  for (const [, schemaDef] of filtered.schemas) {
    for (const [, t] of schemaDef.tables) allTables.push(t);
    for (const [, e] of schemaDef.enums) allEnums.push(e);
    for (const [, v] of schemaDef.views) allViews.push(v);
    for (const [, f] of schemaDef.functions) allFunctions.push(f);
    for (const [, s] of schemaDef.sequences) allSequences.push(s);
    for (const [, d] of schemaDef.domains) allDomains.push(d);
  }

  // Empty check
  if (allTables.length === 0 && allEnums.length === 0 && allViews.length === 0 && allFunctions.length === 0 && allSequences.length === 0) {
    lines.push("No tables found.");
    return lines.join("\n");
  }

  // Extensions
  if (filtered.extensions.length > 0) {
    lines.push("## Extensions");
    lines.push("");
    for (const ext of filtered.extensions) {
      lines.push(`- \`${ext}\``);
    }
    lines.push("");
  }

  // Enums
  if (allEnums.length > 0) {
    lines.push("## Enums");
    lines.push("");
    for (const e of allEnums.sort((a, b) => a.name.localeCompare(b.name))) {
      const prefix = e.schema !== "public" ? `${e.schema}.` : "";
      lines.push(`### \`${prefix}${e.name}\``);
      lines.push(`Values: ${e.values.map(v => `\`${v}\``).join(", ")}`);
      lines.push("");
    }
  }

  // Domains
  if (allDomains.length > 0) {
    lines.push("## Domains");
    lines.push("");
    for (const d of allDomains.sort((a, b) => a.name.localeCompare(b.name))) {
      const prefix = d.schema !== "public" ? `${d.schema}.` : "";
      const constraints = d.constraints.length > 0 ? ` CHECK ${d.constraints.join(", ")}` : "";
      lines.push(`- \`${prefix}${d.name}\` (${d.baseType})${constraints}`);
    }
    lines.push("");
  }

  // Tables
  if (allTables.length > 0) {
    lines.push("## Tables");
    lines.push("");
    for (const t of allTables.sort((a, b) => {
      const aKey = `${a.schema}.${a.name}`;
      const bKey = `${b.schema}.${b.name}`;
      return aKey.localeCompare(bKey);
    })) {
      lines.push(renderTable(t));
    }
  }

  // Views
  if (options.includeViews && allViews.length > 0) {
    lines.push("## Views");
    lines.push("");
    for (const v of allViews.sort((a, b) => a.name.localeCompare(b.name))) {
      const prefix = v.schema !== "public" ? `${v.schema}.` : "";
      lines.push(`### \`${prefix}${v.name}\``);
      lines.push(`\`\`\`sql`);
      lines.push(v.definition);
      lines.push(`\`\`\``);
      lines.push("");
    }
  }

  // Functions
  if (options.includeFunctions && allFunctions.length > 0) {
    lines.push("## Functions");
    lines.push("");
    for (const f of allFunctions.sort((a, b) => a.name.localeCompare(b.name))) {
      const prefix = f.schema !== "public" ? `${f.schema}.` : "";
      lines.push(`- \`${prefix}${f.name}(${f.args})\` -> ${f.returnType} [${f.language}]`);
    }
    lines.push("");
  }

  // Sequences
  if (options.includeSequences && allSequences.length > 0) {
    lines.push("## Sequences");
    lines.push("");
    for (const s of allSequences.sort((a, b) => a.name.localeCompare(b.name))) {
      const prefix = s.schema !== "public" ? `${s.schema}.` : "";
      const parts: string[] = [`\`${prefix}${s.name}\``];
      if (s.start !== undefined) parts.push(`START ${s.start}`);
      if (s.increment !== undefined) parts.push(`INCREMENT ${s.increment}`);
      if (s.min !== undefined) parts.push(`MIN ${s.min}`);
      if (s.max !== undefined) parts.push(`MAX ${s.max}`);
      lines.push(`- ${parts.join(" ")}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// === JSON Rendering ===

function mapToObject<V>(map: Map<string, V>): Record<string, V> {
  const obj: Record<string, V> = {};
  for (const [k, v] of map) {
    obj[k] = v;
  }
  return obj;
}

function schemaDefToJson(def: SchemaDefinition): Record<string, unknown> {
  return {
    name: def.name,
    tables: mapToObject(def.tables),
    views: mapToObject(def.views),
    functions: mapToObject(def.functions),
    enums: mapToObject(def.enums),
    sequences: mapToObject(def.sequences),
    domains: mapToObject(def.domains),
  };
}

export function renderJson(
  state: SchemaState,
  options: OutputOptions,
): string {
  const filtered = filterState(state, options);

  const output: any = {
    schemas: {} as Record<string, any>,
    extensions: filtered.extensions,
  };

  for (const [schemaName, schemaDef] of filtered.schemas) {
    output.schemas[schemaName] = schemaDefToJson(schemaDef);
  }

  return JSON.stringify(output, null, 2);
}
