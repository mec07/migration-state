// src/cli.ts
import { Command } from "commander";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { discover } from "./discover";
import { extractSql } from "./extract";
import { parseMigrations } from "./parse";
import { applyMigrations } from "./apply";
import { renderMarkdown, renderJson } from "./output";
import type { OutputOptions } from "./types";

export function buildProgram(): Command {
  const program = new Command()
    .name("migration-state")
    .description("Compute PostgreSQL schema state from migration files")
    .argument("<dir>", "Path to migration directory")
    .option("--tool <tool>", "Migration tool (auto-detected if omitted)")
    .option("--tables <tables>", "Comma-separated table names to filter")
    .option("--schemas <schemas>", "Comma-separated schema names to filter")
    .option("--format <format>", "Output format: markdown (default) or json", "markdown")
    .option("--no-views", "Exclude views from output")
    .option("--no-functions", "Exclude functions from output")
    .option("--no-sequences", "Exclude sequences from output")
    .option("--quiet", "Suppress warnings");

  return program;
}

export async function run(argv?: string[]): Promise<void> {
  const program = buildProgram();

  program.action(async (dir: string, options: any) => {
    const resolvedDir = resolve(dir);

    // Check directory exists
    if (!existsSync(resolvedDir)) {
      console.error(`Error: Directory does not exist: ${dir}`);
      process.exit(1);
    }

    // Stage 1: Discovery
    const { files, warnings: discoverWarnings } = discover(resolvedDir);

    // Stage 2: Extraction
    const { sql, warnings: extractWarnings } = extractSql(files);

    // No migration files found
    if (files.length === 0) {
      const allWarnings = [...discoverWarnings, ...extractWarnings];
      if (!options.quiet && allWarnings.length > 0) {
        for (const w of allWarnings) {
          console.error(`  ${w.level}: ${w.message}`);
        }
      }
      console.log("No migration files found.");
      process.exit(0);
    }

    // Stage 3: Parsing
    const sourceFiles = files.map(f => f.path);
    const { statements, warnings: parseWarnings } = await parseMigrations(sql, sourceFiles);

    // Stage 4: Application
    const { state, warnings: applyWarnings } = applyMigrations(statements);

    // Collect all warnings
    const allWarnings = [
      ...discoverWarnings,
      ...extractWarnings,
      ...parseWarnings,
      ...applyWarnings,
    ];

    // Print warnings to stderr
    if (!options.quiet && allWarnings.length > 0) {
      console.error(`${allWarnings.length} warning(s):`);
      for (const w of allWarnings) {
        console.error(`  ${w.level}: ${w.message}`);
      }
    }

    // Build output options from CLI flags
    const outputOptions: OutputOptions = {
      format: options.format ?? "markdown",
      tables: options.tables ? options.tables.split(",").map((t: string) => t.trim()) : undefined,
      schemas: options.schemas ? options.schemas.split(",").map((s: string) => s.trim()) : undefined,
      includeViews: options.views !== false,
      includeFunctions: options.functions !== false,
      includeSequences: options.sequences !== false,
    };

    // Detect tool name for metadata (best effort from first file's path)
    const toolName = options.tool ?? "generic";

    // Stage 5: Output
    const meta = {
      migrationCount: files.length,
      tool: toolName,
      dir: dir,
    };

    const output = outputOptions.format === "json"
      ? renderJson(state, outputOptions)
      : renderMarkdown(state, outputOptions, meta);

    console.log(output);
  });

  await program.parseAsync(argv ?? process.argv);
}
