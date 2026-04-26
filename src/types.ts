// src/types.ts

export type MigrationTool =
  | "flyway" | "golang-migrate" | "goose" | "dbmate"
  | "sql-migrate" | "prisma" | "drizzle" | "atlas" | "generic";

export interface MigrationFile {
  path: string;
  version: string;
  schema?: string;
}

export interface SchemaState {
  schemas: Map<string, SchemaDefinition>;
  extensions: string[];
  warnings: Warning[];
}

export interface SchemaDefinition {
  name: string;
  tables: Map<string, Table>;
  views: Map<string, View>;
  functions: Map<string, DbFunction>;
  enums: Map<string, EnumType>;
  sequences: Map<string, Sequence>;
  domains: Map<string, Domain>;
}

export interface Table {
  name: string;
  schema: string;
  columns: Column[];
  constraints: Constraint[];
  indices: Index[];
  triggers: Trigger[];
  policies: Policy[];
  comment?: string;
  rlsEnabled: boolean;
  partitionBy?: { method: string; columns: string[] };
  partitionOf?: { parent: string; bounds: string };
  inherits?: string[];
}

export interface Column {
  name: string;
  type: string;
  nullable: boolean;
  default?: string;
  comment?: string;
  generated?: { expression: string; stored: boolean };
}

export interface Constraint {
  name: string;
  type: "PRIMARY KEY" | "FOREIGN KEY" | "UNIQUE" | "CHECK" | "EXCLUDE";
  columns: string[];
  definition?: string;
  references?: {
    schema?: string;
    table: string;
    columns: string[];
    onDelete?: string;
    onUpdate?: string;
  };
}

export interface Index {
  name: string;
  columns: string[];
  unique: boolean;
  method: string;
  where?: string;
}

export interface Trigger {
  name: string;
  timing: string;
  events: string[];
  forEach: string;
  function: string;
  condition?: string;
  columns?: string[];
}

export interface Policy {
  name: string;
  command?: string;
  using?: string;
  withCheck?: string;
}

export interface EnumType {
  name: string;
  schema: string;
  values: string[];
}

export interface View {
  name: string;
  schema: string;
  definition: string;
  replace?: boolean;
}

export interface Sequence {
  name: string;
  schema: string;
  start?: number;
  increment?: number;
  min?: number;
  max?: number;
}

export interface DbFunction {
  name: string;
  schema: string;
  args: string;
  returnType: string;
  language: string;
}

export interface Domain {
  name: string;
  schema: string;
  baseType: string;
  constraints: string[];
}

export interface DdlStatement {
  type: string;
  ast: any;
  sql: string;
  source: {
    file: string;
    statementIndex: number;
  };
}

export interface Warning {
  level: "info" | "warn" | "error";
  stage: "discovery" | "extraction" | "parsing" | "application";
  message: string;
  source?: {
    file: string;
    sql?: string;
  };
}

export interface OutputOptions {
  format: "markdown" | "json";
  tables?: string[];
  schemas?: string[];
  includeViews: boolean;
  includeFunctions: boolean;
  includeSequences: boolean;
}

export function createEmptySchemaDefinition(name: string): SchemaDefinition {
  return {
    name,
    tables: new Map(),
    views: new Map(),
    functions: new Map(),
    enums: new Map(),
    sequences: new Map(),
    domains: new Map(),
  };
}

export function createEmptyState(): SchemaState {
  const state: SchemaState = {
    schemas: new Map(),
    extensions: [],
    warnings: [],
  };
  state.schemas.set("public", createEmptySchemaDefinition("public"));
  return state;
}
