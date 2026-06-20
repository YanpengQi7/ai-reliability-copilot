import { describe, expect, it } from "vitest";
import { INPUT_LIMITS } from "../requestSafety";
import { SAVE_INCIDENT_INPUT_SCHEMA, sanitizeMcpIncidentInput } from "./server";

describe("MCP incident persistence input limits", () => {
  it("accepts values at the shared HTTP boundaries", () => {
    expect(SAVE_INCIDENT_INPUT_SCHEMA.title.safeParse("t".repeat(INPUT_LIMITS.shortText)).success).toBe(true);
    expect(SAVE_INCIDENT_INPUT_SCHEMA.raw_context.safeParse("r".repeat(INPUT_LIMITS.rawContext)).success).toBe(true);
  });

  it("rejects oversized metadata and incident context", () => {
    expect(SAVE_INCIDENT_INPUT_SCHEMA.title.safeParse("t".repeat(INPUT_LIMITS.shortText + 1)).success).toBe(false);
    expect(SAVE_INCIDENT_INPUT_SCHEMA.service.safeParse("s".repeat(INPUT_LIMITS.shortText + 1)).success).toBe(false);
    expect(SAVE_INCIDENT_INPUT_SCHEMA.symptoms.safeParse("s".repeat(INPUT_LIMITS.shortText + 1)).success).toBe(false);
    expect(SAVE_INCIDENT_INPUT_SCHEMA.client_model.safeParse("m".repeat(INPUT_LIMITS.shortText + 1)).success).toBe(false);
    expect(SAVE_INCIDENT_INPUT_SCHEMA.raw_context.safeParse("r".repeat(INPUT_LIMITS.rawContext + 1)).success).toBe(false);
  });
});

describe("MCP incident persistence redaction", () => {
  it("redacts secrets from metadata, raw context, and nested analysis fields", () => {
    const secret = "sk-" + "a".repeat(30);
    const input = {
      service: `payments token=${secret}`,
      raw_context: `Authorization: Bearer ${secret}`,
      analysis: {
        summary: "Provider authentication failed.",
        root_causes: [{ evidence: secret }],
      },
    };

    const result = sanitizeMcpIncidentInput(input);

    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.analysis.summary).toBe(input.analysis.summary);
  });
});
