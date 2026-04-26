import { describe, test, expect } from "bun:test";
import { buildProgram } from "../src/cli";

describe("cli", () => {
  test("buildProgram returns a commander program with correct name", () => {
    const program = buildProgram();
    expect(program.name()).toBe("migration-state");
  });

  test("buildProgram has all expected options", () => {
    const program = buildProgram();
    const opts = program.options.map((o: any) => o.long);
    expect(opts).toContain("--tool");
    expect(opts).toContain("--tables");
    expect(opts).toContain("--schemas");
    expect(opts).toContain("--format");
    expect(opts).toContain("--no-views");
    expect(opts).toContain("--no-functions");
    expect(opts).toContain("--no-sequences");
    expect(opts).toContain("--quiet");
  });
});
