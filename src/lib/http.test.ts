import { describe, it, expect } from "vitest";
import { z } from "zod";
import { apiError, validationError, invalidJson } from "./http";

async function readBody(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

describe("apiError", () => {
  it("sets the HTTP status and the matching statusCode in the body", async () => {
    const res = apiError(503, "MISSING_API_KEY", "key not set");
    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await readBody(res)).toEqual({
      error: "MISSING_API_KEY",
      message: "key not set",
      statusCode: 503,
    });
  });

  it("includes nextAction only when provided", async () => {
    const without = await readBody(apiError(429, "RATE_LIMITED", "slow down"));
    expect(without).not.toHaveProperty("nextAction");

    const withIt = await readBody(apiError(429, "RATE_LIMITED", "slow down", { nextAction: "retry in 30s" }));
    expect(withIt.nextAction).toBe("retry in 30s");
  });

  it("passes through custom headers (e.g. Retry-After)", () => {
    const res = apiError(429, "RATE_LIMITED", "x", { headers: { "retry-after": "30" } });
    expect(res.headers.get("retry-after")).toBe("30");
  });
});

describe("validationError", () => {
  it("joins Zod issue messages and uses code VALIDATION_ERROR", async () => {
    const schema = z.object({
      raw_context: z.string().min(20, "raw_context too short"),
      service: z.string({ message: "service required" }),
    });
    const parsed = schema.safeParse({ raw_context: "short" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const body = await readBody(validationError(parsed.error));
    expect(body.statusCode).toBe(400);
    expect(body.error).toBe("VALIDATION_ERROR");
    expect(String(body.message)).toContain("raw_context too short");
  });
});

describe("invalidJson", () => {
  it("is a 400 INVALID_JSON envelope", async () => {
    const res = invalidJson();
    expect(res.status).toBe(400);
    expect(await readBody(res)).toMatchObject({ error: "INVALID_JSON", statusCode: 400 });
  });
});
