import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { join, basename, dirname, extname } from "node:path";
import type { MigrationFile, MigrationTool, Warning } from "./types";

export interface DiscoverResult {
  files: MigrationFile[];
  warnings: Warning[];
}

// Flyway callback filenames to exclude
const FLYWAY_CALLBACKS = new Set([
  "beforeMigrate.sql",
  "afterMigrate.sql",
  "beforeEachMigrate.sql",
  "afterEachMigrate.sql",
  "beforeRepair.sql",
  "afterRepair.sql",
  "beforeInfo.sql",
  "afterInfo.sql",
  "beforeValidate.sql",
  "afterValidate.sql",
  "beforeClean.sql",
  "afterClean.sql",
  "beforeBaseline.sql",
  "afterBaseline.sql",
  "beforeUndo.sql",
  "afterUndo.sql",
]);

// Metadata files to ignore
const METADATA_FILES = new Set([
  "snapshot.json",
  "atlas.sum",
  "_journal.json",
]);

/**
 * Extract a version string from a migration filename.
 * Optionally uses the parent directory name for dir-per-migration layouts.
 */
export function extractVersion(filename: string, parentDir?: string): string {
  // Directory-per-migration: if filename is generic (e.g. migration.sql),
  // use the parent directory name to extract the version
  if (parentDir) {
    // Flyway V-prefix on directory name: V12__name or V20240101__name
    const flywayDirMatch = parentDir.match(/^V([\d.]+)__/);
    if (flywayDirMatch?.[1]) {
      return flywayDirMatch[1];
    }
    // Numeric/timestamp prefix on directory name
    const leadingDigits = parentDir.match(/^(\d+)/);
    if (leadingDigits?.[1]) {
      return leadingDigits[1];
    }
  }

  // Flyway V prefix: V{version}__name.sql
  const flywayMatch = filename.match(/^V([\d.]+)__/);
  if (flywayMatch?.[1]) {
    return flywayMatch[1];
  }

  // Numeric/timestamp prefix: digits followed by _ or .
  const numericMatch = filename.match(/^(\d+)/);
  if (numericMatch?.[1]) {
    return numericMatch[1];
  }

  // Fallback: return full filename
  return filename;
}

/**
 * Compare two version strings for sorting.
 * Splits on dots and compares each segment numerically.
 */
export function compareVersions(a: string, b: string): number {
  const aParts = a.split(".").map(Number);
  const bParts = b.split(".").map(Number);
  const maxLen = Math.max(aParts.length, bParts.length);

  for (let i = 0; i < maxLen; i++) {
    const aVal = aParts[i] ?? 0;
    const bVal = bParts[i] ?? 0;
    if (aVal !== bVal) return aVal - bVal;
  }
  return 0;
}

/**
 * Determine whether a directory name looks like a schema name rather than
 * a migration version directory.
 */
export function isSchemaDirectory(name: string): boolean {
  // Starts with a digit → version directory
  if (/^\d/.test(name)) return false;
  // Starts with V + digit → Flyway version directory
  if (/^V\d/.test(name)) return false;
  // Otherwise treat as schema name
  return true;
}

/**
 * Check if a filename should be excluded from discovery.
 */
function shouldExclude(filename: string): boolean {
  // Flyway callbacks
  if (FLYWAY_CALLBACKS.has(filename)) return true;
  // Metadata files
  if (METADATA_FILES.has(filename)) return true;
  // Down migrations: *.down.sql or exactly "down.sql"
  if (filename.endsWith(".down.sql") || filename === "down.sql") return true;
  // Flyway undo migrations: U{version}__name.sql
  if (/^U[\d.]+__/.test(filename)) return true;
  // Not a SQL file
  if (!filename.endsWith(".sql")) return true;

  return false;
}

/**
 * Recursively collect all files from a directory.
 */
function collectFiles(dirPath: string): string[] {
  const results: string[] = [];
  const entries = readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Process a flat or recursive directory of SQL migration files.
 * Returns sorted MigrationFile[], with optional schema tag.
 */
function processDirectory(
  dirPath: string,
  schema?: string,
): MigrationFile[] {
  const allFiles = collectFiles(dirPath);
  const sqlFiles: MigrationFile[] = [];

  for (const filePath of allFiles) {
    const filename = basename(filePath);
    if (shouldExclude(filename)) continue;

    // Determine if this is a dir-per-migration pattern:
    // The file sits in a subdirectory of dirPath (not dirPath itself)
    const parentFullPath = dirname(filePath);
    const parentDirName = basename(parentFullPath);
    const isInSubdir = parentFullPath !== dirPath;

    let version: string;
    if (isInSubdir && isGenericMigrationFilename(filename)) {
      version = extractVersion(filename, parentDirName);
    } else {
      version = extractVersion(filename);
    }

    const entry: MigrationFile = { path: filePath, version };
    if (schema) {
      entry.schema = schema;
    }
    sqlFiles.push(entry);
  }

  // Sort by version
  sqlFiles.sort((a, b) => compareVersions(a.version, b.version));
  return sqlFiles;
}

/**
 * Is this a generic migration filename (like migration.sql, up.sql)?
 */
function isGenericMigrationFilename(filename: string): boolean {
  const lower = filename.toLowerCase();
  return lower === "migration.sql" || lower === "up.sql";
}

/**
 * Discover migration files in the given directory path.
 */
export function discover(
  dirPath: string,
  toolHint?: MigrationTool,
): DiscoverResult {
  const warnings: Warning[] = [];

  // Check directory exists
  if (!existsSync(dirPath)) {
    warnings.push({
      level: "error",
      stage: "discovery",
      message: `Directory does not exist: ${dirPath}`,
    });
    return { files: [], warnings };
  }

  let stat;
  try {
    stat = statSync(dirPath);
  } catch {
    warnings.push({
      level: "error",
      stage: "discovery",
      message: `Cannot stat path: ${dirPath}`,
    });
    return { files: [], warnings };
  }

  if (!stat.isDirectory()) {
    warnings.push({
      level: "error",
      stage: "discovery",
      message: `Path is not a directory: ${dirPath}`,
    });
    return { files: [], warnings };
  }

  // Check for schema-separated layout:
  // Immediate subdirs that look like schema names AND contain SQL files,
  // AND no SQL files in the root directory itself.
  const rootEntries = readdirSync(dirPath, { withFileTypes: true });
  const rootSqlFiles = rootEntries.filter(
    (e) => e.isFile() && e.name.endsWith(".sql"),
  );
  const subdirs = rootEntries.filter((e) => e.isDirectory());
  const schemaDirs = subdirs.filter((e) => isSchemaDirectory(e.name));

  // Schema-separated if: no SQL in root, at least one schema-like subdir with SQL
  const isSchemaSeparated =
    rootSqlFiles.length === 0 &&
    schemaDirs.length > 0 &&
    schemaDirs.some((sd) => {
      const sdPath = join(dirPath, sd.name);
      const files = collectFiles(sdPath);
      return files.some((f) => f.endsWith(".sql"));
    });

  if (isSchemaSeparated) {
    const allFiles: MigrationFile[] = [];
    for (const sd of schemaDirs) {
      const sdPath = join(dirPath, sd.name);
      const schemaFiles = processDirectory(sdPath, sd.name);
      allFiles.push(...schemaFiles);
    }
    // Sort by schema first, then version within each schema
    allFiles.sort((a, b) => {
      const schemaCompare = (a.schema ?? "").localeCompare(b.schema ?? "");
      if (schemaCompare !== 0) return schemaCompare;
      return compareVersions(a.version, b.version);
    });
    return { files: allFiles, warnings };
  }

  // Non-schema-separated: process the whole directory recursively
  const files = processDirectory(dirPath);
  return { files, warnings };
}
