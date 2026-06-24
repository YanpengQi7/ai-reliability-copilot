import { afterEach, describe, expect, it } from "vitest";
import { INPUT_LIMITS } from "@/lib/requestSafety";
import { POST } from "./route";

const originalToken = process.env.MCP_AUTH_TOKEN;
const originalNodeEnv = process.env.NODE_ENV;
const originalVercelEnv = process.env.VERCEL_ENV;

afterEach(() => {
  restore("MCP_AUTH_TOKEN", originalToken);
  restore("NODE_ENV", originalNodeEnv);
  restore("VERCEL_ENV", originalVercelEnv);
});

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else Reflect.set(process.env, key, value);
}

describe("POST /api/mcp request bounds", () => {
  it("rejects oversized bodies before MCP transport parsing", async () => {
    delete process.env.MCP_AUTH_TOKEN;
    delete process.env.VERCEL_ENV;
    Reflect.set(process.env, "NODE_ENV", "test");
    const request = new Request("https://example.com/api/mcp", {
      method: "POST",
      headers: { "x-forwarded-for": crypto.randomUUID() },
      body: "x".repeat(INPUT_LIMITS.mcpJson + 1),
    });

    const response = await POST(request);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      error: { code: -32003 },
    });
  });
});
