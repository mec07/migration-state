import { readFileSync } from "node:fs";
import type { MigrationFile, Warning } from "./types";

export interface ExtractResult {
  sql: string[];
  warnings: Warning[];
}

/**
 * Remove UTF-8 BOM (U+FEFF) if present at start of content.
 */
export function stripBom(content: string): string {
  if (content.charCodeAt(0) === 0xfeff) {
    return content.slice(1);
  }
  return content;
}

/**
 * Replace CRLF with LF.
 */
export function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

/**
 * Detect which migration tool marker type is present in the content.
 * Returns null if no markers are found.
 */
export function detectMarkerType(
  content: string,
): "goose" | "dbmate" | "sql-migrate" | null {
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trimStart();
    // goose: -- +goose Up (case-insensitive for the marker keyword)
    if (/^--\s*\+goose\s+up\b/i.test(trimmed)) {
      return "goose";
    }
    // dbmate: -- migrate:up
    if (/^--\s*migrate:up\b/i.test(trimmed)) {
      return "dbmate";
    }
    // sql-migrate: -- +migrate Up
    if (/^--\s*\+migrate\s+up\b/i.test(trimmed)) {
      return "sql-migrate";
    }
  }
  return null;
}

/**
 * Extract the UP section from migration content based on marker type.
 * Returns text between UP marker and DOWN marker (or EOF).
 * For goose, also strips StatementBegin/StatementEnd marker lines.
 */
export function extractUpSection(
  content: string,
  markerType: "goose" | "dbmate" | "sql-migrate",
): string {
  const lines = content.split("\n");

  let upPattern: RegExp;
  let downPattern: RegExp;

  switch (markerType) {
    case "goose":
      upPattern = /^--\s*\+goose\s+up\b/i;
      downPattern = /^--\s*\+goose\s+down\b/i;
      break;
    case "dbmate":
      upPattern = /^--\s*migrate:up\b/i;
      downPattern = /^--\s*migrate:down\b/i;
      break;
    case "sql-migrate":
      upPattern = /^--\s*\+migrate\s+up\b/i;
      downPattern = /^--\s*\+migrate\s+down\b/i;
      break;
  }

  let inUp = false;
  const upLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (upPattern.test(trimmed)) {
      inUp = true;
      continue;
    }
    if (inUp && downPattern.test(trimmed)) {
      break;
    }
    if (inUp) {
      // For goose, strip StatementBegin/StatementEnd lines
      if (markerType === "goose") {
        if (/^--\s*\+goose\s+statementbegin\b/i.test(trimmed)) continue;
        if (/^--\s*\+goose\s+statementend\b/i.test(trimmed)) continue;
      }
      upLines.push(line);
    }
  }

  return upLines.join("\n").trim();
}

/**
 * Check if content is effectively empty: only whitespace and SQL comments.
 */
function isEffectivelyEmpty(content: string): boolean {
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (trimmed.startsWith("--")) continue;
    return false;
  }
  return true;
}

/**
 * Extract SQL from migration files.
 * Reads each file, normalizes content, detects markers, extracts UP sections,
 * and filters out effectively empty files.
 */
export function extractSql(files: MigrationFile[]): ExtractResult {
  const sql: string[] = [];
  const warnings: Warning[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file.path, "utf-8");
    } catch (err) {
      warnings.push({
        level: "error",
        stage: "extraction",
        message: `Failed to read file: ${(err as Error).message}`,
        source: { file: file.path },
      });
      continue;
    }

    // Normalize
    content = stripBom(content);
    content = normalizeLineEndings(content);

    // Detect and extract UP section if markers present
    const markerType = detectMarkerType(content);
    if (markerType) {
      content = extractUpSection(content, markerType);
    }

    // Check if effectively empty
    if (isEffectivelyEmpty(content)) {
      warnings.push({
        level: "warn",
        stage: "extraction",
        message: `Skipping effectively empty file`,
        source: { file: file.path },
      });
      continue;
    }

    sql.push(content);
  }

  return { sql, warnings };
}
