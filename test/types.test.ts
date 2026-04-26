import { describe, test, expect } from "bun:test";
import { createEmptyState } from "../src/types";

describe("types", () => {
  test("createEmptyState returns a valid SchemaState with public schema", () => {
    const state = createEmptyState();
    expect(state.schemas.has("public")).toBe(true);
    expect(state.extensions).toEqual([]);
    expect(state.warnings).toEqual([]);

    const pub = state.schemas.get("public")!;
    expect(pub.name).toBe("public");
    expect(pub.tables).toBeInstanceOf(Map);
    expect(pub.views).toBeInstanceOf(Map);
    expect(pub.functions).toBeInstanceOf(Map);
    expect(pub.enums).toBeInstanceOf(Map);
    expect(pub.sequences).toBeInstanceOf(Map);
    expect(pub.domains).toBeInstanceOf(Map);
  });

  test("createEmptyState schemas are independent instances", () => {
    const s1 = createEmptyState();
    const s2 = createEmptyState();
    s1.schemas.get("public")!.tables.set("foo", {} as any);
    expect(s2.schemas.get("public")!.tables.size).toBe(0);
  });
});
