import { PgParser, unwrapParseResult, unwrapNode } from "@supabase/pg-parser";
import type { DdlStatement, Warning } from "./types";

export interface ParseResult {
  statements: DdlStatement[];
  warnings: Warning[];
}

/** DDL node types we keep — everything else is silently skipped. */
export const DDL_TYPES = new Set<string>([
  "CreateStmt",
  "AlterTableStmt",
  "IndexStmt",
  "DropStmt",
  "CreateEnumStmt",
  "AlterEnumStmt",
  "CompositeTypeStmt",
  "CreateTrigStmt",
  "CreateFunctionStmt",
  "ViewStmt",
  "CreateSchemaStmt",
  "CreateSeqStmt",
  "AlterSeqStmt",
  "CreateExtensionStmt",
  "CommentStmt",
  "CreatePolicyStmt",
  "CreateDomainStmt",
  "RenameStmt",
  "AlterObjectSchemaStmt",
]);

/**
 * Regex to extract DDL statements embedded in DO-block PL/pgSQL bodies.
 * Matches CREATE/ALTER/DROP ... TABLE|TYPE|INDEX|etc. up to the next semicolon.
 */
const DO_BLOCK_DDL_RE =
  /((?:CREATE|ALTER|DROP)\s+(?:TABLE|TYPE|INDEX|FUNCTION|TRIGGER|VIEW|SCHEMA|SEQUENCE|EXTENSION|POLICY|DOMAIN)\s[^;]+;)/gi;

/** Lazy-initialized module-level parser instance. */
let _parser: PgParser | null = null;
function getParser(): PgParser {
  if (!_parser) {
    _parser = new PgParser();
  }
  return _parser;
}

/**
 * Extract the original SQL text for a single statement from the full input
 * string, using `stmt_location` byte offsets.
 */
function sliceSql(
  fullSql: string,
  stmtLocation: number,
  nextStmtLocation: number | undefined,
): string {
  const raw =
    nextStmtLocation !== undefined
      ? fullSql.slice(stmtLocation, nextStmtLocation)
      : fullSql.slice(stmtLocation);
  return raw.replace(/[\s;]+$/, "").trim();
}

/**
 * Try to extract the PL/pgSQL body from a DoStmt AST node.
 * Returns the body string or null if extraction fails.
 */
function extractDoBody(node: any): string | null {
  try {
    // node.args is an array of DefElem; the first one contains the body
    const args = node.args;
    if (!Array.isArray(args) || args.length === 0) return null;
    const defElem = args[0]?.DefElem;
    if (!defElem) return null;
    const body = defElem.arg?.String?.sval ?? defElem.arg?.String?.str ?? null;
    return typeof body === "string" ? body : null;
  } catch {
    return null;
  }
}

export async function parseMigrations(
  sqlStrings: string[],
  sourceFiles: string[],
): Promise<ParseResult> {
  const statements: DdlStatement[] = [];
  const warnings: Warning[] = [];
  const parser = getParser();

  for (let fileIdx = 0; fileIdx < sqlStrings.length; fileIdx++) {
    const sql = sqlStrings[fileIdx]!;
    const file = sourceFiles[fileIdx] ?? `<unknown-${fileIdx}>`;
    let statementIndex = 0;

    let tree: any;
    try {
      tree = await unwrapParseResult(parser.parse(sql));
    } catch (err: unknown) {
      warnings.push({
        level: "warn",
        stage: "parsing",
        message: `Failed to parse SQL: ${err instanceof Error ? err.message : String(err)}`,
        source: { file, sql },
      });
      continue;
    }

    const stmts = tree.stmts ?? [];

    for (let i = 0; i < stmts.length; i++) {
      const rawStmt = stmts[i];
      const unwrapped = unwrapNode(rawStmt.stmt);
      const type = String(unwrapped.type);
      const node = unwrapped.node;

      // Compute per-statement SQL slice
      const loc = rawStmt.stmt_location ?? 0;
      const nextLoc =
        i + 1 < stmts.length ? stmts[i + 1]?.stmt_location : undefined;
      const stmtSql = sliceSql(sql, loc, nextLoc);

      if (DDL_TYPES.has(type)) {
        statements.push({
          type,
          ast: node,
          sql: stmtSql,
          source: { file, statementIndex },
        });
        statementIndex++;
      } else if (type === "DoStmt") {
        // Best-effort: extract inner DDL from PL/pgSQL body
        const body = extractDoBody(node);
        if (body === null) {
          warnings.push({
            level: "warn",
            stage: "parsing",
            message: "Could not extract body from DO block",
            source: { file, sql: stmtSql },
          });
          statementIndex++;
          continue;
        }

        const matches = body.match(DO_BLOCK_DDL_RE);
        if (!matches || matches.length === 0) {
          warnings.push({
            level: "info",
            stage: "parsing",
            message: "DO block contains no extractable DDL statements",
            source: { file, sql: stmtSql },
          });
          statementIndex++;
          continue;
        }

        for (const innerSql of matches) {
          try {
            const innerTree = await unwrapParseResult(parser.parse(innerSql));
            for (const innerRawStmt of innerTree.stmts ?? []) {
              const inner = unwrapNode(innerRawStmt.stmt!);
              const innerType = String(inner.type);
              if (DDL_TYPES.has(innerType)) {
                statements.push({
                  type: innerType,
                  ast: inner.node,
                  sql: innerSql.replace(/[\s;]+$/, "").trim(),
                  source: { file, statementIndex },
                });
                statementIndex++;
              }
            }
          } catch {
            // Inner DDL failed to parse — skip silently
          }
        }
        // If no DDL was actually added, that's fine — we already matched something
        if (matches.length > 0 && !statements.some(s => s.source.file === file && s.source.statementIndex >= statementIndex)) {
          // No statements were added from this DO block despite regex matches
          // This can happen if regex matched something unparseable
        }
      }
      // All other types (DML, DCL, SET, transaction control) are silently skipped
    }
  }

  return { statements, warnings };
}
