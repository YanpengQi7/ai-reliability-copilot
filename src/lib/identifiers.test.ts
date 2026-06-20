import { describe, expect, it } from "vitest";
import { isIncidentId } from "./identifiers";

describe("isIncidentId", () => {
  it("accepts Supabase UUID identifiers", () => {
    expect(isIncidentId("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });

  it.each([
    "",
    "incident-1",
    "550e8400-e29b-41d4-a716-446655440000/extra",
    "550e8400e29b41d4a716446655440000",
  ])("rejects malformed incident id %j", (value) => {
    expect(isIncidentId(value)).toBe(false);
  });
});
