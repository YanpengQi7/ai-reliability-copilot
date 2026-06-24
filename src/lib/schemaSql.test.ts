import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../../supabase/schema.sql", import.meta.url), "utf8");

describe("Supabase schema completeness", () => {
  it("provisions the MCP telemetry table used by the app", () => {
    expect(schema).toMatch(/create table if not exists mcp_tool_calls\s*\(/i);
    expect(schema).toMatch(/mcp_tool_calls_created_at_idx/i);
    expect(schema).toMatch(/alter table mcp_tool_calls enable row level security/i);
  });

  it("keeps MCP telemetry private behind the service role", () => {
    expect(schema).toMatch(/revoke all on table[\s\S]*mcp_tool_calls from anon, authenticated/i);
    expect(schema).toMatch(/grant all on table[\s\S]*mcp_tool_calls to service_role/i);
  });
});
